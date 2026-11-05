import { NextResponse } from 'next/server'
import { z } from 'zod'
import { setSession } from '@/server/auth/session'
import { HttpError, handle } from '@/server/http'
import { TicketNotFoundError, TicketsClient, TicketsUnavailableError } from '@/server/tickets/client'

// Login (Tela 1). Pelo PRD, qualquer senha vale para os funcionários dos dados de exemplo:
// o que importa é o e-mail existir no diretório do sistema de chamados.

const body = z.object({
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido.'),
  password: z.string().min(1, 'Informe a senha.'),
  remember: z.boolean().default(true),
})

export const POST = handle(async (req: Request) => {
  const parsed = body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Dados inválidos.')
  if (!parsed.data.email.endsWith('@nexo.com.br')) throw new HttpError(400, 'Use seu e-mail corporativo (@nexo.com.br).')

  try {
    const employee = await TicketsClient.fromEnv().findEmployeeByEmail(parsed.data.email)
    const user = { id: employee.id, name: employee.name, email: employee.email, role: employee.role }
    await setSession(user, parsed.data.remember)
    return NextResponse.json({ user, redirect: employee.role === 'analyst' ? '/console' : '/atendimento' })
  } catch (error) {
    if (error instanceof TicketNotFoundError) throw new HttpError(401, 'E-mail não encontrado no diretório da Nexo.')
    if (error instanceof TicketsUnavailableError) throw new HttpError(503, 'O diretório está fora do ar agora. Tente de novo em instantes.')
    throw error
  }
})
