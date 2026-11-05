import { z } from 'zod'
import type { ChatStreamEvent } from '@/shared/types'
import { runTurn } from '@/server/chat/turn'
import { HttpError, handle, requireUser } from '@/server/http'
import { TicketsClient, TicketsUnavailableError } from '@/server/tickets/client'

// Envia uma mensagem do funcionário e devolve a resposta do agent em tempo real (Server-Sent Events):
// primeiro os passos ("consultou seus chamados"), depois o texto aos poucos e, no fim, a mensagem
// completa com cards e o detalhe da decisão.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const body = z.object({
  conversationId: z.string().uuid(),
  text: z.string().trim().min(1).max(2000),
})

export const POST = handle(async (req: Request) => {
  const user = await requireUser('employee')
  const parsed = body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) throw new HttpError(400, 'Mensagem inválida.')

  let employee
  try {
    employee = await TicketsClient.fromEnv(user.id).getEmployee(user.id)
  } catch (error) {
    if (error instanceof TicketsUnavailableError) throw new HttpError(503, 'Sistema fora do ar. Tente de novo em instantes.')
    throw error
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ChatStreamEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      try {
        await runTurn({ conversationId: parsed.data.conversationId, employee, text: parsed.data.text, emit })
      } catch (error) {
        console.error('[nexo] erro no chat', error)
        emit({ type: 'error', message: 'Não consegui responder agora. Tente de novo.' })
      } finally {
        emit({ type: 'done' })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  })
})
