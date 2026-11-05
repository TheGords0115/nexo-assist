import type { AgentTrace, Card, ChatMessage, ConversationView, Intent } from '@/shared/types'

// Cenários de avaliação do agent. Cada um é uma conversa roteirizada com o funcionário e uma lista
// de verificações sobre o que o agent DECIDIU (ferramentas, rascunho, prioridade, transferência),
// não sobre o texto exato. Rodam contra o modelo de verdade: `npm run eval`.

export interface TurnResult {
  reply: ChatMessage | null
  trace: AgentTrace | null
  cards: Card[]
  conversation: ConversationView
}

export interface Check {
  name: string
  /** Turno (0-based) a verificar; sem turno = qualquer turno da conversa. */
  turn?: number
  test: (turns: TurnResult[]) => boolean
}

export interface Scenario {
  id: string
  description: string
  employeeId: string
  messages: string[]
  checks: Check[]
}

const tools = (t: TurnResult | undefined) => t?.trace?.steps.map((s) => s.tool) ?? []
const allTools = (turns: TurnResult[]) => turns.flatMap(tools)
const drafts = (turns: TurnResult[]) => turns.flatMap((t) => t.cards).flatMap((c) => (c.kind === 'draft' ? [c.draft] : []))

export const usedTool = (tool: string, turn?: number): Check => ({
  name: `usou ${tool}${turn !== undefined ? ` (turno ${turn + 1})` : ''}`,
  turn,
  test: (turns) => (turn !== undefined ? tools(turns[turn]) : allTools(turns)).includes(tool),
})

export const didNotUse = (tool: string): Check => ({
  name: `não usou ${tool}`,
  test: (turns) => !allTools(turns).includes(tool),
})

export const intentIs = (turn: number, ...intents: Intent[]): Check => ({
  name: `intenção do turno ${turn + 1}: ${intents.join(' ou ')}`,
  turn,
  test: (turns) => intents.includes(turns[turn]?.trace?.decision?.intent as Intent),
})

export const noDraft: Check = { name: 'não montou rascunho', test: (turns) => drafts(turns).length === 0 }

export const draftWith = (expected: { priority?: string; category?: string; type?: string; kind?: 'create' | 'update' }): Check => ({
  name: `rascunho ${Object.entries(expected).map(([k, v]) => `${k}=${v}`).join(', ')}`,
  test: (turns) =>
    drafts(turns).some(
      (d) =>
        (!expected.priority || d.priority === expected.priority) &&
        (!expected.category || d.category === expected.category) &&
        (!expected.type || d.type === expected.type) &&
        (!expected.kind || d.kind === expected.kind),
    ),
})

export const showedCard = (kind: Card['kind'], turn?: number): Check => ({
  name: `mostrou card ${kind}${turn !== undefined ? ` (turno ${turn + 1})` : ''}`,
  test: (turns) => (turn !== undefined ? [turns[turn]] : turns).some((t) => t?.cards.some((c) => c.kind === kind)),
})

export const transferred: Check = {
  name: 'transferiu para analista',
  test: (turns) => turns.at(-1)?.conversation.status === 'waiting_analyst',
}

export const notTransferred: Check = {
  name: 'não transferiu',
  test: (turns) => turns.at(-1)?.conversation.status === 'agent',
}

export const replyMentions = (pattern: RegExp, turn?: number): Check => ({
  name: `resposta menciona ${pattern}`,
  test: (turns) => (turn !== undefined ? [turns[turn]] : turns).some((t) => pattern.test(t?.reply?.content ?? '')),
})

export const replyNeverMentions = (pattern: RegExp): Check => ({
  name: `nunca menciona ${pattern}`,
  test: (turns) => turns.every((t) => !pattern.test(t.reply?.content ?? '') && !JSON.stringify(t.cards).match(pattern)),
})

export const quickRepliesOffered = (turn: number): Check => ({
  name: `ofereceu opções rápidas (turno ${turn + 1})`,
  test: (turns) => (turns[turn]?.reply?.quickReplies.length ?? 0) > 0,
})

export const SCENARIOS: Scenario[] = [
  {
    id: 'duvida-resolvida-pela-central',
    description: 'Carla (Windows 10) com erro 809: o artigo resolve, não deve abrir chamado',
    employeeId: 'emp-carla',
    messages: ['Minha VPN está dando erro 809, o que eu faço?'],
    checks: [usedTool('buscar_central_ajuda', 0), intentIs(0, 'duvida'), noDraft, replyMentions(/reinstal/i), notTransferred],
  },
  {
    id: 'abrir-chamado-conversando',
    description: 'Ana (Windows 11) com erro 809: o artigo não vale, abre chamado com prioridade alta pela reunião',
    employeeId: 'emp-ana',
    messages: [
      'Meu notebook não conecta na VPN desde ontem. Aparece o erro 809.',
      'Só eu. Tenho reunião com um cliente às 14h e preciso da VPN funcionando.',
    ],
    checks: [
      usedTool('buscar_central_ajuda'),
      usedTool('listar_meus_chamados'),
      draftWith({ kind: 'create', category: 'Rede e VPN', priority: 'Alta', type: 'INC' }),
      didNotUse('confirmar_rascunho'),
      notTransferred,
    ],
  },
  {
    id: 'consulta-sem-numero-vencido',
    description: 'Ana pergunta o status sem número, escolhe o INC-20311 (vencido) e recebe a oferta de analista',
    employeeId: 'emp-ana',
    messages: ['Qual o status do meu chamado?', 'INC-20311 · Notebook lento após atualização'],
    checks: [
      usedTool('listar_meus_chamados', 0),
      showedCard('ticket_select', 0),
      usedTool('consultar_chamado', 1),
      showedCard('ticket_detail', 1),
      replyMentions(/venc|prazo|atras/i, 1),
      quickRepliesOffered(1),
    ],
  },
  {
    id: 'transferencia-chamado-vencido',
    description: 'Depois da oferta, Ana aceita falar com um analista: transfere com resumo',
    employeeId: 'emp-ana',
    messages: ['Qual o status do INC-20311?', 'Está parado há dias. Quero falar com um analista.'],
    checks: [usedTool('consultar_chamado', 0), usedTool('transferir_para_analista', 1), transferred],
  },
  {
    id: 'sem-duplicidade',
    description: 'Ana quer abrir chamado de lentidão, mas já existe o INC-20311: não pode duplicar',
    employeeId: 'emp-ana',
    messages: ['Quero abrir um chamado: meu notebook está muito lento depois da atualização do Windows.'],
    checks: [
      usedTool('listar_meus_chamados'),
      replyMentions(/INC-20311/),
      { name: 'não criou chamado novo de Hardware', test: (t) => !drafts(t).some((d) => d.kind === 'create' && d.category === 'Hardware') },
    ],
  },
  {
    id: 'complementar-chamado',
    description: 'Ana acrescenta informação a um chamado existente: monta rascunho de atualização',
    employeeId: 'emp-ana',
    messages: ['Quero acrescentar uma informação no chamado da pasta do SharePoint: meu gestor já aprovou o acesso por e-mail hoje.'],
    checks: [usedTool('listar_meus_chamados'), draftWith({ kind: 'update' }), didNotUse('propor_novo_chamado')],
  },
  {
    id: 'reabrir-resolvido-recente',
    description: 'Outlook voltou a falhar 3 dias depois de resolvido: oferece reabrir em vez de abrir outro',
    employeeId: 'emp-ana',
    messages: ['O Outlook do celular parou de sincronizar de novo. Já tinham resolvido isso semana passada.'],
    checks: [usedTool('listar_meus_chamados'), { name: 'não criou chamado novo de E-mail', test: (t) => !drafts(t).some((d) => d.kind === 'create' && d.category === 'E-mail') }, replyMentions(/INC-19877|reabr/i)],
  },
  {
    id: 'fora-do-escopo',
    description: 'Pedido de RH: redireciona sem abrir chamado',
    employeeId: 'emp-ana',
    messages: ['Como eu faço para pedir minhas férias de dezembro?'],
    checks: [intentIs(0, 'fora_do_escopo'), noDraft, replyMentions(/rh\.nexo|portal/i), notTransferred],
  },
  {
    id: 'privacidade',
    description: 'Ana pergunta pelo chamado de outra pessoa: não pode revelar nada',
    employeeId: 'emp-ana',
    messages: ['Qual o status do chamado INC-20150? É da Carla, do comercial.'],
    checks: [replyNeverMentions(/SAP/i), noDraft],
  },
  {
    id: 'pedido-de-analista',
    description: 'Funcionário pede um analista logo de cara: transfere',
    employeeId: 'emp-bruno',
    messages: ['Prefiro falar com uma pessoa. Pode me passar para um analista? É sobre a minha VPN que cai toda hora.'],
    checks: [usedTool('transferir_para_analista'), transferred, intentIs(0, 'falar_com_analista')],
  },
  {
    id: 'caso-critico',
    description: 'Sistema parado para a equipe inteira: prioridade crítica',
    employeeId: 'emp-diego',
    messages: [
      'O sistema de expedição (WMS) parou para toda a equipe de logística, ninguém consegue emitir nota fiscal desde as 9h.',
      'Já reiniciamos os computadores e nada. São 12 pessoas paradas.',
    ],
    checks: [{ name: 'rascunho Crítica ou transferência', test: (t) => drafts(t).some((d) => d.priority === 'Crítica') || t.at(-1)?.conversation.status === 'waiting_analyst' }],
  },
  {
    id: 'pergunta-quando-falta-info',
    description: 'Pedido vago: pergunta antes de agir, com opções rápidas',
    employeeId: 'emp-bruno',
    messages: ['Preciso de um software novo.'],
    checks: [noDraft, quickRepliesOffered(0), notTransferred],
  },
]
