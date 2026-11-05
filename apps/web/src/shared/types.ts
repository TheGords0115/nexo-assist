/**
 * Contrato entre o servidor e a interface. Tudo o que a tela mostra (mensagens, cards e o detalhe
 * de cada decisão do agent) passa por estes tipos.
 */
import type { Category, Employee, Priority, TicketStatus, TicketType } from '@nexo/domain'

export type MessageRole = 'user' | 'assistant' | 'analyst' | 'system'

export const INTENTS = [
  'duvida',
  'consultar_chamado',
  'complementar_chamado',
  'abrir_chamado',
  'confirmar_rascunho',
  'falar_com_analista',
  'fora_do_escopo',
  'conversa',
] as const
export type Intent = (typeof INTENTS)[number]

export const INTENT_LABELS: Record<Intent, string> = {
  duvida: 'Tirar uma dúvida',
  consultar_chamado: 'Consultar chamado',
  complementar_chamado: 'Complementar chamado',
  abrir_chamado: 'Abrir chamado',
  confirmar_rascunho: 'Confirmar rascunho',
  falar_com_analista: 'Falar com analista',
  fora_do_escopo: 'Fora do escopo de TI',
  conversa: 'Conversa',
}

/** O que o agent declarou sobre a própria decisão neste turno. */
export interface Decision {
  understood: string
  intent: Intent
  action: string
  /** 0 a 1. Abaixo do limite, o sistema transfere para um analista. */
  confidence: number
  reasoning: string
  rulesApplied: string[]
}

/** Uma ação do agent no turno (uma chamada de ferramenta), com o que entrou e o que saiu. */
export interface TraceStep {
  tool: string
  /** Rótulo no passado, como aparece acima da resposta: "consultou seus chamados". */
  label: string
  input: Record<string, unknown>
  /** Resumo legível do resultado. */
  output: string
  ok: boolean
  durationMs: number
  /** Tentativas extras feitas por causa da instabilidade do sistema de chamados. */
  retries: number
}

/** Regras aplicadas pelo próprio sistema (em código), independentemente do modelo. */
export interface Guardrail {
  rule: string
  detail: string
}

export interface AgentTrace {
  steps: TraceStep[]
  decision: Decision | null
  guardrails: Guardrail[]
  model: string
  latencyMs: number
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number }
  /** Custo estimado do turno em US$, pela tabela de preço do modelo. */
  costUsd: number | null
}

export interface TicketSummary {
  id: string
  type: TicketType
  title: string
  category: Category
  priority: Priority
  status: TicketStatus
  createdAt: string
  lastActivityAt: string
  dueAt: string | null
  overdue: boolean
  reopenable: boolean
}

export interface TicketDetail extends TicketSummary {
  description: string
  affected: string
  assignedQueue: 'N1' | 'N2' | null
  lastUpdate: { at: string; author: string; note: string } | null
}

export type DraftStatus = 'pending' | 'confirmed' | 'cancelled' | 'superseded' | 'failed'

export interface DraftView {
  id: string
  kind: 'create' | 'update'
  status: DraftStatus
  /** Chamado alvo (atualização) ou criado (após confirmar). */
  ticketId: string | null
  type: TicketType
  title: string
  description: string
  category: Category
  priority: Priority
  priorityReason: string
  affected: string
  slaLabel: string
  dueAt: string
  /** Só para atualização. */
  note?: string
  reopen?: boolean
  error?: string
}

export type Card =
  | { kind: 'ticket_select'; tickets: TicketSummary[] }
  | { kind: 'ticket_detail'; ticket: TicketDetail }
  | { kind: 'draft'; draft: DraftView }
  | { kind: 'articles'; articles: { id: string; title: string }[] }
  | { kind: 'transfer'; queue: 'N1' | 'N2'; summary: string }

export interface ChatMessage {
  id: string
  role: MessageRole
  authorName: string | null
  content: string
  createdAt: string
  cards: Card[]
  quickReplies: string[]
  trace: AgentTrace | null
}

export type ConversationStatus = 'agent' | 'waiting_analyst' | 'with_analyst' | 'closed'

export type TransferReason = 'pedido_do_funcionario' | 'caso_critico' | 'chamado_vencido' | 'baixa_confianca'

export const TRANSFER_REASON_LABELS: Record<TransferReason, string> = {
  pedido_do_funcionario: 'Funcionário pediu um analista',
  caso_critico: 'Caso crítico',
  chamado_vencido: 'Chamado com prazo vencido',
  baixa_confianca: 'Agent pediu ajuda',
}

export interface ConversationView {
  id: string
  employee: Pick<Employee, 'id' | 'name' | 'email' | 'department' | 'device'>
  status: ConversationStatus
  assignedAnalyst: { id: string; name: string } | null
  transfer: {
    reason: TransferReason
    summary: string
    queue: 'N1' | 'N2'
    at: string
    confidence: number | null
    ticketId: string | null
  } | null
  userMessageCount: number
  messageLimit: number
  createdAt: string
  updatedAt: string
  closedAt: string | null
  /** Encerrada sem passar por analista. */
  resolvedByAgent: boolean
}

export interface ConversationListItem extends ConversationView {
  lastMessage: { role: MessageRole; content: string; at: string } | null
  unreadForAnalyst: number
}

/** Eventos do stream de resposta do agent (Server-Sent Events). */
export type ChatStreamEvent =
  | { type: 'user_message'; message: ChatMessage }
  | { type: 'step_start'; tool: string; label: string }
  | { type: 'step_end'; step: TraceStep }
  | { type: 'delta'; text: string }
  | { type: 'message'; message: ChatMessage }
  | { type: 'conversation'; conversation: ConversationView }
  | { type: 'paused'; reason: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

export interface SessionUser {
  id: string
  name: string
  email: string
  role: 'employee' | 'analyst'
}
