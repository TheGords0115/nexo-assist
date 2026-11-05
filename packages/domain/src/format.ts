/** Formatação de datas em pt-BR no fuso de Brasília, usada pela interface e pelo agent. */

const TZ = 'America/Sao_Paulo'

export function formatDayMonth(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: TZ })
    .format(new Date(iso))
    .replace('.', '')
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(iso))
}

export function formatDateTime(iso: string): string {
  return `${formatDayMonth(iso)}, ${formatTime(iso)}`
}

/** "há 5 dias", "há 3 horas", "agora". */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime()
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `há ${hours} ${hours === 1 ? 'hora' : 'horas'}`
  const days = Math.round(hours / 24)
  if (days < 7) return `há ${days} ${days === 1 ? 'dia' : 'dias'}`
  const weeks = Math.round(days / 7)
  if (days < 30) return `há ${weeks} ${weeks === 1 ? 'semana' : 'semanas'}`
  const months = Math.round(days / 30)
  return `há ${months} ${months === 1 ? 'mês' : 'meses'}`
}

/** "até 13:43" se for hoje, "até 07 nov, 13:43" se não. */
export function formatDue(iso: string, now: Date = new Date()): string {
  const sameDay = formatDayMonth(iso) === formatDayMonth(now.toISOString())
  return sameDay ? `até ${formatTime(iso)}` : `até ${formatDateTime(iso)}`
}
