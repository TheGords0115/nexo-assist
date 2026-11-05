import { RequestContext } from '@mastra/core/request-context'
import type { Employee } from '@nexo/domain'
import type { Card, ConversationView, Guardrail, TraceStep } from '@/shared/types'
import type { TicketsClient } from '@/server/tickets/client'

// Estado de um turno do agent (uma mensagem do funcionário). Vai para as tools pelo RequestContext
// do Mastra. Ponto importante de segurança: o funcionário e o cliente do serviço de chamados vêm
// daqui, montados a partir da sessão. O modelo nunca informa "de quem" são os chamados.

export interface TurnState {
  employee: Employee
  conversationId: string
  /** seq da mensagem do funcionário que abriu este turno. */
  userSeq: number
  client: TicketsClient
  /** Cards que vão junto da resposta (gerados pelas tools a partir de dados reais, nunca pelo modelo). */
  cards: Card[]
  /** Ações do turno, na ordem em que aconteceram. */
  steps: TraceStep[]
  /** Regras aplicadas em código durante o turno. */
  guardrails: Guardrail[]
  /** Preenchido quando uma tool transfere a conversa. */
  transferred: ConversationView | null
  /** Avisa a interface que uma tool começou (para mostrar "consultando seus chamados..."). */
  onStepStart?: (tool: string) => void
}

const KEY = 'turn'

export function createTurnContext(state: TurnState): RequestContext {
  const ctx = new RequestContext()
  ctx.set(KEY, state)
  return ctx
}

export function getTurn(ctx: { requestContext?: RequestContext } | undefined): TurnState {
  const state = ctx?.requestContext?.get(KEY) as TurnState | undefined
  if (!state) throw new Error('Tool chamada fora de um turno do Nexo Assist.')
  return state
}
