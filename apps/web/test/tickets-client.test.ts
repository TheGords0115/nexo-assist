import { describe, expect, it } from 'vitest'
import { TicketConflictError, TicketNotFoundError, TicketsClient, TicketsUnavailableError } from '@/server/tickets/client'

// O legado cai por alguns segundos de vez em quando: o cliente precisa repetir só o que é
// falha temporária e desistir com um erro claro quando não volta.

function fakeFetch(responses: (number | 'network')[]) {
  const calls: string[] = []
  const impl = (async (url: string) => {
    calls.push(url)
    const next = responses.shift() ?? 200
    if (next === 'network') throw new TypeError('fetch failed')
    const body = next === 200 ? { id: 'emp-ana' } : { error: next === 409 ? 'reopen_window_expired' : 'x', message: `erro ${next}` }
    return new Response(JSON.stringify(body), { status: next })
  }) as unknown as typeof fetch
  return { impl, calls }
}

const base = { baseUrl: 'http://tickets', serviceKey: 'k', actorId: 'emp-ana', sleep: async () => {} }

describe('TicketsClient', () => {
  it('repete quando o legado responde 503 e conta as retentativas', async () => {
    const { impl, calls } = fakeFetch([503, 503, 200])
    const client = new TicketsClient({ ...base, fetchImpl: impl })
    await expect(client.getEmployee('emp-ana')).resolves.toEqual({ id: 'emp-ana' })
    expect(calls).toHaveLength(3)
    expect(client.takeRetries()).toBe(2)
    expect(client.takeRetries()).toBe(0)
  })

  it('repete em falha de rede', async () => {
    const { impl } = fakeFetch(['network', 200])
    await expect(new TicketsClient({ ...base, fetchImpl: impl }).getEmployee('emp-ana')).resolves.toBeTruthy()
  })

  it('desiste depois das tentativas e lança TicketsUnavailableError', async () => {
    const { impl, calls } = fakeFetch([503, 503, 503, 503])
    await expect(new TicketsClient({ ...base, fetchImpl: impl }).getEmployee('emp-ana')).rejects.toBeInstanceOf(TicketsUnavailableError)
    expect(calls).toHaveLength(4)
  })

  it('não repete erro de negócio: 404 e 409 viram exceções tipadas', async () => {
    const notFound = fakeFetch([404])
    await expect(new TicketsClient({ ...base, fetchImpl: notFound.impl }).getTicket('INC-1')).rejects.toBeInstanceOf(TicketNotFoundError)
    expect(notFound.calls).toHaveLength(1)

    const conflict = fakeFetch([409])
    const error = await new TicketsClient({ ...base, fetchImpl: conflict.impl }).addUpdate('INC-1', 'nota', true).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TicketConflictError)
    expect((error as TicketConflictError).code).toBe('reopen_window_expired')
  })
})
