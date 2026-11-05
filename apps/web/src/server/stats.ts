import { getDb } from './store/db'

// Números reais do atendimento, mostrados na tela de login (no protótipo eles são ilustrativos).

export interface LoginStats {
  avgFirstResponseSec: number | null
  resolvedWithoutQueuePct: number | null
  conversationsToday: number
}

export async function getLoginStats(): Promise<LoginStats> {
  const db = await getDb()
  const latency = await db.execute(`
    SELECT AVG(json_extract(trace_json, '$.latencyMs')) AS avg_ms
    FROM messages
    WHERE role = 'assistant' AND trace_json IS NOT NULL AND json_extract(trace_json, '$.usage.outputTokens') > 0`)
  const resolution = await db.execute(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN transfer_json IS NULL AND status != 'with_analyst' THEN 1 ELSE 0 END) AS no_queue
    FROM conversations WHERE user_message_count > 0`)
  const today = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM conversations WHERE created_at >= ?`,
    args: [new Date(new Date().setHours(0, 0, 0, 0)).toISOString()],
  })
  const avgMs = latency.rows[0]?.avg_ms
  const total = Number(resolution.rows[0]?.total ?? 0)
  return {
    avgFirstResponseSec: avgMs == null ? null : Math.round(Number(avgMs) / 100) / 10,
    resolvedWithoutQueuePct: total === 0 ? null : Math.round((Number(resolution.rows[0]?.no_queue ?? 0) / total) * 100),
    conversationsToday: Number(today.rows[0]?.n ?? 0),
  }
}
