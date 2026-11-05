'use client'

import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { useState } from 'react'

// Formulário de login. Qualquer senha é aceita para os funcionários dos dados de exemplo (PRD);
// a lista de contas de teste fica no README.

export function LoginForm() {
  const [email, setEmail] = useState('ana.souza@nexo.com.br')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, remember }),
      })
      const data = (await res.json()) as { redirect?: string; error?: string }
      if (!res.ok || !data.redirect) throw new Error(data.error ?? 'Não foi possível entrar.')
      window.location.href = data.redirect
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      <label className="block">
        <span className="text-[12.5px] font-medium text-ink-soft">E-mail corporativo</span>
        <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line px-3 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
          <Mail className="h-4 w-4 text-faint" />
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 w-full bg-transparent text-[13.5px] outline-none"
            placeholder="nome@nexo.com.br"
            required
          />
        </div>
      </label>
      <label className="block">
        <span className="flex justify-between text-[12.5px] font-medium text-ink-soft">
          Senha
          <span className="font-medium text-brand">Esqueci minha senha</span>
        </span>
        <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line px-3 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
          <Lock className="h-4 w-4 text-faint" />
          <input
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 w-full bg-transparent text-[13.5px] outline-none"
            placeholder="Senha da rede (qualquer uma na demonstração)"
            required
          />
          <button type="button" onClick={() => setShow((s) => !s)} className="text-faint hover:text-muted" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </label>
      <label className="flex items-center gap-2 text-[12.5px] text-ink-soft">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-brand" />
        Manter conectado neste computador
      </label>
      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-brand text-[13.5px] font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
      >
        {loading ? 'Entrando…' : 'Entrar'} {!loading && <ArrowRight className="h-4 w-4" />}
      </button>
      <p className="border-t border-line pt-4 text-[11.5px] leading-relaxed text-faint">
        Demonstração: funcionários ana.souza, carla.mendes, bruno.tavares, diego.ramos; analistas rafael.lima e julia.castro (todos @nexo.com.br, qualquer senha).
      </p>
    </form>
  )
}
