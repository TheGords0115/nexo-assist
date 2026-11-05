'use client'

import { ArrowLeftRight, ExternalLink, Hand, Headphones, Loader2, LogOut, MessageSquare, Search, SendHorizontal, Undo2, X, XCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatRelative, formatTime } from '@nexo/domain'
import {
  TRANSFER_REASON_LABELS,
  type ChatMessage,
  type ConversationListItem,
  type ConversationView,
  type SessionUser,
  type TicketSummary,
} from '@/shared/types'
import { LogoMark } from '../Logo'
import { Avatar, StatusDot } from '../ui'
import { MessageItem } from '../chat/MessageItem'
import { logout } from '../EmployeeShell'

// Console do analista:
//  - coluna 1: conversas com filtros (Todas / Para você / Com o agent / Minhas) e busca;
//  - coluna 2: histórico da conversa (com a decisão do agent em cada resposta) e as ações
//    Assumir atendimento (pausa o agent), Devolver ao agent e Encerrar;
//  - coluna 3: chamados do funcionário.
// Atualiza sozinho a cada 4 s.

type Filter = 'todas' | 'para_voce' | 'com_agent' | 'minhas'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'para_voce', label: 'Para você' },
  { key: 'com_agent', label: 'Com o agent' },
  { key: 'minhas', label: 'Minhas' },
]

interface Detail {
  conversation: ConversationView
  messages: ChatMessage[]
  tickets: TicketSummary[]
  ticketsError: string | null
}

function statusLine(c: ConversationView, analystId: string): { text: string; cls: string } {
  if (c.status === 'waiting_analyst') {
    if (c.transfer?.reason === 'baixa_confianca') {
      return { text: `Agent pediu ajuda · confiança ${Math.round((c.transfer.confidence ?? 0) * 100)}%`, cls: 'text-warn' }
    }
    return { text: `Transferida · ${c.transfer?.ticketId ?? TRANSFER_REASON_LABELS[c.transfer?.reason ?? 'pedido_do_funcionario']}`, cls: 'text-danger' }
  }
  if (c.status === 'with_analyst') {
    return c.assignedAnalyst?.id === analystId
      ? { text: 'Você está atendendo', cls: 'text-brand' }
      : { text: `${c.assignedAnalyst?.name} atendendo`, cls: 'text-brand' }
  }
  if (c.status === 'agent') return { text: 'Agent atendendo', cls: 'text-ok' }
  return { text: c.resolvedByAgent ? 'Resolvida pelo agent' : 'Encerrada', cls: 'text-muted' }
}

export function Console({ analyst }: { analyst: SessionUser }) {
  const [filter, setFilter] = useState<Filter>('para_voce')
  const [query, setQuery] = useState('')
  const [list, setList] = useState<ConversationListItem[]>([])
  const [counts, setCounts] = useState<Record<Filter, number>>({ todas: 0, para_voce: 0, com_agent: 0, minhas: 0 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showTickets, setShowTickets] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadList = useCallback(async () => {
    const res = await fetch(`/api/console/conversations?filter=${filter}&q=${encodeURIComponent(query)}`)
    if (res.status === 401) return void (window.location.href = '/login')
    if (!res.ok) return
    const data = (await res.json()) as { conversations: ConversationListItem[]; counts: Record<Filter, number> }
    setList(data.conversations)
    setCounts(data.counts)
    setSelectedId((id) => id ?? data.conversations[0]?.id ?? null)
  }, [filter, query])

  const loadDetail = useCallback(async () => {
    if (!selectedId) return setDetail(null)
    const res = await fetch(`/api/console/conversations/${selectedId}`)
    if (res.ok) setDetail((await res.json()) as Detail)
  }, [selectedId])

  useEffect(() => {
    void loadList()
    const t = setInterval(() => void loadList(), 4000)
    return () => clearInterval(t)
  }, [loadList])

  useEffect(() => {
    void loadDetail()
    const t = setInterval(() => void loadDetail(), 4000)
    return () => clearInterval(t)
  }, [loadDetail])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [detail?.messages.length])

  async function act(action: 'assume' | 'release' | 'close' | 'reply', body?: unknown) {
    if (!selectedId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/console/conversations/${selectedId}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : null,
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Não foi possível concluir.')
      if (action === 'reply') setReply('')
      await Promise.all([loadDetail(), loadList()])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir.')
    } finally {
      setBusy(false)
    }
  }

  const conv = detail?.conversation
  const mine = conv?.status === 'with_analyst' && conv.assignedAnalyst?.id === analyst.id
  const firstName = conv?.employee.name.split(' ')[0]
  const thisTicket = detail?.tickets.find((t) => t.id === conv?.transfer?.ticketId) ?? null
  const otherTickets = detail?.tickets.filter((t) => t.id !== thisTicket?.id) ?? []
  const openCount = detail?.tickets.filter((t) => !['Resolvido', 'Fechado'].includes(t.status)).length ?? 0

  return (
    <div className="flex h-screen bg-white text-ink">
      {/* trilho de ícones */}
      <nav className="flex w-[52px] shrink-0 flex-col items-center gap-5 border-r border-line py-4">
        <LogoMark className="h-5 w-5" color="#0a63c9" />
        <span className="relative rounded-md bg-brand-soft p-2 text-brand">
          <MessageSquare className="h-4 w-4" />
          {counts.para_voce > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[9.5px] font-bold text-white">{counts.para_voce}</span>
          )}
        </span>
        <div className="mt-auto flex flex-col items-center gap-3">
          <button onClick={logout} title="Sair" className="text-faint hover:text-ink">
            <LogOut className="h-4 w-4" />
          </button>
          <Avatar name={analyst.name} size="sm" online />
        </div>
      </nav>

      {/* lista de conversas */}
      <section className="flex w-[300px] shrink-0 flex-col border-r border-line">
        <div className="px-4 pt-4">
          <div className="flex items-center justify-between">
            <h1 className="text-[17px] font-semibold">Conversas</h1>
            <span className="flex items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-0.5 text-[11px] font-medium text-ok">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Disponível
            </span>
          </div>
          <label className="mt-3 flex items-center gap-2 rounded-lg bg-canvas px-3 py-2">
            <Search className="h-3.5 w-3.5 text-faint" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar conversa ou chamado" className="w-full bg-transparent text-[12.5px] outline-none" />
          </label>
          <div className="mt-3 flex gap-1 overflow-x-auto pb-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`whitespace-nowrap rounded-md px-2 py-1 text-[11.5px] ${filter === f.key ? 'bg-brand-soft font-medium text-brand' : 'text-muted hover:bg-canvas'}`}
              >
                {f.label} {f.key !== 'todas' && <span className="ml-0.5">{counts[f.key]}</span>}
              </button>
            ))}
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {list.length === 0 && <li className="px-4 py-8 text-center text-[12px] text-muted">Nenhuma conversa neste filtro.</li>}
          {list.map((c) => {
            const line = statusLine(c, analyst.id)
            return (
              <li key={c.id}>
                <button
                  onClick={() => setSelectedId(c.id)}
                  className={`flex w-full gap-3 border-b border-line-soft px-4 py-3 text-left ${selectedId === c.id ? 'bg-canvas' : 'hover:bg-canvas/60'}`}
                >
                  <Avatar name={c.employee.name} online={c.status !== 'closed'} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="truncate text-[13px] font-semibold">{c.employee.name}</span>
                      <span className={`text-[10.5px] ${c.unreadForAnalyst ? 'font-semibold text-brand' : 'text-faint'}`}>
                        {c.lastMessage ? formatTime(c.lastMessage.at) : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[12px] text-muted">
                        {c.lastMessage?.role === 'assistant' ? 'Nexo: ' : ''}
                        {c.lastMessage?.content ?? 'Sem mensagens'}
                      </p>
                      {c.unreadForAnalyst > 0 && (
                        <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[9.5px] font-bold text-white">{c.unreadForAnalyst}</span>
                      )}
                    </div>
                    <p className={`mt-0.5 flex items-center gap-1 text-[11px] ${line.cls}`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" /> {line.text}
                    </p>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      {/* conversa */}
      <section className="flex min-w-0 flex-1 flex-col bg-canvas">
        {!conv ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-muted">Selecione uma conversa.</div>
        ) : (
          <>
            <header className="flex h-[56px] shrink-0 items-center gap-3 border-b border-line bg-white px-4">
              <Avatar name={conv.employee.name} size="sm" />
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold">{conv.employee.name}</p>
                <p className="truncate text-[11px] text-muted">
                  {conv.employee.department} · {conv.employee.device}
                  {conv.transfer?.ticketId ? ` · ${conv.transfer.ticketId}` : ''}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {conv.status === 'waiting_analyst' && (
                  <span className="flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-[11.5px] font-medium text-warn">
                    <Hand className="h-3.5 w-3.5" /> Aguardando atendente
                  </span>
                )}
                {mine && (
                  <>
                    <button disabled={busy} onClick={() => void act('release')} className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium hover:bg-canvas">
                      <Undo2 className="h-3.5 w-3.5" /> Devolver ao agent
                    </button>
                    <button disabled={busy} onClick={() => void act('close')} className="flex items-center gap-1.5 rounded-md border border-danger/30 px-2.5 py-1.5 text-[12px] font-medium text-danger hover:bg-danger-soft">
                      <XCircle className="h-3.5 w-3.5" /> Encerrar atendimento
                    </button>
                  </>
                )}
                {!showTickets && (
                  <button onClick={() => setShowTickets(true)} className="rounded-md border border-line px-2.5 py-1.5 text-[12px]">
                    Chamados
                  </button>
                )}
              </div>
            </header>

            {conv.transfer && conv.status === 'waiting_analyst' && (
              <div className="border-b border-line bg-white px-4 py-2.5 text-[12px]">
                <p className="font-semibold text-ink-soft">
                  {TRANSFER_REASON_LABELS[conv.transfer.reason]} · Suporte {conv.transfer.queue} · {formatRelative(conv.transfer.at)}
                </p>
                <p className="mt-0.5 text-muted">{conv.transfer.summary}</p>
              </div>
            )}

            <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
              <p className="mx-auto w-fit rounded-full bg-white px-3 py-0.5 text-[11px] text-muted shadow-sm">Histórico</p>
              {detail!.messages.map((m) => (
                <MessageItem key={m.id} message={m} perspective="analyst" />
              ))}
            </div>

            <footer className="shrink-0 border-t border-line bg-white px-4 py-3">
              {error && <p className="mb-2 rounded-md bg-danger-soft px-3 py-1.5 text-[12px] text-danger">{error}</p>}
              {conv.status === 'waiting_analyst' && (
                <div className="mb-2.5 flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-warn-soft text-warn">
                    <Hand className="h-3.5 w-3.5" />
                  </span>
                  <div className="text-[12px]">
                    <p className="font-semibold">{firstName} espera um atendente</p>
                    <p className="text-muted">Agent pausado · transferida {formatRelative(conv.transfer?.at ?? conv.updatedAt)}</p>
                  </div>
                  <div className="ml-auto flex gap-2">
                    <button disabled={busy} onClick={() => void act('release')} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] font-medium hover:bg-canvas">
                      <Undo2 className="h-3.5 w-3.5" /> Devolver ao agent
                    </button>
                    <button disabled={busy} onClick={() => void act('assume')} className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-dark">
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Headphones className="h-3.5 w-3.5" />} Assumir atendimento
                    </button>
                  </div>
                </div>
              )}
              {conv.status === 'agent' && (
                <div className="mb-2.5 flex items-center justify-between text-[12px] text-muted">
                  <span>O Nexo Assist está atendendo esta conversa.</span>
                  <button disabled={busy} onClick={() => void act('assume')} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 font-medium text-ink hover:bg-canvas">
                    <Headphones className="h-3.5 w-3.5" /> Assumir mesmo assim
                  </button>
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (reply.trim()) void act('reply', { text: reply })
                }}
                className="flex items-center gap-2"
              >
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  disabled={!mine || busy}
                  placeholder={mine ? `Responder ${firstName}…` : conv.status === 'closed' ? 'Atendimento encerrado' : 'Assuma o atendimento para responder'}
                  className="h-10 flex-1 rounded-lg border border-line bg-canvas px-3 text-[12.5px] outline-none focus:border-brand disabled:cursor-not-allowed"
                />
                <button disabled={!mine || busy || !reply.trim()} className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white disabled:opacity-40" aria-label="Enviar">
                  <SendHorizontal className="h-4 w-4" />
                </button>
              </form>
            </footer>
          </>
        )}
      </section>

      {/* chamados do funcionário */}
      {conv && showTickets && (
        <aside className="hidden w-[270px] shrink-0 flex-col border-l border-line xl:flex">
          <div className="flex items-start justify-between px-4 py-3.5">
            <div>
              <p className="text-[13.5px] font-semibold">Chamados de {firstName}</p>
              <p className="text-[11px] text-muted">
                {openCount} abertos · {(detail?.tickets.length ?? 0) - openCount} encerrados
              </p>
            </div>
            <button onClick={() => setShowTickets(false)} className="text-faint hover:text-ink" aria-label="Fechar painel">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4">
            {detail?.ticketsError && <p className="rounded-md bg-warn-soft px-3 py-2 text-[11.5px] text-warn">{detail.ticketsError}</p>}
            {thisTicket && (
              <>
                <p className="mb-2 text-[11px] font-medium text-muted">Desta conversa</p>
                <div className="rounded-lg border border-line bg-canvas p-3">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono text-muted">{thisTicket.id}</span>
                    <span className="flex items-center gap-1 font-medium text-warn">
                      <StatusDot status={thisTicket.status} /> {thisTicket.status}
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] font-semibold">{thisTicket.title}</p>
                  <p className="text-[11px] text-muted">
                    {thisTicket.category} · prioridade {thisTicket.priority.toLowerCase()}
                    {thisTicket.overdue ? ' · prazo vencido' : ''}
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 border-t border-line pt-2 text-[11px] text-muted">
                    <ArrowLeftRight className="h-3 w-3" />
                    {conv.status === 'with_analyst' ? `Assumido por ${conv.assignedAnalyst?.name}` : 'Transferido para um analista'}
                  </p>
                </div>
              </>
            )}
            <p className="mb-1 mt-4 text-[11px] font-medium text-muted">{thisTicket ? 'Outros chamados' : 'Chamados'}</p>
            <ul>
              {otherTickets.map((t) => (
                <li key={t.id} className="flex items-start gap-2 border-b border-line-soft py-2.5">
                  <StatusDot status={t.status} className="mt-1.5" />
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium">{t.title}</p>
                    <p className="text-[11px] text-muted">
                      {t.id} · {t.status}
                      {t.overdue ? ' · vencido' : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-line p-3">
            <span className="flex w-full items-center justify-center gap-1.5 rounded-md border border-line py-1.5 text-[12px] text-ink-soft">
              Ver todos os chamados de {firstName} <ExternalLink className="h-3 w-3" />
            </span>
          </div>
        </aside>
      )}
    </div>
  )
}
