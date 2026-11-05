import { createClient, type Client, type Row } from '@libsql/client'
import type { Category, Employee, Priority, Ticket, TicketStatus, TicketType, TicketUpdate } from '@nexo/domain'

export type Db = Client

export function openDb(url: string): Db {
  return createClient({ url })
}

export async function migrate(db: Db): Promise<void> {
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK (role IN ('employee', 'analyst')),
        department TEXT NOT NULL,
        device TEXT NOT NULL,
        support_level TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        requester_id TEXT NOT NULL REFERENCES employees(id),
        affected TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL,
        resolved_at TEXT,
        assigned_queue TEXT,
        updates TEXT NOT NULL DEFAULT '[]'
      )`,
      `CREATE INDEX IF NOT EXISTS tickets_requester ON tickets(requester_id)`,
      `CREATE TABLE IF NOT EXISTS sequences (prefix TEXT PRIMARY KEY, value INTEGER NOT NULL)`,
    ],
    'write',
  )
}

export function rowToEmployee(row: Row): Employee {
  const employee: Employee = {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: row.role === 'analyst' ? 'analyst' : 'employee',
    department: String(row.department),
    device: String(row.device),
  }
  if (row.support_level === 'N1' || row.support_level === 'N2') employee.supportLevel = row.support_level
  return employee
}

export function rowToTicket(row: Row): Ticket {
  return {
    id: String(row.id),
    type: String(row.type) as TicketType,
    title: String(row.title),
    description: String(row.description),
    category: String(row.category) as Category,
    priority: String(row.priority) as Priority,
    status: String(row.status) as TicketStatus,
    requesterId: String(row.requester_id),
    affected: String(row.affected),
    createdAt: String(row.created_at),
    lastActivityAt: String(row.last_activity_at),
    resolvedAt: row.resolved_at == null ? null : String(row.resolved_at),
    assignedQueue: row.assigned_queue === 'N1' || row.assigned_queue === 'N2' ? row.assigned_queue : null,
    updates: JSON.parse(String(row.updates)) as TicketUpdate[],
  }
}

export async function upsertTicket(db: Db, t: Ticket): Promise<void> {
  await db.execute({
    sql: `INSERT INTO tickets (id, type, title, description, category, priority, status, requester_id, affected,
            created_at, last_activity_at, resolved_at, assigned_queue, updates)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title, description = excluded.description, category = excluded.category,
            priority = excluded.priority, status = excluded.status, affected = excluded.affected,
            last_activity_at = excluded.last_activity_at, resolved_at = excluded.resolved_at,
            assigned_queue = excluded.assigned_queue, updates = excluded.updates`,
    args: [
      t.id, t.type, t.title, t.description, t.category, t.priority, t.status, t.requesterId, t.affected,
      t.createdAt, t.lastActivityAt, t.resolvedAt, t.assignedQueue, JSON.stringify(t.updates),
    ],
  })
}

/** Próximo número de chamado (INC-20xxx / REQ-10xxx). Um único upsert, então é atômico. */
export async function nextTicketId(db: Db, type: TicketType): Promise<string> {
  const first = type === 'INC' ? 20501 : 10501
  const res = await db.execute({
    sql: `INSERT INTO sequences (prefix, value) VALUES (?, ?)
          ON CONFLICT(prefix) DO UPDATE SET value = value + 1
          RETURNING value`,
    args: [type, first],
  })
  return `${type}-${Number(res.rows[0]?.value)}`
}
