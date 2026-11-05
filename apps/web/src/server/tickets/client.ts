import type { Category, Employee, NewTicketInput, Priority, TicketView } from '@nexo/domain'

/**
 * Cliente HTTP do serviço de chamados (o sistema legado).
 *
 * O legado fica indisponível por alguns segundos de vez em quando, então toda chamada tem timeout
 * e é repetida com espera crescente quando a falha é temporária (503, timeout, conexão recusada).
 * Erros de negócio (404, 409) não são repetidos: viram exceções tipadas que o agent sabe explicar.
 */

export class TicketsUnavailableError extends Error {
  constructor(readonly attempts: number) {
    super('O sistema de chamados está indisponível no momento.')
  }
}
export class TicketNotFoundError extends Error {}
export class TicketConflictError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
export class TicketsRequestError extends Error {}

export interface CallStats {
  retries: number
}

export interface TicketsClientOptions {
  baseUrl: string
  serviceKey: string
  /** Quem está agindo. Toda consulta é feita em nome de um funcionário ou analista. */
  actorId?: string
  timeoutMs?: number
  /** Esperas entre tentativas. O número de tentativas é este tamanho + 1. */
  backoffMs?: number[]
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

const RETRYABLE_STATUS = new Set([502, 503, 504])

export class TicketsClient {
  /** Retentativas feitas desde a última leitura, para mostrar no detalhe da decisão. */
  private retriesSinceReset = 0

  constructor(private readonly opts: TicketsClientOptions) {}

  static fromEnv(actorId?: string): TicketsClient {
    const baseUrl = process.env.TICKETS_URL ?? 'http://127.0.0.1:4001'
    const serviceKey = process.env.TICKETS_SERVICE_KEY
    if (!serviceKey) throw new Error('TICKETS_SERVICE_KEY não definida no .env')
    return new TicketsClient(actorId ? { baseUrl, serviceKey, actorId } : { baseUrl, serviceKey })
  }

  as(actorId: string): TicketsClient {
    return new TicketsClient({ ...this.opts, actorId })
  }

  takeRetries(): number {
    const n = this.retriesSinceReset
    this.retriesSinceReset = 0
    return n
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const { baseUrl, serviceKey, actorId, timeoutMs = 4000, backoffMs = [300, 900, 2000] } = this.opts
    const fetchImpl = this.opts.fetchImpl ?? fetch
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
    const headers: Record<string, string> = { 'x-service-key': serviceKey }
    if (actorId) headers['x-actor-id'] = actorId
    if (body !== undefined) headers['content-type'] = 'application/json'

    for (let attempt = 0; ; attempt++) {
      let res: Response | null = null
      try {
        res = await fetchImpl(`${baseUrl}${path}`, {
          method,
          headers,
          body: body === undefined ? null : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch {
        res = null // timeout ou conexão recusada: falha temporária
      }

      if (res && !RETRYABLE_STATUS.has(res.status)) {
        if (res.ok) return (await res.json()) as T
        const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        const message = err.message ?? `Erro ${res.status} no sistema de chamados.`
        if (res.status === 404) throw new TicketNotFoundError(message)
        if (res.status === 409) throw new TicketConflictError(err.error ?? 'conflict', message)
        throw new TicketsRequestError(message)
      }

      const wait = backoffMs[attempt]
      if (wait === undefined) throw new TicketsUnavailableError(attempt + 1)
      this.retriesSinceReset++
      await sleep(wait)
    }
  }

  findEmployeeByEmail(email: string): Promise<Employee> {
    return this.request('GET', `/employees/by-email?email=${encodeURIComponent(email)}`)
  }

  getEmployee(id: string): Promise<Employee> {
    return this.request('GET', `/employees/${encodeURIComponent(id)}`)
  }

  listTickets(params: { requesterId?: string; scope?: 'active' | 'all' } = {}): Promise<TicketView[]> {
    const qs = new URLSearchParams()
    if (params.requesterId) qs.set('requesterId', params.requesterId)
    if (params.scope) qs.set('scope', params.scope)
    return this.request('GET', `/tickets?${qs.toString()}`)
  }

  getTicket(id: string): Promise<TicketView> {
    return this.request('GET', `/tickets/${encodeURIComponent(id)}`)
  }

  createTicket(input: NewTicketInput): Promise<TicketView> {
    return this.request('POST', '/tickets', input)
  }

  addUpdate(id: string, note: string, reopen = false): Promise<TicketView> {
    return this.request('POST', `/tickets/${encodeURIComponent(id)}/updates`, { note, reopen })
  }

  transfer(id: string, queue: 'N1' | 'N2', summary: string): Promise<TicketView> {
    return this.request('POST', `/tickets/${encodeURIComponent(id)}/transfer`, { queue, summary })
  }
}

export type { Category, Priority }
