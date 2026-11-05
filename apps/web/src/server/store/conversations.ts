import { randomUUID } from 'node:crypto'
import type { Row } from '@libsql/client'
import type { Employee } from '@nexo/domain'
import type {
  AgentTrace,
  Card,
  ChatMessage,
  ConversationListItem,
  ConversationStatus,
  ConversationView,
  DraftStatus,
  DraftView,
  MessageRole,
} from '@/shared/types'
import { getDb } from './db'

// Repositório das conversas. Só SQL e conversão de linhas; nenhuma regra de negócio mora aqui
// (as regras ficam em server/chat e server/agent).

export const MESSAGE_LIMIT = Number(process.env.CHAT_MESSAGE_LIMIT ?? 30)

type EmployeeInfo = ConversationView['employee']

function toConversation(row: Row): ConversationView {
  return {
    id: String(row.id),
    employee: JSON.parse(String(row.employee_json)) as EmployeeInfo,
    status: String(row.status) as ConversationStatus,
    assignedAnalyst: row.assigned_analyst_id
      ? { id: String(row.assigned_analyst_id), name: String(row.assigned_analyst_name) }
      : null,
    transfer: row.transfer_json ? (JSON.parse(String(row.transfer_json)) as ConversationView['transfer']) : null,
    userMessageCount: Number(row.user_message_count),
    messageLimit: MESSAGE_LIMIT,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    closedAt: row.closed_at ? String(row.closed_at) : null,
    resolvedByAgent: Number(row.resolved_by_agent) === 1,
  }
}

function toMessage(row: Row): ChatMessage {
  return {
    id: String(row.id),
    role: String(row.role) as MessageRole,
    authorName: row.author_name ? String(row.author_name) : null,
    content: String(row.content),
    createdAt: String(row.created_at),
    cards: JSON.parse(String(row.cards_json)) as Card[],
    quickReplies: JSON.parse(String(row.quick_replies_json)) as string[],
    trace: row.trace_json ? (JSON.parse(String(row.trace_json)) as AgentTrace) : null,
  }
}

export async function createConversation(employee: Employee): Promise<ConversationView> {
  const db = await getDb()
  const now = new Date().toISOString()
  const info: EmployeeInfo = {
    id: employee.id,
    name: employee.name,
    email: employee.email,
    department: employee.department,
    device: employee.device,
  }
  const id = randomUUID()
  await db.execute({
    sql: `INSERT INTO conversations (id, employee_id, employee_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    args: [id, employee.id, JSON.stringify(info), now, now],
  })
  return (await getConversation(id))!
}

export async function getConversation(id: string): Promise<ConversationView | null> {
  const db = await getDb()
  const res = await db.execute({ sql: 'SELECT * FROM conversations WHERE id = ?', args: [id] })
  return res.rows[0] ? toConversation(res.rows[0]) : null
}

/** Conversa mais recente do funcionário que ainda não foi encerrada ("continuar de onde parei"). */
export async function findOpenConversation(employeeId: string): Promise<ConversationView | null> {
  const db = await getDb()
  const res = await db.execute({
    sql: `SELECT * FROM conversations WHERE employee_id = ? AND status != 'closed' ORDER BY updated_at DESC LIMIT 1`,
    args: [employeeId],
  })
  return res.rows[0] ? toConversation(res.rows[0]) : null
}

export interface ConversationPatch {
  status?: ConversationStatus
  assignedAnalyst?: { id: string; name: string } | null
  transfer?: ConversationView['transfer']
  userMessageCountDelta?: number
  analystUnread?: 'increment' | 'reset'
  resolvedByAgent?: boolean
  closedAt?: string | null
}

export async function updateConversation(id: string, patch: ConversationPatch): Promise<ConversationView> {
  const db = await getDb()
  const sets: string[] = ['updated_at = ?']
  const args: (string | number | null)[] = [new Date().toISOString()]
  if (patch.status) {
    sets.push('status = ?')
    args.push(patch.status)
  }
  if (patch.assignedAnalyst !== undefined) {
    sets.push('assigned_analyst_id = ?', 'assigned_analyst_name = ?')
    args.push(patch.assignedAnalyst?.id ?? null, patch.assignedAnalyst?.name ?? null)
  }
  if (patch.transfer !== undefined) {
    sets.push('transfer_json = ?')
    args.push(patch.transfer ? JSON.stringify(patch.transfer) : null)
  }
  if (patch.userMessageCountDelta) {
    sets.push('user_message_count = user_message_count + ?')
    args.push(patch.userMessageCountDelta)
  }
  if (patch.analystUnread === 'increment') sets.push('analyst_unread = analyst_unread + 1')
  if (patch.analystUnread === 'reset') sets.push('analyst_unread = 0')
  if (patch.resolvedByAgent !== undefined) {
    sets.push('resolved_by_agent = ?')
    args.push(patch.resolvedByAgent ? 1 : 0)
  }
  if (patch.closedAt !== undefined) {
    sets.push('closed_at = ?')
    args.push(patch.closedAt)
  }
  args.push(id)
  await db.execute({ sql: `UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`, args })
  return (await getConversation(id))!
}

export interface NewMessage {
  role: MessageRole
  content: string
  authorName?: string | null
  cards?: Card[]
  quickReplies?: string[]
  trace?: AgentTrace | null
}

export async function appendMessage(conversationId: string, msg: NewMessage): Promise<ChatMessage & { seq: number }> {
  const db = await getDb()
  const id = randomUUID()
  const createdAt = new Date().toISOString()
  // seq calculado dentro do próprio INSERT para não haver corrida entre duas mensagens simultâneas.
  const res = await db.execute({
    sql: `INSERT INTO messages (id, conversation_id, seq, role, author_name, content, cards_json, quick_replies_json, trace_json, created_at)
          VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE conversation_id = ?), ?, ?, ?, ?, ?, ?, ?)
          RETURNING seq`,
    args: [
      id, conversationId, conversationId, msg.role, msg.authorName ?? null, msg.content,
      JSON.stringify(msg.cards ?? []), JSON.stringify(msg.quickReplies ?? []),
      msg.trace ? JSON.stringify(msg.trace) : null, createdAt,
    ],
  })
  await db.execute({ sql: 'UPDATE conversations SET updated_at = ? WHERE id = ?', args: [createdAt, conversationId] })
  return {
    id,
    seq: Number(res.rows[0]?.seq),
    role: msg.role,
    authorName: msg.authorName ?? null,
    content: msg.content,
    createdAt,
    cards: msg.cards ?? [],
    quickReplies: msg.quickReplies ?? [],
    trace: msg.trace ?? null,
  }
}

/** Atualiza os cards de uma mensagem já salva (ex.: rascunho que foi confirmado depois). */
export async function updateMessageCards(messageId: string, cards: Card[]): Promise<void> {
  const db = await getDb()
  await db.execute({ sql: 'UPDATE messages SET cards_json = ? WHERE id = ?', args: [JSON.stringify(cards), messageId] })
}

export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  const db = await getDb()
  const res = await db.execute({ sql: 'SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq', args: [conversationId] })
  return res.rows.map(toMessage)
}

export async function lastUserSeq(conversationId: string): Promise<number> {
  const db = await getDb()
  const res = await db.execute({
    sql: `SELECT COALESCE(MAX(seq), 0) AS seq FROM messages WHERE conversation_id = ? AND role = 'user'`,
    args: [conversationId],
  })
  return Number(res.rows[0]?.seq ?? 0)
}

// ---------- Console do analista ----------

export type ConsoleFilter = 'todas' | 'para_voce' | 'com_agent' | 'minhas'

export async function listConversations(filter: ConsoleFilter, analystId: string, search = ''): Promise<ConversationListItem[]> {
  const db = await getDb()
  const where: string[] = []
  const args: string[] = []
  // "Para você": esperando atendente + as que este analista já assumiu (como na Tela 5).
  if (filter === 'para_voce') {
    where.push(`(c.status = 'waiting_analyst' OR (c.status = 'with_analyst' AND c.assigned_analyst_id = ?))`)
    args.push(analystId)
  }
  if (filter === 'com_agent') where.push(`c.status = 'agent'`)
  if (filter === 'minhas') {
    where.push(`c.assigned_analyst_id = ?`)
    args.push(analystId)
  }
  if (search.trim()) {
    where.push(`(c.employee_json LIKE ? OR c.transfer_json LIKE ? OR EXISTS (SELECT 1 FROM messages m2 WHERE m2.conversation_id = c.id AND m2.content LIKE ?))`)
    const like = `%${search.trim()}%`
    args.push(like, like, like)
  }
  const res = await db.execute({
    sql: `SELECT c.*,
            (SELECT role FROM messages m WHERE m.conversation_id = c.id ORDER BY seq DESC LIMIT 1) AS last_role,
            (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY seq DESC LIMIT 1) AS last_content,
            (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY seq DESC LIMIT 1) AS last_at
          FROM conversations c
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY CASE c.status WHEN 'waiting_analyst' THEN 0 WHEN 'with_analyst' THEN 1 WHEN 'agent' THEN 2 ELSE 3 END,
                   c.updated_at DESC
          LIMIT 100`,
    args,
  })
  return res.rows.map((row) => ({
    ...toConversation(row),
    lastMessage: row.last_content
      ? { role: String(row.last_role) as MessageRole, content: String(row.last_content), at: String(row.last_at) }
      : null,
    unreadForAnalyst: Number(row.analyst_unread),
  }))
}

export async function countByStatus(): Promise<Record<ConversationStatus, number>> {
  const db = await getDb()
  const res = await db.execute(`SELECT status, COUNT(*) AS n FROM conversations GROUP BY status`)
  const counts: Record<ConversationStatus, number> = { agent: 0, waiting_analyst: 0, with_analyst: 0, closed: 0 }
  for (const row of res.rows) counts[String(row.status) as ConversationStatus] = Number(row.n)
  return counts
}

// ---------- Rascunhos ----------

export interface StoredDraft {
  draft: DraftView
  conversationId: string
  /** seq da última mensagem do funcionário quando o rascunho foi mostrado. */
  createdAtSeq: number
  messageId: string | null
}

async function nextCounter(name: string, start: number): Promise<number> {
  const db = await getDb()
  const res = await db.execute({
    sql: `INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value`,
    args: [name, start],
  })
  return Number(res.rows[0]?.value)
}

export async function createDraft(conversationId: string, data: Omit<DraftView, 'id' | 'status'>, createdAtSeq: number): Promise<DraftView> {
  const db = await getDb()
  // Um rascunho novo substitui o anterior da mesma conversa (o funcionário editou o pedido).
  await db.execute({
    sql: `UPDATE drafts SET status = 'superseded', updated_at = ? WHERE conversation_id = ? AND status = 'pending'`,
    args: [new Date().toISOString(), conversationId],
  })
  const draft: DraftView = { ...data, id: `D-${await nextCounter('draft', 381)}`, status: 'pending' }
  const now = new Date().toISOString()
  await db.execute({
    sql: `INSERT INTO drafts (id, conversation_id, status, data_json, created_at_seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [draft.id, conversationId, draft.status, JSON.stringify({ draft, messageId: null }), createdAtSeq, now, now],
  })
  return draft
}

export async function getDraft(id: string): Promise<StoredDraft | null> {
  const db = await getDb()
  const res = await db.execute({ sql: 'SELECT * FROM drafts WHERE id = ?', args: [id] })
  const row = res.rows[0]
  if (!row) return null
  const data = JSON.parse(String(row.data_json)) as { draft: DraftView; messageId: string | null }
  return {
    draft: { ...data.draft, status: String(row.status) as DraftStatus },
    conversationId: String(row.conversation_id),
    createdAtSeq: Number(row.created_at_seq),
    messageId: data.messageId,
  }
}

export async function getPendingDraft(conversationId: string): Promise<StoredDraft | null> {
  const db = await getDb()
  const res = await db.execute({
    sql: `SELECT id FROM drafts WHERE conversation_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
    args: [conversationId],
  })
  return res.rows[0] ? getDraft(String(res.rows[0].id)) : null
}

export async function saveDraft(stored: StoredDraft): Promise<void> {
  const db = await getDb()
  await db.execute({
    sql: 'UPDATE drafts SET status = ?, data_json = ?, updated_at = ? WHERE id = ?',
    args: [stored.draft.status, JSON.stringify({ draft: stored.draft, messageId: stored.messageId }), new Date().toISOString(), stored.draft.id],
  })
}
