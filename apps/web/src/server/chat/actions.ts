import { SLA_RULES, computeDueAt } from '@nexo/domain'
import type { Card, ChatMessage, ConversationView, DraftView, SessionUser, TransferReason } from '@/shared/types'
import {
  TicketConflictError,
  TicketNotFoundError,
  TicketsClient,
  TicketsUnavailableError,
} from '@/server/tickets/client'
import {
  appendMessage,
  getConversation,
  getDraft,
  saveDraft,
  updateConversation,
  updateMessageCards,
  type StoredDraft,
} from '@/server/store/conversations'
import { toDetail } from './tickets-view'

// Operações de negócio do atendimento. Ficam aqui (e não dentro das tools) porque são chamadas
// por dois caminhos: pelo agent (tool) e pela tela (botão Confirmar, console do analista).
// Assim a regra é uma só, não importa quem disparou.

export class ActionError extends Error {}

/** Mensagem curta para o funcionário quando o legado falha. */
export function describeTicketsError(error: unknown): string {
  if (error instanceof TicketsUnavailableError) {
    return 'O sistema de chamados está fora do ar agora. Tentei algumas vezes e não consegui.'
  }
  if (error instanceof TicketNotFoundError) return 'Não encontrei esse chamado entre os seus.'
  if (error instanceof TicketConflictError) return error.message
  return 'Algo deu errado ao falar com o sistema de chamados.'
}

/**
 * Confirma um rascunho: só aqui um chamado é criado ou atualizado de verdade.
 * Regra do Anexo A: "só cria ou atualiza o chamado depois da confirmação do funcionário".
 */
export async function confirmDraft(
  draftId: string,
  user: SessionUser,
  client: TicketsClient,
  { announce = true }: { announce?: boolean } = {},
): Promise<{ draft: DraftView; conversation: ConversationView; message: ChatMessage | null }> {
  const stored = await getDraft(draftId)
  if (!stored) throw new ActionError('Rascunho não encontrado.')
  const conversation = await getConversation(stored.conversationId)
  if (!conversation || conversation.employee.id !== user.id) throw new ActionError('Rascunho não encontrado.')
  if (stored.draft.status === 'confirmed') return { draft: stored.draft, conversation, message: null }
  if (stored.draft.status !== 'pending') throw new ActionError('Esse rascunho não está mais valendo. Peça um novo ao Nexo.')

  const draft = stored.draft
  try {
    const ticket =
      draft.kind === 'create'
        ? await client.createTicket({
            type: draft.type,
            title: draft.title,
            description: draft.description,
            category: draft.category,
            priority: draft.priority,
            affected: draft.affected,
          })
        : await client.addUpdate(draft.ticketId!, draft.note ?? draft.description, draft.reopen ?? false)
    stored.draft = { ...draft, status: 'confirmed', ticketId: ticket.id, dueAt: ticket.dueAt ?? draft.dueAt }
    delete stored.draft.error
    await persistDraft(stored)

    // Pelo botão da tela, eu mesmo aviso o funcionário (sem gastar uma chamada ao modelo).
    // Pela tool, quem responde é o agent, então não anuncio aqui.
    const text =
      draft.kind === 'create'
        ? `Chamado ${ticket.id} criado com prioridade ${ticket.priority.toLowerCase()}. ${ticket.priority === 'Crítica' ? 'Como é crítico, já chamei um analista.' : 'Você recebe a primeira resposta dentro do prazo.'}`
        : `Pronto, ${draft.reopen ? 'reabri e ' : ''}atualizei o ${ticket.id} com a nova informação.`
    const message = !announce ? null : await appendMessage(conversation.id, {
      role: 'assistant',
      content: text,
      cards: [{ kind: 'ticket_detail', ticket: toDetail(ticket) }],
      trace: {
        steps: [
          {
            tool: draft.kind === 'create' ? 'criar_chamado' : 'atualizar_chamado',
            label: draft.kind === 'create' ? 'criou o chamado' : 'atualizou o chamado',
            input: { rascunho: draft.id },
            output: `${ticket.id} · ${ticket.status} · prioridade ${ticket.priority}`,
            ok: true,
            durationMs: 0,
            retries: client.takeRetries(),
          },
        ],
        decision: null,
        guardrails: [{ rule: 'Confirmação antes de agir', detail: `Ação executada só depois que ${user.name} confirmou o rascunho ${draft.id}.` }],
        model: 'nenhum (ação direta, sem chamar o modelo)',
        latencyMs: 0,
        usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
        costUsd: 0,
      },
    })

    // Caso crítico vai direto para um analista (regra de transferência do Anexo A).
    let conv = conversation
    if (draft.kind === 'create' && ticket.priority === 'Crítica') {
      conv = await transferConversation(conversation.id, {
        reason: 'caso_critico',
        queue: 'N2',
        summary: `Chamado crítico ${ticket.id}: ${ticket.title}. ${ticket.description}`,
        ticketId: ticket.id,
        confidence: null,
        client,
      })
    }
    return { draft: stored.draft, conversation: conv, message }
  } catch (error) {
    if (error instanceof TicketsUnavailableError) {
      // O rascunho continua pendente: o funcionário pode tentar de novo quando o legado voltar.
      stored.draft = { ...draft, error: describeTicketsError(error) }
      await persistDraft(stored)
      throw new ActionError(`${describeTicketsError(error)} Seu rascunho está guardado, é só confirmar de novo daqui a pouco.`)
    }
    stored.draft = { ...draft, status: 'failed', error: describeTicketsError(error) }
    await persistDraft(stored)
    throw new ActionError(describeTicketsError(error))
  }
}

export async function cancelDraft(draftId: string, user: SessionUser): Promise<DraftView> {
  const stored = await getDraft(draftId)
  if (!stored) throw new ActionError('Rascunho não encontrado.')
  const conversation = await getConversation(stored.conversationId)
  if (!conversation || conversation.employee.id !== user.id) throw new ActionError('Rascunho não encontrado.')
  if (stored.draft.status === 'pending') {
    stored.draft = { ...stored.draft, status: 'cancelled' }
    await persistDraft(stored)
    await appendMessage(conversation.id, { role: 'system', content: `Rascunho ${draftId} cancelado.` })
  }
  return stored.draft
}

/** Salva o rascunho e atualiza o card dentro da mensagem onde ele apareceu. */
async function persistDraft(stored: StoredDraft): Promise<void> {
  await saveDraft(stored)
  if (stored.messageId) {
    const cards: Card[] = [{ kind: 'draft', draft: stored.draft }]
    await updateMessageCards(stored.messageId, cards)
  }
}

/** Monta o prazo que aparece no rascunho, a partir de agora. */
export function draftSla(priority: DraftView['priority'], now = new Date()): { slaLabel: string; dueAt: string } {
  return { slaLabel: SLA_RULES[priority].label, dueAt: computeDueAt(priority, now).toISOString() }
}

export interface TransferInput {
  reason: TransferReason
  queue: 'N1' | 'N2'
  summary: string
  ticketId: string | null
  confidence: number | null
  client: TicketsClient
}

/**
 * Passa a conversa para um analista. A partir daqui o agent fica pausado: o fluxo do chat
 * confere o status antes de chamar o modelo e não responde enquanto não for devolvida.
 */
export async function transferConversation(conversationId: string, input: TransferInput): Promise<ConversationView> {
  if (input.ticketId) {
    try {
      await input.client.transfer(input.ticketId, input.queue, input.summary)
    } catch {
      // Se o legado falhar, a conversa é transferida mesmo assim; o analista vê o resumo aqui.
    }
  }
  const conversation = await updateConversation(conversationId, {
    status: 'waiting_analyst',
    transfer: {
      reason: input.reason,
      summary: input.summary,
      queue: input.queue,
      at: new Date().toISOString(),
      confidence: input.confidence,
      ticketId: input.ticketId,
    },
    analystUnread: 'increment',
  })
  await appendMessage(conversationId, { role: 'system', content: `Transferida para Suporte ${input.queue}` })
  return conversation
}

// ---------- Ações do analista (console) ----------

async function loadForAnalyst(conversationId: string): Promise<ConversationView> {
  const conversation = await getConversation(conversationId)
  if (!conversation) throw new ActionError('Conversa não encontrada.')
  return conversation
}

export async function assumeConversation(conversationId: string, analyst: SessionUser): Promise<ConversationView> {
  const conversation = await loadForAnalyst(conversationId)
  if (conversation.status === 'closed') throw new ActionError('Essa conversa já foi encerrada.')
  if (conversation.status === 'with_analyst' && conversation.assignedAnalyst?.id !== analyst.id) {
    throw new ActionError(`${conversation.assignedAnalyst?.name} já está atendendo essa conversa.`)
  }
  const updated = await updateConversation(conversationId, {
    status: 'with_analyst',
    assignedAnalyst: { id: analyst.id, name: analyst.name },
    analystUnread: 'reset',
  })
  await appendMessage(conversationId, { role: 'system', content: `${analyst.name} assumiu · agent pausado` })
  return updated
}

export async function releaseToAgent(conversationId: string, analyst: SessionUser): Promise<ConversationView> {
  await loadForAnalyst(conversationId)
  const updated = await updateConversation(conversationId, { status: 'agent', assignedAnalyst: null, transfer: null })
  await appendMessage(conversationId, { role: 'system', content: `${analyst.name} devolveu a conversa ao Nexo Assist` })
  return updated
}

export async function closeConversation(conversationId: string, analyst: SessionUser): Promise<ConversationView> {
  await loadForAnalyst(conversationId)
  const updated = await updateConversation(conversationId, { status: 'closed', closedAt: new Date().toISOString() })
  await appendMessage(conversationId, { role: 'system', content: `Atendimento encerrado por ${analyst.name}` })
  return updated
}

export async function analystReply(conversationId: string, analyst: SessionUser, content: string): Promise<ChatMessage> {
  const conversation = await loadForAnalyst(conversationId)
  if (conversation.status !== 'with_analyst' || conversation.assignedAnalyst?.id !== analyst.id) {
    throw new ActionError('Assuma o atendimento para responder.')
  }
  return appendMessage(conversationId, { role: 'analyst', authorName: analyst.name, content })
}
