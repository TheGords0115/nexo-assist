import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { createClient } from '@libsql/client'
import type { FastifyInstance } from 'fastify'
import type { Employee } from '@nexo/domain'
import { buildApp } from '../../../services/tickets/src/app'
import { Chaos } from '../../../services/tickets/src/chaos'
import { openDb } from '../../../services/tickets/src/db'
import { EMPLOYEES, seed } from '../../../services/tickets/src/seed'
import { useTestDb } from '@/server/store/db'
import { createConversation, getConversation, getDraft, listMessages, updateConversation } from '@/server/store/conversations'
import { createTurnContext, type TurnState } from '@/server/agent/context'
import { nexoTools } from '@/server/agent/tools'
import { TicketsClient } from '@/server/tickets/client'
import { confirmDraft } from '@/server/chat/actions'
import { runTurn } from '@/server/chat/turn'
import type { ChatStreamEvent, DraftView } from '@/shared/types'

// Testes das regras que NÃO podem depender do modelo. Sobem o serviço de chamados de verdade
// (em memória) e chamam as tools diretamente, como o agent faria.

let tickets: FastifyInstance
const ana = EMPLOYEES.find((e) => e.id === 'emp-ana')!

beforeAll(async () => {
  const db = openDb(':memory:')
  await seed(db)
  tickets = buildApp({ db, chaos: Chaos.off(), serviceKey: 'test-key' })
  await tickets.listen({ port: 0, host: '127.0.0.1' })
  process.env.TICKETS_URL = `http://127.0.0.1:${(tickets.server.address() as AddressInfo).port}`
  process.env.TICKETS_SERVICE_KEY = 'test-key'
})
afterAll(async () => tickets.close())

beforeEach(() => {
  useTestDb(createClient({ url: ':memory:' }))
})

async function turn(employee: Employee, userSeq = 1) {
  const conversation = await createConversation(employee)
  const state: TurnState = {
    employee,
    conversationId: conversation.id,
    userSeq,
    client: TicketsClient.fromEnv(employee.id),
    cards: [],
    steps: [],
    guardrails: [],
    transferred: null,
  }
  return { state, conversation, ctx: { requestContext: createTurnContext(state) } }
}

type AnyTool = { execute: (input: unknown, ctx: unknown) => Promise<Record<string, unknown>> }
const call = (name: keyof typeof nexoTools, input: unknown, ctx: unknown) => (nexoTools[name] as unknown as AnyTool).execute(input, ctx)

const vpnDraft = {
  tipo: 'INC',
  titulo: 'VPN não conecta no notebook, erro 809',
  descricao: 'Desde ontem a VPN não conecta e mostra o erro 809. Notebook com Windows 11.',
  categoria: 'Rede e VPN',
  impacto: 'pessoa',
  bloqueio: 'atrapalha',
  compromisso_hoje: true,
  afetados: 'Somente você',
}

describe('rascunho e confirmação', () => {
  it('prioridade vem da tabela: compromisso hoje → Alta', async () => {
    const { ctx, state } = await turn(ana)
    const result = await call('propor_novo_chamado', vpnDraft, ctx)
    expect(result.rascunho_criado).toBe(true)
    expect(result.prioridade).toBe('Alta')
    expect(state.cards[0]?.kind).toBe('draft')
  })

  it('não confirma no mesmo turno em que o rascunho foi montado', async () => {
    const { ctx, state } = await turn(ana, 5)
    const draft = await call('propor_novo_chamado', vpnDraft, ctx)
    const result = await call('confirmar_rascunho', { rascunho_id: draft.rascunho_id }, ctx)
    expect(result.erro).toMatch(/ainda não foi mostrado/)
    expect((await getDraft(String(draft.rascunho_id)))?.draft.status).toBe('pending')
    expect(state.guardrails.some((g) => g.rule === 'Confirmação antes de agir')).toBe(true)
  })

  it('confirma em um turno seguinte e cria o chamado no legado', async () => {
    const first = await turn(ana, 1)
    const draft = await call('propor_novo_chamado', vpnDraft, first.ctx)
    const secondState: TurnState = { ...first.state, userSeq: 3, cards: [], steps: [], guardrails: [] }
    const result = await call('confirmar_rascunho', { rascunho_id: draft.rascunho_id }, { requestContext: createTurnContext(secondState) })
    expect(result.executado).toBe(true)
    const stored = await getDraft(String(draft.rascunho_id))
    expect(stored?.draft.status).toBe('confirmed')
    expect(stored?.draft.ticketId).toMatch(/^INC-\d+$/)
  })
})

describe('sem duplicidade', () => {
  it('bloqueia chamado novo quando já existe um aberto na mesma categoria', async () => {
    const { ctx, state } = await turn(ana)
    const result = await call(
      'propor_novo_chamado',
      { ...vpnDraft, categoria: 'Hardware', titulo: 'Notebook muito lento', descricao: 'Notebook lento demais desde a última atualização.' },
      ctx,
    )
    expect(result.rascunho_criado).toBe(false)
    expect(JSON.stringify(result.possivel_duplicidade)).toContain('INC-20311')
    expect(state.cards).toHaveLength(0)
  })

  it('libera quando o funcionário confirma que é outro problema', async () => {
    const { ctx } = await turn(ana)
    const result = await call(
      'propor_novo_chamado',
      { ...vpnDraft, categoria: 'Hardware', titulo: 'Teclado com teclas falhando', descricao: 'As teclas A e S falham no notebook.', motivo_nao_duplicado: 'É o teclado, não a lentidão do INC-20311' },
      ctx,
    )
    expect(result.rascunho_criado).toBe(true)
  })

  it('não deixa reabrir chamado resolvido há mais de 7 dias', async () => {
    const { ctx } = await turn(ana)
    const result = await call('propor_atualizacao', { chamado_id: 'INC-19410', informacao: 'A senha expirou de novo.' }, ctx)
    expect(result.rascunho_criado).toBe(false)
  })
})

describe('privacidade', () => {
  it('um funcionário não consegue consultar o chamado de outro', async () => {
    const { ctx } = await turn(ana)
    const result = await call('consultar_chamado', { chamado_id: 'INC-20150' }, ctx)
    expect(result.erro).toMatch(/Não encontrei/)
  })

  it('a lista só traz chamados do funcionário logado', async () => {
    const { ctx } = await turn(ana)
    const result = (await call('listar_meus_chamados', { incluir_resolvidos: true, mostrar_para_escolha: false }, ctx)) as { chamados: { id: string }[] }
    const ids = result.chamados.map((c) => c.id)
    expect(ids).toContain('INC-20311')
    expect(ids).not.toContain('INC-20150')
    expect(ids).not.toContain('INC-20330')
  })
})

describe('transferência e agent pausado', () => {
  it('chamado crítico confirmado vai direto para um analista', async () => {
    const bruno = EMPLOYEES.find((e) => e.id === 'emp-diego')!
    const { ctx, conversation } = await turn(bruno)
    const draft = await call(
      'propor_novo_chamado',
      { ...vpnDraft, titulo: 'Sistema de expedição fora do ar', descricao: 'O WMS não abre para ninguém da expedição desde 9h.', categoria: 'Software', impacto: 'equipe', bloqueio: 'parado' },
      ctx,
    )
    expect(draft.prioridade).toBe('Crítica')
    const user = { id: bruno.id, name: bruno.name, email: bruno.email, role: 'employee' as const }
    const result = await confirmDraft(String(draft.rascunho_id), user, TicketsClient.fromEnv(bruno.id))
    expect((result.draft as DraftView).status).toBe('confirmed')
    expect((await getConversation(conversation.id))?.status).toBe('waiting_analyst')
  })

  it('com a conversa com um analista, o agent não responde (nem chama o modelo)', async () => {
    const conversation = await createConversation(ana)
    await updateConversation(conversation.id, { status: 'with_analyst', assignedAnalyst: { id: 'ana-rafael', name: 'Rafael Lima' } })
    const events: ChatStreamEvent[] = []
    await runTurn({ conversationId: conversation.id, employee: ana, text: 'Oi, ainda está aí?', emit: (e) => events.push(e) })
    expect(events.some((e) => e.type === 'paused')).toBe(true)
    const messages = await listMessages(conversation.id)
    expect(messages.map((m) => m.role)).toEqual(['user'])
  })

  it('respeita o limite de mensagens da sessão', async () => {
    const conversation = await createConversation(ana)
    await updateConversation(conversation.id, { userMessageCountDelta: 30 })
    const events: ChatStreamEvent[] = []
    await runTurn({ conversationId: conversation.id, employee: ana, text: 'mais uma', emit: (e) => events.push(e) })
    expect(events[0]).toMatchObject({ type: 'error' })
    expect(await listMessages(conversation.id)).toHaveLength(0)
  })
})
