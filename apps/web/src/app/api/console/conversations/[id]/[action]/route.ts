import { NextResponse } from 'next/server'
import { z } from 'zod'
import { analystReply, assumeConversation, closeConversation, releaseToAgent } from '@/server/chat/actions'
import { HttpError, handle, requireUser } from '@/server/http'

// Ações do analista: assumir (pausa o agent), responder, devolver ao agent e encerrar.

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string; action: string }> }) => {
  const analyst = await requireUser('analyst')
  const { id, action } = await params
  switch (action) {
    case 'assume':
      return NextResponse.json({ conversation: await assumeConversation(id, analyst) })
    case 'release':
      return NextResponse.json({ conversation: await releaseToAgent(id, analyst) })
    case 'close':
      return NextResponse.json({ conversation: await closeConversation(id, analyst) })
    case 'reply': {
      const parsed = z.object({ text: z.string().trim().min(1).max(2000) }).safeParse(await req.json().catch(() => ({})))
      if (!parsed.success) throw new HttpError(400, 'Mensagem vazia.')
      return NextResponse.json({ message: await analystReply(id, analyst, parsed.data.text) })
    }
    default:
      throw new HttpError(404, 'Ação desconhecida.')
  }
})
