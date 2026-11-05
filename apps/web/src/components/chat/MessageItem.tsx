'use client'

import { ArrowLeftRight, Check, ChevronDown, ChevronUp, Headphones, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { formatTime } from '@nexo/domain'
import type { ChatMessage, DraftView, TicketSummary, TraceStep } from '@/shared/types'
import { DecisionPanel } from './DecisionPanel'
import { DraftCard, TicketDetailCard, TicketSelectCard, TransferCard } from './cards'

// Uma mensagem da conversa. A mesma peça serve para as duas telas:
//  - "employee": visão do funcionário (Telas 2 e 3), com cards e botões;
//  - "analyst": visão do console (Telas 4 e 5), lado a lado como num chat de atendimento.

export interface DraftHandlers {
  activeDraftId: string | null
  busyDraftId: string | null
  onConfirm: (draft: DraftView) => void
  onEdit: (draft: DraftView) => void
  onCancel: (draft: DraftView) => void
}

interface Props {
  message: ChatMessage
  perspective: 'employee' | 'analyst'
  /** Só a última resposta do agent mostra opções rápidas e permite selecionar chamado. */
  interactive?: boolean
  onQuickReply?: (text: string) => void
  onSelectTicket?: (ticket: TicketSummary) => void
  drafts?: DraftHandlers
}

/** Linha "Nexo Assist ✓ consultou seus chamados ✓ ..." que abre o detalhe da decisão. */
export function ActionsLine({ steps, open, onToggle, running }: { steps: TraceStep[]; open?: boolean; onToggle?: () => void; running?: string | null }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-muted">
      <span className="font-semibold text-ink">Nexo Assist</span>
      {steps.map((s, i) => (
        <span key={i} className={`flex items-center gap-1 ${s.ok ? '' : 'text-danger'}`}>
          <Check className="h-3 w-3" /> {s.label}
        </span>
      ))}
      {running && (
        <span className="flex items-center gap-1 text-brand">
          <Loader2 className="h-3 w-3 animate-spin" /> {running}…
        </span>
      )}
      {onToggle && (
        <button onClick={onToggle} className="flex items-center gap-0.5 rounded px-1 text-brand hover:bg-brand-soft">
          {open ? 'ocultar detalhes' : 'por quê?'} {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      )}
    </div>
  )
}

export function MessageItem({ message, perspective, interactive = false, onQuickReply, onSelectTicket, drafts }: Props) {
  const [open, setOpen] = useState(false)

  if (message.role === 'system') {
    const icon = message.content.includes('assumiu') ? <Headphones className="h-3 w-3" /> : <ArrowLeftRight className="h-3 w-3" />
    return (
      <div className="flex items-center gap-3 py-1 text-[11px] text-muted">
        <span className="h-px flex-1 bg-line" />
        <span className="flex items-center gap-1.5">
          {icon} {message.content} · {formatTime(message.createdAt)}
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>
    )
  }

  // ---------- Visão do console (analista) ----------
  if (perspective === 'analyst') {
    const fromEmployee = message.role === 'user'
    const isAgent = message.role === 'assistant'
    return (
      <div className={`flex flex-col ${fromEmployee ? 'items-start' : 'items-end'}`}>
        {!fromEmployee && (
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted">
            {isAgent ? 'Nexo Assist' : message.authorName}
            <span className={`rounded px-1 text-[10px] font-semibold ${isAgent ? 'bg-brand-soft text-brand' : 'bg-analyst-soft text-ok'}`}>{isAgent ? 'IA' : 'Analista'}</span>
            {isAgent && message.trace && (
              <button onClick={() => setOpen((o) => !o)} className="text-brand hover:underline">
                {open ? 'ocultar decisão' : 'ver decisão'}
              </button>
            )}
          </p>
        )}
        <div
          className={`max-w-[78%] rounded-lg px-3 py-2 text-[12.5px] leading-relaxed shadow-sm ${
            fromEmployee ? 'bg-white' : isAgent ? 'bg-brand-soft' : 'bg-analyst-soft'
          }`}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
          {message.cards.map((c, i) =>
            c.kind === 'ticket_detail' ? (
              <p key={i} className="mt-1 text-[11px] text-muted">
                [card] {c.ticket.id} · {c.ticket.status}
                {c.ticket.overdue ? ' · vencido' : ''}
              </p>
            ) : c.kind === 'draft' ? (
              <p key={i} className="mt-1 text-[11px] text-muted">
                [rascunho {c.draft.id}] {c.draft.title} · {c.draft.priority} · {c.draft.status}
              </p>
            ) : c.kind === 'ticket_select' ? (
              <p key={i} className="mt-1 text-[11px] text-muted">
                [lista] {c.tickets.map((t) => t.id).join(', ')}
              </p>
            ) : null,
          )}
          <p className="mt-0.5 text-right text-[10px] text-faint">{formatTime(message.createdAt)}</p>
        </div>
        {open && message.trace && (
          <div className="w-full max-w-[78%]">
            <DecisionPanel trace={message.trace} />
          </div>
        )}
      </div>
    )
  }

  // ---------- Visão do funcionário ----------
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] whitespace-pre-wrap rounded-lg bg-navy px-3.5 py-2 text-[13px] leading-relaxed text-white">{message.content}</div>
      </div>
    )
  }

  if (message.role === 'analyst') {
    return (
      <div className="max-w-[85%]">
        <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] text-muted">
          <span className="font-semibold text-ink">{message.authorName}</span>
          <span className="rounded bg-analyst-soft px-1 text-[10px] font-semibold text-ok">Analista</span>
        </p>
        <div className="whitespace-pre-wrap rounded-lg border border-ok/20 bg-analyst-soft px-3.5 py-2.5 text-[13px] leading-relaxed">{message.content}</div>
      </div>
    )
  }

  // Resposta do agent.
  const trace = message.trace
  return (
    <div className="max-w-[92%]">
      <ActionsLine steps={trace?.steps ?? []} open={open} onToggle={trace ? () => setOpen((o) => !o) : undefined} />
      {open && trace && <DecisionPanel trace={trace} />}
      <div className={`space-y-2 ${open ? 'mt-2' : ''}`}>
        {(message.content || (interactive && message.quickReplies.length > 0)) && (
          <div className="max-w-[560px] rounded-lg border border-line bg-white px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm">
            <p className="whitespace-pre-wrap">{message.content}</p>
            {interactive && message.quickReplies.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {message.quickReplies.map((q) => (
                  <button key={q} onClick={() => onQuickReply?.(q)} className="rounded-md border border-line px-2.5 py-1 text-[12px] hover:border-brand hover:bg-brand-soft hover:text-brand">
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {message.cards.map((card, i) => {
          switch (card.kind) {
            case 'ticket_select':
              return <TicketSelectCard key={i} tickets={card.tickets} disabled={!interactive} onSelect={(t) => onSelectTicket?.(t)} />
            case 'ticket_detail':
              return <TicketDetailCard key={i} ticket={card.ticket} />
            case 'draft':
              return (
                <DraftCard
                  key={i}
                  draft={card.draft}
                  active={drafts?.activeDraftId === card.draft.id}
                  busy={drafts?.busyDraftId === card.draft.id}
                  onConfirm={() => drafts?.onConfirm(card.draft)}
                  onEdit={() => drafts?.onEdit(card.draft)}
                  onCancel={() => drafts?.onCancel(card.draft)}
                />
              )
            case 'transfer':
              return <TransferCard key={i} queue={card.queue} summary={card.summary} />
            case 'articles':
              return null
          }
        })}
      </div>
    </div>
  )
}
