/**
 * Tipos de domínio compartilhados entre o serviço de chamados e a aplicação web.
 * Os valores seguem o Anexo A do PRD (regras do service desk).
 */

export const TICKET_TYPES = ['INC', 'REQ'] as const
export type TicketType = (typeof TICKET_TYPES)[number]

export const CATEGORIES = ['Acesso', 'Rede e VPN', 'Hardware', 'Software', 'E-mail', 'Outros'] as const
export type Category = (typeof CATEGORIES)[number]

export const PRIORITIES = ['Crítica', 'Alta', 'Média', 'Baixa'] as const
export type Priority = (typeof PRIORITIES)[number]

/** Status do chamado no sistema legado. */
export const TICKET_STATUSES = [
  'Aberto',
  'Em andamento',
  'Aguardando analista',
  'Aprovado',
  'Resolvido',
  'Fechado',
] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

/** Status em que o chamado ainda está "vivo" e o prazo conta. */
export const ACTIVE_STATUSES: readonly TicketStatus[] = ['Aberto', 'Em andamento', 'Aguardando analista', 'Aprovado']

export const IMPACTS = ['pessoa', 'equipe', 'empresa'] as const
/** Impacto: quantas pessoas são afetadas. */
export type Impact = (typeof IMPACTS)[number]

export const BLOCKINGS = ['parado', 'atrapalha', 'sem_urgencia'] as const
/**
 * Quanto o problema bloqueia o trabalho:
 * - parado: não consegue trabalhar (ou o serviço parou)
 * - atrapalha: atrapalha, mas há alternativa
 * - sem_urgencia: pedido ou melhoria sem urgência
 */
export type Blocking = (typeof BLOCKINGS)[number]

export type EmployeeRole = 'employee' | 'analyst'

export interface Employee {
  id: string
  name: string
  email: string
  role: EmployeeRole
  department: string
  /** Sistema operacional do equipamento principal (ajuda o agent a aplicar artigos como o do erro 809). */
  device: string
  /** Para analistas: nível de suporte. */
  supportLevel?: 'N1' | 'N2'
}

export interface TicketUpdate {
  at: string
  author: string
  note: string
}

export interface Ticket {
  id: string
  type: TicketType
  title: string
  description: string
  category: Category
  priority: Priority
  status: TicketStatus
  requesterId: string
  affected: string
  createdAt: string
  /** Última atividade do service desk (criação, atualização ou mudança de status). O prazo conta a partir daqui. */
  lastActivityAt: string
  resolvedAt: string | null
  assignedQueue: 'N1' | 'N2' | null
  updates: TicketUpdate[]
}

/** Chamado com prazo calculado (o que o serviço devolve para quem consulta). */
export interface TicketView extends Ticket {
  dueAt: string | null
  overdue: boolean
  /** Para chamados resolvidos: se ainda pode ser reaberto (resolvido há até 7 dias). */
  reopenable: boolean
}

export interface NewTicketInput {
  type: TicketType
  title: string
  description: string
  category: Category
  priority: Priority
  affected: string
}
