import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { TicketView } from '@nexo/domain'
import { buildApp } from '../src/app'
import { Chaos } from '../src/chaos'
import { openDb } from '../src/db'
import { seed } from '../src/seed'

const KEY = 'test-key'
const NOW = new Date('2026-11-05T13:00:00Z')
let app: FastifyInstance

beforeEach(async () => {
  const db = openDb(':memory:')
  await seed(db, NOW)
  app = buildApp({ db, chaos: Chaos.off(), serviceKey: KEY, now: () => NOW })
})
afterEach(async () => app.close())

const as = (actorId: string) => ({ 'x-service-key': KEY, 'x-actor-id': actorId })

describe('autenticação', () => {
  it('recusa requisição sem a chave de serviço', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets', headers: { 'x-actor-id': 'emp-ana' } })
    expect(res.statusCode).toBe(401)
  })
})

describe('privacidade: chamado só para quem abriu', () => {
  it('lista apenas os chamados do próprio funcionário', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets', headers: as('emp-ana') })
    const tickets = res.json<TicketView[]>()
    expect(tickets.length).toBeGreaterThan(0)
    expect(tickets.every((t) => t.requesterId === 'emp-ana')).toBe(true)
  })

  it('não deixa um funcionário listar os chamados de outro', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets?requesterId=emp-carla', headers: as('emp-ana') })
    expect(res.statusCode).toBe(403)
  })

  it('chamado de outra pessoa responde 404, sem revelar que existe', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets/INC-20150', headers: as('emp-ana') })
    expect(res.statusCode).toBe(404)
  })

  it('não deixa atualizar o chamado de outra pessoa', async () => {
    const res = await app.inject({
      method: 'POST', url: '/tickets/INC-20330/updates', headers: as('emp-ana'),
      payload: { note: 'tentando mexer no chamado do Bruno' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('analista enxerga os chamados de qualquer funcionário', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets?requesterId=emp-ana', headers: as('ana-rafael') })
    expect(res.statusCode).toBe(200)
  })
})

describe('regras de atualização', () => {
  it('calcula o atraso: INC-20311 está vencido', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets/INC-20311', headers: as('emp-ana') })
    expect(res.json<TicketView>().overdue).toBe(true)
  })

  it('reabre chamado resolvido há até 7 dias', async () => {
    const res = await app.inject({
      method: 'POST', url: '/tickets/INC-19877/updates', headers: as('emp-ana'),
      payload: { note: 'Voltou a parar de sincronizar.', reopen: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<TicketView>().status).toBe('Aberto')
  })

  it('não reabre chamado resolvido há mais de 7 dias', async () => {
    const res = await app.inject({
      method: 'POST', url: '/tickets/INC-19410/updates', headers: as('emp-ana'),
      payload: { note: 'A senha expirou de novo.', reopen: true },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json<{ error: string }>().error).toBe('reopen_window_expired')
  })

  it('cria chamado com número sequencial e no nome de quem pediu', async () => {
    const res = await app.inject({
      method: 'POST', url: '/tickets', headers: as('emp-ana'),
      payload: {
        type: 'INC', title: 'VPN não conecta no notebook', description: 'Erro 809 ao conectar na VPN desde ontem.',
        category: 'Rede e VPN', priority: 'Alta', affected: 'Somente a solicitante',
      },
    })
    expect(res.statusCode).toBe(201)
    const ticket = res.json<TicketView>()
    expect(ticket.id).toBe('INC-20501')
    expect(ticket.requesterId).toBe('emp-ana')
    expect(ticket.dueAt).not.toBeNull()
  })
})

describe('instabilidade simulada', () => {
  it('janela de indisponibilidade derruba as requisições seguintes', () => {
    let clock = 0
    const randoms = [0, 0.001] // primeira chamada abre a janela
    const chaos = new Chaos({ failureRate: 0, outageRate: 0.01, outageMs: 3000, maxLatencyMs: 0, now: () => clock, random: () => randoms.shift() ?? 0.99 })
    expect(chaos.roll().fail).toBe(true)
    clock = 1000
    expect(chaos.roll().fail).toBe(true)
    clock = 5000
    expect(chaos.roll().fail).toBe(false)
  })
})
