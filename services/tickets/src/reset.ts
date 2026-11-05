import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { openDb } from './db'
import { seed } from './seed'
import { loadRootEnv } from './env'

loadRootEnv()
const dbPath = resolve(process.env.TICKETS_DB_PATH ?? resolve(import.meta.dirname, '../../../data/tickets.db'))
mkdirSync(dirname(dbPath), { recursive: true })
const db = openDb(`file:${dbPath}`)
await seed(db)
console.log(`Dados de exemplo recriados em ${dbPath}`)
