import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  ACTIVE_STATUSES,
  CATEGORIES,
  PRIORITIES,
  TICKET_TYPES,
  isReopenable,
  withSla,
  type Employee,
  type Ticket,
} from '@nexo/domain'
import { nextTicketId, rowToEmployee, rowToTicket, upsertTicket, type Db } from './db'
import type { Chaos } from './chaos'

export interface AppOptions {
  db: Db
  chaos: Chaos
  serviceKey: string
  now?: () => Date
  logger?: boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    actor?: Employee
  }
}

const newTicketBody = z.object({
  type: z.enum(TICKET_TYPES),
  title: z.string().trim().min(5).max(120),
  description: z.string().trim().min(10).max(2000),
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  affected: z.string().trim().min(2).max(120),
})

const updateBody = z.object({
  note: z.string().trim().min(3).max(2000),
  reopen: z.boolean().default(false),
})

const transferBody = z.object({
  queue: z.enum(['N1', 'N2']),
  summary: z.string().trim().min(10).max(2000),
})

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Serviço de chamados simulado (o "sistema legado"). Fica separado do agent: a aplicação web
 * só conversa com ele por HTTP, com uma chave de serviço e a identidade de quem está agindo.
 * A regra de privacidade é aplicada aqui, na fonte dos dados, e não só no agent.
 */
export function buildApp({ db, chaos, serviceKey, now = () => new Date(), logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger })

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.status).send({ error: error.code, message: error.message })
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: 'invalid_body', message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
    }
    app.log.error(error)
    return reply.status(500).send({ error: 'internal', message: 'Erro interno no serviço de chamados.' })
  })

  app.get('/health', async () => ({ ok: true }))

  // Instabilidade simulada + autenticação de serviço em todas as rotas de negócio.
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return
    if (req.headers['x-service-key'] !== serviceKey) {
      return reply.status(401).send({ error: 'unauthorized', message: 'Chave de serviço inválida.' })
    }
    const { fail, latencyMs } = chaos.roll()
    if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs))
    if (fail) {
      return reply.status(503).send({ error: 'unavailable', message: 'Sistema de chamados temporariamente indisponível.' })
    }
  })

  async function requireActor(req: FastifyRequest): Promise<Employee> {
    const id = req.headers['x-actor-id']
    if (typeof id !== 'string' || !id) throw new HttpError(401, 'no_actor', 'Informe quem está agindo (x-actor-id).')
    const res = await db.execute({ sql: 'SELECT * FROM employees WHERE id = ?', args: [id] })
    const row = res.rows[0]
    if (!row) throw new HttpError(401, 'unknown_actor', 'Funcionário não encontrado.')
    return rowToEmployee(row)
  }

  /** Busca o chamado e garante que o ator pode vê-lo. Para quem não pode, o chamado "não existe". */
  async function loadTicketFor(actor: Employee, id: string): Promise<Ticket> {
    const res = await db.execute({ sql: 'SELECT * FROM tickets WHERE id = ?', args: [id.toUpperCase()] })
    const row = res.rows[0]
    const ticket = row ? rowToTicket(row) : null
    if (!ticket || (actor.role !== 'analyst' && ticket.requesterId !== actor.id)) {
      throw new HttpError(404, 'not_found', `Chamado ${id} não encontrado.`)
    }
    return ticket
  }

  app.get('/employees/by-email', async (req) => {
    const email = String((req.query as { email?: string }).email ?? '').trim().toLowerCase()
    const res = await db.execute({ sql: 'SELECT * FROM employees WHERE lower(email) = ?', args: [email] })
    const row = res.rows[0]
    if (!row) throw new HttpError(404, 'not_found', 'Funcionário não encontrado.')
    return rowToEmployee(row)
  })

  app.get('/employees/:id', async (req) => {
    const actor = await requireActor(req)
    const { id } = req.params as { id: string }
    if (actor.role !== 'analyst' && actor.id !== id) throw new HttpError(404, 'not_found', 'Funcionário não encontrado.')
    const res = await db.execute({ sql: 'SELECT * FROM employees WHERE id = ?', args: [id] })
    const row = res.rows[0]
    if (!row) throw new HttpError(404, 'not_found', 'Funcionário não encontrado.')
    return rowToEmployee(row)
  })

  app.get('/tickets', async (req) => {
    const actor = await requireActor(req)
    const query = req.query as { requesterId?: string; scope?: string }
    const requesterId = query.requesterId ?? actor.id
    if (actor.role !== 'analyst' && requesterId !== actor.id) {
      throw new HttpError(403, 'forbidden', 'Você só pode consultar os seus chamados.')
    }
    const res = await db.execute({
      sql: 'SELECT * FROM tickets WHERE requester_id = ? ORDER BY last_activity_at DESC',
      args: [requesterId],
    })
    const tickets = res.rows.map(rowToTicket).map((t) => withSla(t, now()))
    return query.scope === 'active' ? tickets.filter((t) => ACTIVE_STATUSES.includes(t.status)) : tickets
  })

  app.get('/tickets/:id', async (req) => {
    const actor = await requireActor(req)
    const { id } = req.params as { id: string }
    return withSla(await loadTicketFor(actor, id), now())
  })

  app.post('/tickets', async (req, reply: FastifyReply) => {
    const actor = await requireActor(req)
    const body = newTicketBody.parse(req.body)
    const at = now().toISOString()
    const ticket: Ticket = {
      id: await nextTicketId(db, body.type),
      ...body,
      status: 'Aberto',
      requesterId: actor.id,
      createdAt: at,
      lastActivityAt: at,
      resolvedAt: null,
      assignedQueue: 'N1',
      updates: [{ at, author: 'Nexo Assist', note: 'Chamado aberto pelo Nexo Assist após confirmação do funcionário.' }],
    }
    await upsertTicket(db, ticket)
    return reply.status(201).send(withSla(ticket, now()))
  })

  app.post('/tickets/:id/updates', async (req) => {
    const actor = await requireActor(req)
    const { id } = req.params as { id: string }
    const body = updateBody.parse(req.body)
    const ticket = await loadTicketFor(actor, id)
    const at = now()
    if (ticket.status === 'Fechado') throw new HttpError(409, 'closed', 'Chamado fechado não pode ser atualizado.')
    if (ticket.status === 'Resolvido') {
      if (!body.reopen) throw new HttpError(409, 'resolved', 'Chamado resolvido: para complementar, é preciso reabrir.')
      if (!isReopenable(ticket, at)) {
        throw new HttpError(409, 'reopen_window_expired', 'Chamado resolvido há mais de 7 dias não pode ser reaberto.')
      }
      ticket.status = 'Aberto'
      ticket.resolvedAt = null
    }
    ticket.updates.push({ at: at.toISOString(), author: actor.name, note: body.note })
    ticket.lastActivityAt = at.toISOString()
    await upsertTicket(db, ticket)
    return withSla(ticket, at)
  })

  app.post('/tickets/:id/transfer', async (req) => {
    const actor = await requireActor(req)
    const { id } = req.params as { id: string }
    const body = transferBody.parse(req.body)
    const ticket = await loadTicketFor(actor, id)
    const at = now().toISOString()
    ticket.assignedQueue = body.queue
    if (ticket.status !== 'Resolvido' && ticket.status !== 'Fechado') ticket.status = 'Aguardando analista'
    ticket.updates.push({ at, author: 'Nexo Assist', note: `Transferido para Suporte ${body.queue}. ${body.summary}` })
    await upsertTicket(db, ticket)
    return withSla(ticket, now())
  })

  return app
}
