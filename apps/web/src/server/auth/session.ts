import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import type { SessionUser } from '@/shared/types'

// Sessão em cookie assinado (HMAC-SHA256). Não guardo nada sensível no cookie, só quem é o usuário,
// e a assinatura impede que alguém troque o id para ler a conversa de outra pessoa.
// É daqui que sai o id do funcionário que as tools do agent usam (o modelo nunca escolhe de quem
// são os chamados).

export const SESSION_COOKIE = 'nexo_session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // "manter conectado": 30 dias

function secret(): string {
  const value = process.env.SESSION_SECRET
  if (!value || value.length < 32) throw new Error('SESSION_SECRET ausente ou curta (mínimo 32 caracteres).')
  return value
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function encodeSession(user: SessionUser, maxAgeSeconds = MAX_AGE_SECONDS): string {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + maxAgeSeconds * 1000 })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function decodeSession(token: string | undefined): SessionUser | null {
  if (!token) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as SessionUser & { exp: number }
    if (data.exp < Date.now()) return null
    return { id: data.id, name: data.name, email: data.email, role: data.role }
  } catch {
    return null
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies()
  return decodeSession(store.get(SESSION_COOKIE)?.value)
}

export async function setSession(user: SessionUser, remember: boolean): Promise<void> {
  const store = await cookies()
  const maxAge = remember ? MAX_AGE_SECONDS : 60 * 60 * 12
  store.set(SESSION_COOKIE, encodeSession(user, maxAge), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(remember ? { maxAge } : {}),
  })
}

export async function clearSession(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}
