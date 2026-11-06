import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { ACTIVE_STATUSES, BLOCKINGS, CATEGORIES, IMPACTS, TICKET_TYPES, computePriority, type TicketView } from '@nexo/domain'
import { searchArticles } from '@/server/help-center/search'
import { createDraft, getConversation, getDraft } from '@/server/store/conversations'
import { ActionError, confirmDraft, describeTicketsError, draftSla, transferConversation } from '@/server/chat/actions'
import { toDetail, toSummary } from '@/server/chat/tickets-view'
import { getTurn, type TurnState } from './context'
import { turnOutputSchema } from './output'

// Tools do Nexo Assist. Cada uma faz uma coisa só e devolve um resultado curto para o modelo
// (menos tokens = turno mais barato). As regras que não podem falhar ficam aqui, em código:
//  - os chamados são sempre do funcionário logado (vem do contexto, não do modelo);
//  - nada é criado/atualizado sem rascunho confirmado;
//  - abrir chamado novo passa por checagem de duplicidade;
//  - prioridade e prazo são calculados pela tabela do Anexo A.

interface StepResult {
  result: Record<string, unknown>
  summary: string
  label?: string
}

/** Executa a tool registrando o passo no trace (entrada, saída resumida, tempo e retentativas). */
async function traced(
  state: TurnState,
  tool: string,
  label: string,
  input: Record<string, unknown>,
  run: () => Promise<StepResult>,
): Promise<Record<string, unknown>> {
  state.onStepStart?.(tool)
  const started = Date.now()
  try {
    const { result, summary, label: finalLabel } = await run()
    state.steps.push({ tool, label: finalLabel ?? label, input, output: summary, ok: true, durationMs: Date.now() - started, retries: state.client.takeRetries() })
    return result
  } catch (error) {
    const message = error instanceof ActionError ? error.message : describeTicketsError(error)
    state.steps.push({ tool, label: `não conseguiu: ${label}`, input, output: message, ok: false, durationMs: Date.now() - started, retries: state.client.takeRetries() })
    return { erro: message }
  }
}

/** Versão compacta do chamado para o modelo ler. */
function brief(t: TicketView) {
  return {
    id: t.id,
    titulo: t.title,
    categoria: t.category,
    prioridade: t.priority,
    status: t.status,
    aberto_em: t.createdAt,
    ultima_atividade: t.lastActivityAt,
    prazo: t.dueAt,
    vencido: t.overdue,
    pode_reabrir: t.reopenable,
  }
}

export const buscarCentralAjuda = createTool({
  id: 'buscar_central_ajuda',
  description:
    'Busca artigos da central de ajuda. Use antes de abrir chamado para dúvidas ou problemas que podem ter solução simples. Leia as condições do artigo (ex.: sistema operacional) antes de aplicar.',
  inputSchema: z.object({ consulta: z.string().describe('Palavras-chave do problema, ex.: "vpn erro 809"') }),
  execute: async ({ consulta }, ctx) => {
    const state = getTurn(ctx)
    return traced(state, 'buscar_central_ajuda', 'buscou na central de ajuda', { consulta }, async () => {
      const hits = searchArticles(consulta)
      return {
        result: { artigos: hits.map((h) => ({ id: h.article.id, titulo: h.article.title, texto: h.article.body })) },
        summary: hits.length ? hits.map((h) => `${h.article.id} ${h.article.title} (relevância ${h.score})`).join('; ') : 'nenhum artigo encontrado',
      }
    })
  },
})

export const listarMeusChamados = createTool({
  id: 'listar_meus_chamados',
  description:
    'Lista os chamados do funcionário logado. Use para consultar status sem número, para checar se já existe chamado sobre o mesmo problema e antes de complementar um chamado.',
  inputSchema: z.object({
    incluir_resolvidos: z.boolean().describe('true para incluir resolvidos/fechados (ex.: ver se dá para reabrir)'),
    mostrar_para_escolha: z
      .boolean()
      .describe('true quando o funcionário precisa escolher um chamado na tela (mostra a lista para seleção)'),
  }),
  execute: async ({ incluir_resolvidos, mostrar_para_escolha }, ctx) => {
    const state = getTurn(ctx)
    return traced(state, 'listar_meus_chamados', 'consultou seus chamados', { incluir_resolvidos, mostrar_para_escolha }, async () => {
      const all = await state.client.listTickets({ scope: 'all' })
      const tickets = incluir_resolvidos ? all : all.filter((t) => ACTIVE_STATUSES.includes(t.status))
      if (mostrar_para_escolha && tickets.length > 1) {
        state.cards.push({ kind: 'ticket_select', tickets: tickets.map(toSummary) })
      } else if (mostrar_para_escolha && tickets.length === 1) {
        state.cards.push({ kind: 'ticket_detail', ticket: toDetail(tickets[0]!) })
      }
      return {
        result: { total: tickets.length, chamados: tickets.map(brief) },
        summary: tickets.length ? `${tickets.length} chamado(s): ${tickets.map((t) => t.id).join(', ')}` : 'nenhum chamado',
      }
    })
  },
})

export const consultarChamado = createTool({
  id: 'consultar_chamado',
  description: 'Mostra o detalhe de um chamado do funcionário (status, prazo, se está vencido e a última atualização).',
  inputSchema: z.object({ chamado_id: z.string().describe('Número do chamado, ex.: INC-20311') }),
  execute: async ({ chamado_id }, ctx) => {
    const state = getTurn(ctx)
    return traced(state, 'consultar_chamado', `consultou o ${chamado_id.toUpperCase()}`, { chamado_id }, async () => {
      const t = await state.client.getTicket(chamado_id)
      state.cards.push({ kind: 'ticket_detail', ticket: toDetail(t) })
      const last = t.updates.at(-1)
      return {
        result: { ...brief(t), descricao: t.description, fila: t.assignedQueue, ultima_atualizacao: last ? `${last.at} ${last.author}: ${last.note}` : null },
        summary: `${t.id} · ${t.status} · ${t.overdue ? 'prazo vencido' : 'no prazo'}`,
        label: t.overdue ? `consultou o ${t.id} · calculou o prazo` : `consultou o ${t.id}`,
      }
    })
  },
})

export const proporNovoChamado = createTool({
  id: 'propor_novo_chamado',
  description:
    'Monta o RASCUNHO de um chamado novo para o funcionário conferir. Não cria nada: o chamado só é criado depois da confirmação. A prioridade é calculada pelo sistema a partir de impacto, bloqueio e compromisso. Só chame quando tiver todas as informações.',
  inputSchema: z.object({
    tipo: z.enum(TICKET_TYPES).describe('INC quando algo parou ou não funciona; REQ para pedido de acesso, equipamento ou software'),
    titulo: z.string().describe('Curto e específico, ex.: "VPN não conecta no notebook — erro 809"'),
    descricao: z.string().describe('Tudo o que o analista precisa para não perguntar de novo: desde quando, o que já foi tentado, equipamento/SO, mensagens de erro'),
    categoria: z.enum(CATEGORIES),
    impacto: z.enum(IMPACTS).describe('pessoa = só o funcionário; equipe = um time; empresa = muitos times'),
    bloqueio: z.enum(BLOCKINGS).describe('parado = não consegue trabalhar; atrapalha = há alternativa; sem_urgencia = pedido/melhoria'),
    compromisso_hoje: z.boolean().describe('Há reunião, entrega ou prazo HOJE em risco por causa disso?'),
    afetados: z.string().describe('Quem é afetado, como aparece no chamado: "Somente você", "Equipe de Vendas"...'),
    motivo_nao_duplicado: z
      .string()
      .optional()
      .describe('Preencha só se o sistema apontou possível duplicidade e o funcionário confirmou que é outro problema'),
  }),
  execute: async (input, ctx) => {
    const state = getTurn(ctx)
    return traced(state, 'propor_novo_chamado', 'montou o rascunho', input, async () => {
      // Regra "sem duplicidade": antes de propor um chamado novo, procuro um aberto da mesma
      // categoria ou um resolvido há até 7 dias (que pode ser reaberto).
      const mine = await state.client.listTickets({ scope: 'all' })
      const similar = mine.filter(
        (t) => t.category === input.categoria && (ACTIVE_STATUSES.includes(t.status) || t.reopenable),
      )
      if (similar.length > 0 && !input.motivo_nao_duplicado) {
        state.guardrails.push({
          rule: 'Sem duplicidade',
          detail: `Rascunho bloqueado: já existe ${similar.map((t) => `${t.id} (${t.status})`).join(', ')} na categoria ${input.categoria}.`,
        })
        return {
          result: {
            rascunho_criado: false,
            possivel_duplicidade: similar.map(brief),
            instrucao:
              'Pergunte ao funcionário se é o mesmo problema. Se for, use propor_atualizacao (reabrindo se estiver resolvido). Se for outro problema, chame de novo com motivo_nao_duplicado.',
          },
          summary: `possível duplicidade com ${similar.map((t) => t.id).join(', ')}`,
          label: 'checou duplicidade',
        }
      }

      const { priority, reason } = computePriority({
        impact: input.impacto,
        blocking: input.bloqueio,
        sameDayDeadline: input.compromisso_hoje,
      })
      state.guardrails.push({
        rule: 'Prioridade pela tabela do Anexo A',
        detail: `impacto=${input.impacto}, bloqueio=${input.bloqueio}, compromisso hoje=${input.compromisso_hoje ? 'sim' : 'não'} → ${priority} (${reason}).`,
      })
      const draft = await createDraft(
        state.conversationId,
        {
          kind: 'create',
          ticketId: null,
          type: input.tipo,
          title: input.titulo,
          description: input.descricao,
          category: input.categoria,
          priority,
          priorityReason: reason,
          affected: input.afetados,
          ...draftSla(priority),
        },
        state.userSeq,
      )
      state.cards.push({ kind: 'draft', draft })
      return {
        result: { rascunho_criado: true, rascunho_id: draft.id, prioridade: priority, motivo_prioridade: reason, prazo: draft.dueAt, prazo_regra: draft.slaLabel },
        summary: `${draft.id} · ${input.tipo} · ${input.categoria} · ${priority}`,
        label: 'classificou a prioridade · montou o rascunho',
      }
    })
  },
})

export const proporAtualizacao = createTool({
  id: 'propor_atualizacao',
  description:
    'Monta o RASCUNHO de uma atualização em chamado existente (nova informação ou reabertura de resolvido há até 7 dias). Só é aplicado depois da confirmação.',
  inputSchema: z.object({
    chamado_id: z.string(),
    informacao: z.string().describe('O que será acrescentado ao chamado, escrito para o analista'),
  }),
  execute: async ({ chamado_id, informacao }, ctx) => {
    const state = getTurn(ctx)
    return traced(state, 'propor_atualizacao', `montou a atualização do ${chamado_id.toUpperCase()}`, { chamado_id, informacao }, async () => {
      const t = await state.client.getTicket(chamado_id)
      if (t.status === 'Fechado' || (t.status === 'Resolvido' && !t.reopenable)) {
        state.guardrails.push({ rule: 'Reabertura até 7 dias', detail: `${t.id} foi resolvido há mais de 7 dias; não pode ser reaberto.` })
        return {
          result: { rascunho_criado: false, motivo: `${t.id} foi resolvido há mais de 7 dias e não pode ser reaberto. Proponha um chamado novo, citando o ${t.id} na descrição.` },
          summary: `${t.id} não pode ser reaberto`,
          label: `checou a reabertura do ${t.id}`,
        }
      }
      const reopen = t.status === 'Resolvido'
      const draft = await createDraft(
        state.conversationId,
        {
          kind: 'update',
          ticketId: t.id,
          type: t.type,
          title: t.title,
          description: t.description,
          category: t.category,
          priority: t.priority,
          priorityReason: 'mantida do chamado original',
          affected: t.affected,
          note: informacao,
          reopen,
          ...draftSla(t.priority),
        },
        state.userSeq,
      )
      state.cards.push({ kind: 'draft', draft })
      return {
        result: { rascunho_criado: true, rascunho_id: draft.id, vai_reabrir: reopen },
        summary: `${draft.id} · ${reopen ? 'reabrir e ' : ''}atualizar ${t.id}`,
      }
    })
  },
})

export const confirmarRascunho = createTool({
  id: 'confirmar_rascunho',
  description:
    'Executa um rascunho que o funcionário JÁ VIU e confirmou por escrito nesta mensagem (ex.: "pode criar", "confirmo"). Nunca use no mesmo turno em que o rascunho foi montado.',
  inputSchema: z.object({ rascunho_id: z.string() }),
  execute: async ({ rascunho_id }, ctx) => {
    const state = getTurn(ctx)
    return traced(state, 'confirmar_rascunho', 'criou o chamado', { rascunho_id }, async () => {
      const stored = await getDraft(rascunho_id)
      // A confirmação só vale se o rascunho foi mostrado ANTES desta mensagem do funcionário.
      // Isso impede o modelo de montar e confirmar no mesmo turno, sem o funcionário ver.
      if (!stored || stored.conversationId !== state.conversationId || stored.createdAtSeq >= state.userSeq) {
        state.guardrails.push({ rule: 'Confirmação antes de agir', detail: `Confirmação de ${rascunho_id} recusada: o funcionário ainda não viu esse rascunho.` })
        throw new ActionError('Esse rascunho ainda não foi mostrado ao funcionário. Mostre o rascunho e aguarde a confirmação.')
      }
      const { draft } = await confirmDraft(rascunho_id, { id: state.employee.id, name: state.employee.name, email: state.employee.email, role: 'employee' }, state.client, { announce: false })
      state.guardrails.push({ rule: 'Confirmação antes de agir', detail: `${draft.id} executado após confirmação por escrito do funcionário.` })
      const ticket = await state.client.getTicket(draft.ticketId!)
      state.cards.push({ kind: 'ticket_detail', ticket: toDetail(ticket) })
      if (ticket.priority === 'Crítica' && draft.kind === 'create') {
        state.transferred = await getConversation(state.conversationId)
      }
      return {
        result: { executado: true, chamado: brief(ticket) },
        summary: `${draft.kind === 'create' ? 'criou' : 'atualizou'} ${ticket.id}`,
        label: draft.kind === 'create' ? `criou o ${ticket.id}` : `atualizou o ${ticket.id}`,
      }
    })
  },
})

export const transferirParaAnalista = createTool({
  id: 'transferir_para_analista',
  description:
    'Transfere a conversa para um analista humano. Use quando o funcionário pedir, em caso crítico, em chamado vencido (depois de oferecer) ou quando você não tiver segurança. Depois disso você não responde mais até o analista devolver.',
  inputSchema: z.object({
    motivo: z.enum(['pedido_do_funcionario', 'caso_critico', 'chamado_vencido', 'baixa_confianca']),
    fila: z.enum(['N1', 'N2']).describe('N1 para casos simples/acessos; N2 para problemas técnicos, vencidos ou críticos'),
    resumo: z.string().describe('Resumo para o analista não precisar perguntar de novo: problema, o que já foi tentado, chamado envolvido'),
    chamado_id: z.string().optional(),
  }),
  execute: async ({ motivo, fila, resumo, chamado_id }, ctx) => {
    const state = getTurn(ctx)
    return traced(state, 'transferir_para_analista', `transferiu para o Suporte ${fila}`, { motivo, fila, resumo, chamado_id }, async () => {
      state.transferred = await transferConversation(state.conversationId, {
        reason: motivo,
        queue: fila,
        summary: resumo,
        ticketId: chamado_id?.toUpperCase() ?? null,
        confidence: null,
        client: state.client,
      })
      state.cards.push({ kind: 'transfer', queue: fila, summary: resumo })
      return {
        result: { transferido: true, fila, observacao: 'Avise o funcionário que um analista vai assumir e qual o prazo de resposta.' },
        summary: `conversa na fila do Suporte ${fila}`,
      }
    })
  },
})

/**
 * Fecha o turno: entrega a decisão e a resposta ao funcionário. O agent roda com uso de tool
 * obrigatório e o turno para quando esta tool é chamada. Assim o modelo não consegue encerrar
 * dizendo "vou verificar" sem ter verificado: ou chama a tool de consulta, ou responde.
 */
export const responder = createTool({
  id: 'responder',
  description:
    'Envia a resposta final deste turno ao funcionário, com a sua decisão. Chame por último, depois de usar as ferramentas de que precisar. Nunca prometa verificar algo: verifique antes com a ferramenta certa.',
  inputSchema: turnOutputSchema,
  execute: async (input, ctx) => {
    getTurn(ctx).final = input
    return { enviado: true }
  },
})

export const nexoTools = {
  buscar_central_ajuda: buscarCentralAjuda,
  listar_meus_chamados: listarMeusChamados,
  consultar_chamado: consultarChamado,
  propor_novo_chamado: proporNovoChamado,
  propor_atualizacao: proporAtualizacao,
  confirmar_rascunho: confirmarRascunho,
  transferir_para_analista: transferirParaAnalista,
  responder,
}

/** Rótulo "no gerúndio" para mostrar enquanto a tool roda. */
export const RUNNING_LABELS: Record<string, string> = {
  buscar_central_ajuda: 'buscando na central de ajuda',
  listar_meus_chamados: 'consultando seus chamados',
  consultar_chamado: 'consultando o chamado',
  propor_novo_chamado: 'montando o rascunho',
  propor_atualizacao: 'montando a atualização',
  confirmar_rascunho: 'registrando no sistema de chamados',
  transferir_para_analista: 'chamando um analista',
}
