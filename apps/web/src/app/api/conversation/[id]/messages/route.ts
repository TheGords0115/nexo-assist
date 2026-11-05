import { NextResponse } from 'next/server'
import { HttpError, handle, requireUser } from '@/server/http'
import { getConversation, listMessages } from '@/server/store/conversations'

// Usado pela tela do funcionário para buscar novidades enquanto um analista atende (polling).

export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser('employee')
  const { id } = await params
  const conversation = await getConversation(id)
  if (!conversation || conversation.employee.id !== user.id) throw new HttpError(404, 'Conversa não encontrada.')
  return NextResponse.json({ conversation, messages: await listMessages(id) })
})
