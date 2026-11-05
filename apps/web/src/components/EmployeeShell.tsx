'use client'

import { ChevronRight, LogOut, MessageSquare, User } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { SessionUser } from '@/shared/types'
import { Logo } from './Logo'
import { Avatar } from './ui'

// Moldura das telas do funcionário: barra lateral (Atendimento / Meu perfil / usuário) e cabeçalho
// com o caminho e o status do assistente, como no protótipo.

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' })
  window.location.href = '/login'
}

export function EmployeeShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const pathname = usePathname()
  const page = pathname.startsWith('/perfil') ? 'Meu perfil' : 'Atendimento'
  const nav = [
    { href: '/atendimento', label: 'Atendimento', icon: MessageSquare },
    { href: '/perfil', label: 'Meu perfil', icon: User },
  ]

  return (
    <div className="flex h-screen bg-white">
      <aside className="hidden w-[208px] shrink-0 flex-col border-r border-line px-3 py-4 md:flex">
        <div className="px-2">
          <Logo />
        </div>
        <nav className="mt-6 space-y-1">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] ${active ? 'bg-brand-soft font-medium text-brand' : 'text-ink-soft hover:bg-canvas'}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto border-t border-line pt-3">
          <div className="flex items-center gap-2.5 px-1">
            <Avatar name={user.name} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-semibold">{user.name}</p>
              <p className="truncate text-[11px] text-muted">{user.email}</p>
            </div>
          </div>
          <button onClick={logout} className="mt-3 flex items-center gap-2 px-1.5 text-[12.5px] text-muted hover:text-ink">
            <LogOut className="h-3.5 w-3.5" /> Sair
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-dashed border-line px-5">
          <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
            Service desk de TI <ChevronRight className="h-3.5 w-3.5" /> <span className="font-medium text-ink">{page}</span>
          </p>
          {page === 'Atendimento' && (
            <span className="flex items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-1 text-[11.5px] font-medium text-ok">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Assistente online
            </span>
          )}
          <button onClick={logout} className="text-[12px] text-muted md:hidden">
            Sair
          </button>
        </header>
        <main className="min-h-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
