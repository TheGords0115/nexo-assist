import type { Blocking, Impact, Priority } from './types'

export interface PriorityInput {
  impact: Impact
  blocking: Blocking
  /** Há um compromisso no mesmo dia em risco (reunião, entrega, apresentação)? */
  sameDayDeadline: boolean
}

export interface PriorityDecision {
  priority: Priority
  /** Explicação curta, mostrada ao funcionário e no detalhe da decisão. */
  reason: string
}

/**
 * Regra de prioridade do Anexo A, aplicada em código (e não pelo modelo).
 * O modelo só classifica impacto, bloqueio e compromisso; a tabela é determinística,
 * então a mesma situação sempre recebe a mesma prioridade.
 */
export function computePriority({ impact, blocking, sameDayDeadline }: PriorityInput): PriorityDecision {
  if (blocking === 'parado' && impact !== 'pessoa') {
    return {
      priority: 'Crítica',
      reason: impact === 'empresa' ? 'parado para a empresa' : 'parado para uma equipe',
    }
  }
  if (blocking === 'parado') {
    return { priority: 'Alta', reason: 'impede você de trabalhar' }
  }
  if (sameDayDeadline && blocking !== 'sem_urgencia') {
    return { priority: 'Alta', reason: 'há um compromisso hoje em risco' }
  }
  if (blocking === 'atrapalha') {
    return { priority: 'Média', reason: 'atrapalha, mas há alternativa' }
  }
  return { priority: 'Baixa', reason: 'pedido sem urgência' }
}
