import { describe, expect, it } from 'vitest'
import { addBusinessHours, computeDueAt, computePriority, isReopenable, withSla, type Ticket } from '../src'

describe('computePriority (Anexo A)', () => {
  it('parado para uma equipe ou para a empresa é Crítica', () => {
    expect(computePriority({ impact: 'equipe', blocking: 'parado', sameDayDeadline: false }).priority).toBe('Crítica')
    expect(computePriority({ impact: 'empresa', blocking: 'parado', sameDayDeadline: false }).priority).toBe('Crítica')
  })

  it('uma pessoa impedida de trabalhar é Alta', () => {
    expect(computePriority({ impact: 'pessoa', blocking: 'parado', sameDayDeadline: false }).priority).toBe('Alta')
  })

  it('compromisso no mesmo dia sobe para Alta, mesmo com alternativa', () => {
    const decision = computePriority({ impact: 'pessoa', blocking: 'atrapalha', sameDayDeadline: true })
    expect(decision).toEqual({ priority: 'Alta', reason: 'há um compromisso hoje em risco' })
  })

  it('atrapalha mas há alternativa é Média', () => {
    expect(computePriority({ impact: 'pessoa', blocking: 'atrapalha', sameDayDeadline: false }).priority).toBe('Média')
  })

  it('pedido sem urgência é Baixa, mesmo que alguém cite um compromisso', () => {
    expect(computePriority({ impact: 'pessoa', blocking: 'sem_urgencia', sameDayDeadline: true }).priority).toBe('Baixa')
  })
})

// Datas em UTC; Brasília = UTC-3. 2026-11-05 é uma quinta-feira.
const brt = (isoLocal: string) => new Date(`${isoLocal}-03:00`)

describe('prazos em horário útil (seg-sex, 8h-18h)', () => {
  it('Alta: 4 horas úteis dentro do mesmo dia', () => {
    expect(addBusinessHours(brt('2026-11-05T09:43:00'), 4)).toEqual(brt('2026-11-05T13:43:00'))
  })

  it('Alta aberta às 16h vence às 10h do dia útil seguinte', () => {
    expect(computeDueAt('Alta', brt('2026-11-05T16:00:00'))).toEqual(brt('2026-11-06T10:00:00'))
  })

  it('Alta aberta na sexta às 17h pula o fim de semana', () => {
    expect(computeDueAt('Alta', brt('2026-11-06T17:00:00'))).toEqual(brt('2026-11-09T11:00:00'))
  })

  it('aberto fora do expediente começa a contar às 8h', () => {
    expect(computeDueAt('Alta', brt('2026-11-05T22:30:00'))).toEqual(brt('2026-11-06T12:00:00'))
  })

  it('Média: 3 dias úteis', () => {
    expect(computeDueAt('Média', brt('2026-11-05T14:20:00'))).toEqual(brt('2026-11-10T14:20:00'))
  })

  it('Crítica: 1 hora corrida, mesmo à noite (plantão 24h)', () => {
    expect(computeDueAt('Crítica', brt('2026-11-07T23:30:00'))).toEqual(brt('2026-11-08T00:30:00'))
  })
})

const baseTicket: Ticket = {
  id: 'INC-1',
  type: 'INC',
  title: 'Notebook lento',
  description: '',
  category: 'Hardware',
  priority: 'Média',
  status: 'Aguardando analista',
  requesterId: 'emp-ana',
  affected: 'Somente o solicitante',
  createdAt: brt('2026-10-16T14:20:00').toISOString(),
  lastActivityAt: brt('2026-10-30T10:00:00').toISOString(),
  resolvedAt: null,
  assignedQueue: 'N1',
  updates: [],
}

describe('withSla', () => {
  it('marca como vencido quando passou o prazo desde a última atividade', () => {
    const view = withSla(baseTicket, brt('2026-11-05T10:00:00'))
    expect(view.dueAt).toBe(brt('2026-11-04T10:00:00').toISOString())
    expect(view.overdue).toBe(true)
  })

  it('chamado resolvido não tem prazo', () => {
    const view = withSla({ ...baseTicket, status: 'Resolvido', resolvedAt: brt('2026-11-01T10:00:00').toISOString() }, brt('2026-11-05T10:00:00'))
    expect(view.dueAt).toBeNull()
    expect(view.overdue).toBe(false)
  })
})

describe('reabertura (resolvido há até 7 dias)', () => {
  const now = brt('2026-11-05T10:00:00')
  it('permite até 7 dias', () => {
    expect(isReopenable({ status: 'Resolvido', resolvedAt: brt('2026-10-30T10:00:00').toISOString() }, now)).toBe(true)
  })
  it('não permite depois de 7 dias', () => {
    expect(isReopenable({ status: 'Resolvido', resolvedAt: brt('2026-10-28T09:00:00').toISOString() }, now)).toBe(false)
  })
  it('só vale para chamados resolvidos', () => {
    expect(isReopenable({ status: 'Em andamento', resolvedAt: null }, now)).toBe(false)
  })
})
