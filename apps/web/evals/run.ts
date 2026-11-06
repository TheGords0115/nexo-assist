import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createClient } from '@libsql/client'

// Roda os cenários de avaliação contra o modelo real e imprime um placar.
// Cada cenário começa do zero: serviço de chamados em memória com os dados de exemplo e banco de
// conversas em memória. Uso: `npm run eval` (ou `npm run eval -- vpn` para filtrar pelo id).

const root = resolve(import.meta.dirname, '../../..')
process.loadEnvFile?.(resolve(root, '.env'))
process.env.SESSION_SECRET ??= 'x'.repeat(32)
const { providerKeyEnv, NEXO_MODEL } = await import('@/server/agent/agent')
if (!process.env[providerKeyEnv()]) {
  console.error(`${providerKeyEnv()} não definida no .env (modelo ${NEXO_MODEL})`)
  process.exit(1)
}

const { buildApp } = await import('../../../services/tickets/src/app')
const { Chaos } = await import('../../../services/tickets/src/chaos')
const { openDb } = await import('../../../services/tickets/src/db')
const { EMPLOYEES, seed } = await import('../../../services/tickets/src/seed')
const { useTestDb } = await import('@/server/store/db')
const { createConversation, getConversation, listMessages } = await import('@/server/store/conversations')
const { runTurn } = await import('@/server/chat/turn')
const { SCENARIOS } = await import('./scenarios')
type TurnResult = import('./scenarios').TurnResult

const filter = process.argv[2]
const scenarios = SCENARIOS.filter((s) => !filter || s.id.includes(filter))

interface Report {
  id: string
  description: string
  passed: number
  total: number
  failures: string[]
  latencyMs: number
  costUsd: number
  transcript: { user: string; agent: string; tools: string[]; decision: unknown }[]
}

const reports: Report[] = []

for (const scenario of scenarios) {
  const ticketsDb = openDb(':memory:')
  await seed(ticketsDb)
  const tickets = buildApp({ db: ticketsDb, chaos: Chaos.off(), serviceKey: 'eval-key' })
  await tickets.listen({ port: 0, host: '127.0.0.1' })
  process.env.TICKETS_URL = `http://127.0.0.1:${(tickets.server.address() as AddressInfo).port}`
  process.env.TICKETS_SERVICE_KEY = 'eval-key'
  useTestDb(createClient({ url: ':memory:' }))

  const employee = EMPLOYEES.find((e) => e.id === scenario.employeeId)!
  const conversation = await createConversation(employee)
  const turns: TurnResult[] = []
  const transcript: Report['transcript'] = []

  for (const text of scenario.messages) {
    const conv = await getConversation(conversation.id)
    if (conv?.status !== 'agent') break // transferiu: o agent não responde mais
    await runTurn({ conversationId: conversation.id, employee, text, emit: () => {} })
    const messages = await listMessages(conversation.id)
    const reply = [...messages].reverse().find((m) => m.role === 'assistant') ?? null
    turns.push({ reply, trace: reply?.trace ?? null, cards: reply?.cards ?? [], conversation: (await getConversation(conversation.id))! })
    transcript.push({ user: text, agent: reply?.content ?? '', tools: reply?.trace?.steps.map((s) => `${s.tool}${s.ok ? '' : ' (erro)'}`) ?? [], decision: reply?.trace?.decision })
  }
  await tickets.close()

  const failures = scenario.checks.filter((c) => {
    try {
      return !c.test(turns)
    } catch {
      return true
    }
  })
  const report: Report = {
    id: scenario.id,
    description: scenario.description,
    passed: scenario.checks.length - failures.length,
    total: scenario.checks.length,
    failures: failures.map((f) => f.name),
    latencyMs: turns.reduce((sum, t) => sum + (t.trace?.latencyMs ?? 0), 0),
    costUsd: turns.reduce((sum, t) => sum + (t.trace?.costUsd ?? 0), 0),
    transcript,
  }
  reports.push(report)
  const mark = failures.length === 0 ? 'OK  ' : 'FALHA'
  console.log(`${mark} ${scenario.id} (${report.passed}/${report.total}) ${(report.latencyMs / 1000).toFixed(1)}s US$${report.costUsd.toFixed(4)}`)
  for (const f of report.failures) console.log(`       - ${f}`)
}

const passed = reports.reduce((s, r) => s + r.passed, 0)
const total = reports.reduce((s, r) => s + r.total, 0)
const fullPass = reports.filter((r) => r.failures.length === 0).length
console.log(`\nVerificações: ${passed}/${total} · cenários 100%: ${fullPass}/${reports.length}`)
console.log(`Custo total: US$ ${reports.reduce((s, r) => s + r.costUsd, 0).toFixed(4)} · modelo ${NEXO_MODEL}`)

const outDir = resolve(import.meta.dirname, 'results')
mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'latest.json'), JSON.stringify({ at: new Date().toISOString(), model: NEXO_MODEL, passed, total, reports }, null, 2))
console.log(`Detalhes (com transcrições e decisões): apps/web/evals/results/latest.json`)
process.exit(0)
