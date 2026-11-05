import { NextResponse } from 'next/server'
import { cancelDraft, confirmDraft } from '@/server/chat/actions'
import { HttpError, handle, requireUser } from '@/server/http'
import { TicketsClient } from '@/server/tickets/client'

// Botões do card de rascunho: Confirmar e Cancelar. Confirmar é o único caminho, além da tool
// confirmar_rascunho, que cria ou atualiza um chamado de verdade.

export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string; action: string }> }) => {
  const user = await requireUser('employee')
  const { id, action } = await params
  if (action === 'confirm') {
    const result = await confirmDraft(id, user, TicketsClient.fromEnv(user.id))
    return NextResponse.json(result)
  }
  if (action === 'cancel') {
    return NextResponse.json({ draft: await cancelDraft(id, user) })
  }
  throw new HttpError(404, 'Ação desconhecida.')
})
