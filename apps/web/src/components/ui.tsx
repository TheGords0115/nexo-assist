import type { Priority, TicketStatus } from '@nexo/domain'

// Peças pequenas reaproveitadas nas telas (avatar, selos de status e prioridade).

const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-orange-100 text-orange-700',
  'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700',
  'bg-rose-100 text-rose-700',
  'bg-gray-100 text-gray-600',
  'bg-amber-100 text-amber-700',
]

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

export function Avatar({ name, size = 'md', online }: { name: string; size?: 'sm' | 'md'; online?: boolean }) {
  const color = AVATAR_COLORS[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % AVATAR_COLORS.length]
  const dim = size === 'sm' ? 'h-7 w-7 text-[10.5px]' : 'h-9 w-9 text-[12px]'
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${dim} ${color}`}>
      {initials(name)}
      {online !== undefined && (
        <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${online ? 'bg-ok' : 'bg-faint'}`} />
      )}
    </span>
  )
}

const STATUS_COLORS: Record<TicketStatus, string> = {
  Aberto: 'bg-brand',
  'Em andamento': 'bg-brand',
  'Aguardando analista': 'bg-warn',
  Aprovado: 'bg-ok',
  Resolvido: 'bg-faint',
  Fechado: 'bg-faint',
}

export function StatusDot({ status, className = '' }: { status: TicketStatus; className?: string }) {
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_COLORS[status]} ${className}`} />
}

export function StatusLabel({ status }: { status: TicketStatus }) {
  const text = status === 'Aguardando analista' ? 'text-warn' : status === 'Aprovado' ? 'text-ok' : status === 'Resolvido' || status === 'Fechado' ? 'text-muted' : 'text-brand'
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11.5px] font-medium ${text}`}>
      <StatusDot status={status} /> {status}
    </span>
  )
}

const PRIORITY_DOT: Record<Priority, string> = {
  Crítica: 'bg-danger',
  Alta: 'bg-warn',
  Média: 'bg-faint',
  Baixa: 'bg-line',
}

export function PriorityLabel({ priority }: { priority: Priority }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[priority]}`} />
      {priority}
    </span>
  )
}
