import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createClient, type Client } from '@libsql/client'

// Banco da aplicação (conversas, mensagens e rascunhos). Fica em arquivo, então conversa, rascunho e
// o estado "com o agent / com um analista" sobrevivem a um reinício (requisito de persistência).
// Os chamados NÃO ficam aqui: eles são do serviço de chamados, que é outro processo e outro banco.

let client: Client | null = null
let migrated: Promise<void> | null = null

export function appDbPath(): string {
  return resolve(process.env.APP_DB_PATH ?? resolve(process.cwd(), '../../data/app.db'))
}

export async function getDb(): Promise<Client> {
  if (!client) {
    const url = process.env.APP_DB_URL ?? `file:${appDbPath()}`
    if (url.startsWith('file:')) mkdirSync(dirname(url.slice(5)), { recursive: true })
    client = createClient({ url })
  }
  migrated ??= migrate(client)
  await migrated
  return client
}

/** Só para testes: usa um banco em memória. */
export function useTestDb(db: Client): void {
  client = db
  migrated = migrate(db)
}

export async function migrate(db: Client): Promise<void> {
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        employee_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'agent',
        assigned_analyst_id TEXT,
        assigned_analyst_name TEXT,
        transfer_json TEXT,
        user_message_count INTEGER NOT NULL DEFAULT 0,
        analyst_unread INTEGER NOT NULL DEFAULT 0,
        resolved_by_agent INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS conversations_employee ON conversations(employee_id, updated_at)`,
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        author_name TEXT,
        content TEXT NOT NULL,
        cards_json TEXT NOT NULL DEFAULT '[]',
        quick_replies_json TEXT NOT NULL DEFAULT '[]',
        trace_json TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS messages_seq ON messages(conversation_id, seq)`,
      `CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        status TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at_seq INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS drafts_conversation ON drafts(conversation_id, status)`,
      `CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)`,
    ],
    'write',
  )
}
