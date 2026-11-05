import { NextResponse } from 'next/server'
import type { TicketView } from '@nexo/domain'
import { toSummary } from '@/server/chat/tickets-view'
import { HttpError, handle, requireUser } from '@/server/http'
import { getConversation, listMessages } from '@/server/store/conversations'
import { TicketsClient } from '@/server/tickets/client'

// Detalhe de uma conversa para o analista: histórico completo (com as decisões do agent) e o
// painel "Chamados do funcionário". O analista consulta em nome próprio (perfil analyst no serviço).

export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const analyst = await requireUser('analyst')
  const { id } = await params
  const conversation = await getConversation(id)
  if (!conversation) throw new HttpError(404, 'Conversa não encontrada.')

  let tickets: ReturnType<typeof toSummary>[] = []
  let ticketsError: string | null = null
  try {
    const all: TicketView[] = await TicketsClient.fromEnv(analyst.id).listTickets({ requesterId: conversation.employee.id, scope: 'all' })
    tickets = all.map(toSummary)
  } catch {
    ticketsError = 'Sistema de chamados indisponível no momento.'
  }
  return NextResponse.json({ conversation, messages: await listMessages(id), tickets, ticketsError })
})
