import type { TicketView } from '@nexo/domain'
import type { TicketDetail, TicketSummary } from '@/shared/types'

// Converte o chamado do serviço legado para o formato que a tela usa nos cards.

export function toSummary(t: TicketView): TicketSummary {
  return {
    id: t.id,
    type: t.type,
    title: t.title,
    category: t.category,
    priority: t.priority,
    status: t.status,
    createdAt: t.createdAt,
    lastActivityAt: t.lastActivityAt,
    dueAt: t.dueAt,
    overdue: t.overdue,
    reopenable: t.reopenable,
  }
}

export function toDetail(t: TicketView): TicketDetail {
  const last = t.updates.at(-1) ?? null
  return {
    ...toSummary(t),
    description: t.description,
    affected: t.affected,
    assignedQueue: t.assignedQueue,
    lastUpdate: last,
  }
}
