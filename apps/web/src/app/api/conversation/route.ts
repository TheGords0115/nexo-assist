import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/server/http'
import { TicketsClient } from '@/server/tickets/client'
import { createConversation, findOpenConversation, listMessages } from '@/server/store/conversations'

// GET: conversa em aberto do funcionário com o histórico ("voltar outro dia e continuar de onde parei").
// POST: começa uma conversa nova (ex.: depois de atingir o limite de mensagens).

export const GET = handle(async () => {
  const user = await requireUser('employee')
  const conversation = await findOpenConversation(user.id)
  if (!conversation) return NextResponse.json({ conversation: null, messages: [] })
  return NextResponse.json({ conversation, messages: await listMessages(conversation.id) })
})

export const POST = handle(async () => {
  const user = await requireUser('employee')
  const employee = await TicketsClient.fromEnv(user.id).getEmployee(user.id)
  const conversation = await createConversation(employee)
  return NextResponse.json({ conversation, messages: [] })
})
