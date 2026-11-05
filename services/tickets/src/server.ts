import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildApp } from './app'
import { Chaos } from './chaos'
import { migrate, openDb } from './db'
import { seed } from './seed'
import { loadRootEnv } from './env'

loadRootEnv()

const dbPath = resolve(process.env.TICKETS_DB_PATH ?? resolve(import.meta.dirname, '../../../data/tickets.db'))
mkdirSync(dirname(dbPath), { recursive: true })
const isNew = !existsSync(dbPath)
const db = openDb(`file:${dbPath}`)

const serviceKey = process.env.TICKETS_SERVICE_KEY
if (!serviceKey) {
  console.error('TICKETS_SERVICE_KEY não definida. Copie .env.example para .env.')
  process.exit(1)
}

await migrate(db)
if (isNew) {
  await seed(db)
  console.log('Banco de chamados criado com os dados de exemplo.')
}

const app = buildApp({ db, chaos: Chaos.fromEnv(process.env), serviceKey, logger: process.env.NODE_ENV !== 'test' })
const port = Number(process.env.TICKETS_PORT ?? 4001)
await app.listen({ port, host: '127.0.0.1' })
