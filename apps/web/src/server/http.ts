import { NextResponse } from 'next/server'
import type { SessionUser } from '@/shared/types'
import { getSessionUser } from './auth/session'
import { ActionError } from './chat/actions'

// Utilitários das rotas da API: checagem de sessão/perfil e tradução de erros para HTTP.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function requireUser(role?: SessionUser['role']): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) throw new HttpError(401, 'Faça login para continuar.')
  if (role && user.role !== role) throw new HttpError(403, 'Você não tem acesso a esta área.')
  return user
}

/** Envolve o handler: erros conhecidos viram JSON com status certo, o resto vira 500. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args)
    } catch (error) {
      if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status })
      if (error instanceof ActionError) return NextResponse.json({ error: error.message }, { status: 409 })
      console.error('[nexo] erro na API', error)
      return NextResponse.json({ error: 'Erro inesperado. Tente de novo.' }, { status: 500 })
    }
  }
}
