import { ACTIVE_STATUSES, type Priority, type Ticket, type TicketView } from './types'

/**
 * Prazos do Anexo A. "Úteis" seguem o horário do service desk: segunda a sexta, das 8h às 18h
 * (horário de Brasília). Chamados críticos têm plantão 24h, então o prazo de 1 hora é corrido.
 */
export const SLA_RULES: Record<Priority, { label: string; kind: 'wall' | 'business-hours' | 'business-days'; amount: number }> = {
  Crítica: { label: '1 hora', kind: 'wall', amount: 1 },
  Alta: { label: '4 horas úteis', kind: 'business-hours', amount: 4 },
  Média: { label: '3 dias úteis', kind: 'business-days', amount: 3 },
  Baixa: { label: '5 dias úteis', kind: 'business-days', amount: 5 },
}

export const REOPEN_WINDOW_DAYS = 7

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** Brasília não tem horário de verão desde 2019: UTC-3 fixo. */
const BRT_OFFSET = -3 * HOUR
const OPEN_HOUR = 8
const CLOSE_HOUR = 18

/** Converte um instante para "relógio de parede" de Brasília, representado como Date em UTC. */
function toBrt(date: Date): Date {
  return new Date(date.getTime() + BRT_OFFSET)
}
function fromBrt(date: Date): Date {
  return new Date(date.getTime() - BRT_OFFSET)
}

function isBusinessDay(brt: Date): boolean {
  const day = brt.getUTCDay()
  return day !== 0 && day !== 6
}

/** Avança para o próximo instante dentro do expediente (ou mantém, se já estiver dentro). */
function clampToBusinessTime(brt: Date): Date {
  const d = new Date(brt)
  for (let i = 0; i < 14; i++) {
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60
    if (isBusinessDay(d) && hour >= OPEN_HOUR && hour < CLOSE_HOUR) return d
    if (isBusinessDay(d) && hour < OPEN_HOUR) {
      d.setUTCHours(OPEN_HOUR, 0, 0, 0)
      return d
    }
    d.setUTCDate(d.getUTCDate() + 1)
    d.setUTCHours(OPEN_HOUR, 0, 0, 0)
  }
  return d
}

/** Soma horas úteis a partir de um instante. */
export function addBusinessHours(from: Date, hours: number): Date {
  let cursor = clampToBusinessTime(toBrt(from))
  let remaining = hours * HOUR
  while (remaining > 0) {
    const endOfDay = new Date(cursor)
    endOfDay.setUTCHours(CLOSE_HOUR, 0, 0, 0)
    const available = endOfDay.getTime() - cursor.getTime()
    if (remaining <= available) {
      cursor = new Date(cursor.getTime() + remaining)
      remaining = 0
    } else {
      remaining -= available
      cursor = clampToBusinessTime(new Date(endOfDay.getTime() + 1))
    }
  }
  return fromBrt(cursor)
}

/** Soma dias úteis: o prazo vence no mesmo horário, N dias úteis depois. */
export function addBusinessDays(from: Date, days: number): Date {
  return addBusinessHours(from, days * (CLOSE_HOUR - OPEN_HOUR))
}

export function computeDueAt(priority: Priority, from: Date): Date {
  const rule = SLA_RULES[priority]
  switch (rule.kind) {
    case 'wall':
      return new Date(from.getTime() + rule.amount * HOUR)
    case 'business-hours':
      return addBusinessHours(from, rule.amount)
    case 'business-days':
      return addBusinessDays(from, rule.amount)
  }
}

export function isReopenable(ticket: Pick<Ticket, 'status' | 'resolvedAt'>, now: Date): boolean {
  if (ticket.status !== 'Resolvido' || !ticket.resolvedAt) return false
  return now.getTime() - new Date(ticket.resolvedAt).getTime() <= REOPEN_WINDOW_DAYS * DAY
}

/**
 * Calcula prazo e atraso de um chamado. O prazo vale para a primeira resposta e para cada
 * atualização, por isso conta a partir da última atividade do service desk.
 */
export function withSla(ticket: Ticket, now: Date = new Date()): TicketView {
  const active = ACTIVE_STATUSES.includes(ticket.status)
  const dueAt = active ? computeDueAt(ticket.priority, new Date(ticket.lastActivityAt)) : null
  return {
    ...ticket,
    dueAt: dueAt ? dueAt.toISOString() : null,
    overdue: dueAt ? now.getTime() > dueAt.getTime() : false,
    reopenable: isReopenable(ticket, now),
  }
}
