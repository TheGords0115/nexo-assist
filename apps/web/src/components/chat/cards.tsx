'use client'

import { ArrowLeftRight, Check, Pencil, X } from 'lucide-react'
import { formatDayMonth, formatDateTime, formatDue, formatRelative } from '@nexo/domain'
import type { DraftView, TicketDetail, TicketSummary } from '@/shared/types'
import { PriorityLabel, StatusDot, StatusLabel } from '../ui'

// Cards que aparecem dentro das respostas do agent. Os dados vêm das tools (do sistema de
// chamados), nunca do texto do modelo, então número, status e prazo são sempre os reais.

/** Tela 3: escolher entre os chamados abertos. */
export function TicketSelectCard({ tickets, onSelect, disabled }: { tickets: TicketSummary[]; onSelect: (t: TicketSummary) => void; disabled: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      {tickets.map((t) => (
        <button
          key={t.id}
          disabled={disabled}
          onClick={() => onSelect(t)}
          className="flex w-full items-center gap-3 border-b border-line px-3.5 py-2.5 text-left text-[12.5px] last:border-0 enabled:hover:bg-canvas disabled:cursor-default"
        >
          <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-faint" />
          <span className="w-[74px] shrink-0 font-mono text-[11.5px] text-muted">{t.id}</span>
          <span className="min-w-0 flex-1 truncate">{t.title}</span>
          <span className="shrink-0">
            <StatusLabel status={t.status} />
          </span>
          {t.overdue && <span className="shrink-0 rounded bg-danger-soft px-1.5 py-0.5 text-[10.5px] font-medium text-danger">vencido</span>}
          <span className="w-12 shrink-0 text-right text-[11px] text-faint">{formatDayMonth(t.createdAt)}</span>
        </button>
      ))}
    </div>
  )
}

/** Tela 3: detalhe do chamado com prazo (vencido em destaque). */
export function TicketDetailCard({ ticket }: { ticket: TicketDetail }) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3.5 shadow-sm">
      <div className="flex items-center justify-between text-[11.5px] text-muted">
        <span>
          Chamado · <span className="font-mono">{ticket.id}</span>
        </span>
        <StatusLabel status={ticket.status} />
      </div>
      <p className="mt-1.5 text-[15px] font-semibold">{ticket.title}</p>
      <p className="mt-0.5 text-[12.5px] text-muted">{ticket.description}</p>
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 text-[12px] sm:grid-cols-4">
        <Field label="Categoria" value={ticket.category} />
        <Field label="Prioridade" value={<PriorityLabel priority={ticket.priority} />} />
        <Field label="Aberto em" value={formatDateTime(ticket.createdAt)} />
        <Field
          label="Última atualização"
          value={
            <span className={ticket.overdue ? 'font-medium text-warn' : ''}>
              {formatRelative(ticket.lastActivityAt)}
              {ticket.overdue && <span className="font-normal text-muted"> · prazo vencido</span>}
            </span>
          }
        />
      </div>
      {ticket.lastUpdate && (
        <p className="mt-3 rounded-md bg-canvas px-3 py-2 text-[11.5px] text-muted">
          <span className="font-medium text-ink-soft">{ticket.lastUpdate.author}:</span> {ticket.lastUpdate.note}
        </p>
      )}
      {ticket.dueAt && !ticket.overdue && <p className="mt-2 text-[11.5px] text-muted">Próxima resposta {formatDue(ticket.dueAt)}</p>}
    </div>
  )
}

/** Tela 2: rascunho para confirmação. Nada é criado antes de "Confirmar". */
export function DraftCard({
  draft,
  active,
  busy,
  onConfirm,
  onEdit,
  onCancel,
}: {
  draft: DraftView
  active: boolean
  busy: boolean
  onConfirm: () => void
  onEdit: () => void
  onCancel: () => void
}) {
  const isUpdate = draft.kind === 'update'
  const statusText: Record<DraftView['status'], { text: string; cls: string }> = {
    pending: { text: 'Aguardando confirmação', cls: 'text-warn' },
    confirmed: { text: `Confirmado · ${draft.ticketId ?? ''}`, cls: 'text-ok' },
    cancelled: { text: 'Cancelado', cls: 'text-muted' },
    superseded: { text: 'Substituído por um rascunho novo', cls: 'text-muted' },
    failed: { text: 'Não foi possível registrar', cls: 'text-danger' },
  }
  const status = statusText[draft.status]
  return (
    <div className={`overflow-hidden rounded-lg border bg-white shadow-sm ${draft.status === 'pending' ? 'border-line' : 'border-line opacity-80'}`}>
      <div className="px-4 py-3.5">
        <div className="flex items-center justify-between text-[11.5px] text-muted">
          <span>
            {isUpdate ? `Atualizar ${draft.ticketId}` : 'Novo chamado'} · Rascunho {draft.id}
          </span>
          <span className={`flex items-center gap-1.5 font-medium ${status.cls}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" /> {status.text}
          </span>
        </div>
        <p className="mt-1.5 text-[15px] font-semibold">{draft.title}</p>
        <p className="mt-0.5 text-[12.5px] text-muted">{isUpdate ? draft.note : draft.description}</p>
        {isUpdate && draft.reopen && <p className="mt-1 text-[11.5px] font-medium text-warn">O chamado será reaberto.</p>}
        <div className="mt-3 grid grid-cols-3 gap-3 border-t border-line pt-3 text-[12px]">
          <Field label="Categoria" value={draft.category} />
          <Field
            label="Prioridade"
            value={
              <span>
                <PriorityLabel priority={draft.priority} />
                <span className="text-muted"> · resposta {formatDue(draft.dueAt)}</span>
              </span>
            }
          />
          <Field label="Afetados" value={draft.affected} />
        </div>
        {draft.error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-[11.5px] text-danger">{draft.error}</p>}
      </div>
      {active && draft.status === 'pending' && (
        <div className="flex items-center gap-2 border-t border-line bg-canvas px-3 py-2.5">
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
          >
            <Check className="h-3.5 w-3.5" /> {busy ? 'Registrando…' : 'Confirmar'}
            <kbd className="ml-1 rounded bg-white/20 px-1 text-[10px] font-normal">Ctrl ↵</kbd>
          </button>
          <button onClick={onEdit} disabled={busy} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-[12.5px] font-medium hover:bg-canvas">
            <Pencil className="h-3.5 w-3.5" /> Editar
          </button>
          <button onClick={onCancel} disabled={busy} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium text-muted hover:text-ink">
            <X className="h-3.5 w-3.5" /> Cancelar
          </button>
        </div>
      )}
    </div>
  )
}

export function TransferCard({ queue, summary }: { queue: string; summary: string }) {
  return (
    <div className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-[12.5px]">
      <p className="flex items-center gap-2 font-semibold text-warn">
        <ArrowLeftRight className="h-3.5 w-3.5" /> Encaminhado ao Suporte {queue}
      </p>
      <p className="mt-1 text-ink-soft">
        <span className="text-muted">Resumo enviado ao analista:</span> {summary}
      </p>
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-muted">{label}</p>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  )
}

export { StatusDot }
