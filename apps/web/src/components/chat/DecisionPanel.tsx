'use client'

import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from 'lucide-react'
import { INTENT_LABELS, type AgentTrace } from '@/shared/types'

// Detalhe de uma resposta do agent: o que ele entendeu, que ação tomou, com que segurança e por quê,
// além de cada ferramenta usada (entrada e saída) e das regras que o sistema aplicou em código.
// Abre ao clicar na linha de ações acima da resposta (item 7 do PRD).

export function DecisionPanel({ trace }: { trace: AgentTrace }) {
  const d = trace.decision
  const pct = d ? Math.round(d.confidence * 100) : null
  const barColor = pct == null ? 'bg-faint' : pct >= 75 ? 'bg-ok' : pct >= 50 ? 'bg-warn' : 'bg-danger'

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-line bg-canvas/70 p-3.5 text-[12px] leading-relaxed">
      {d ? (
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-[110px_1fr]">
          <Label>Entendi</Label>
          <p>{d.understood}</p>
          <Label>Intenção</Label>
          <p className="font-medium">{INTENT_LABELS[d.intent]}</p>
          <Label>Ação</Label>
          <p>{d.action}</p>
          <Label>Segurança</Label>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-line">
              <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="font-medium">{pct}%</span>
            {pct != null && pct < 50 && <span className="text-danger">abaixo do limite: transferido</span>}
          </div>
          <Label>Por quê</Label>
          <p>{d.reasoning}</p>
          {d.rulesApplied.length > 0 && (
            <>
              <Label>Regras citadas</Label>
              <div className="flex flex-wrap gap-1.5">
                {d.rulesApplied.map((r) => (
                  <span key={r} className="rounded-full border border-line bg-white px-2 py-0.5 text-[11px]">
                    {r}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="text-muted">Ação feita direto pelo sistema, sem passar pelo modelo.</p>
      )}

      {trace.steps.length > 0 && (
        <div>
          <p className="mb-1.5 font-semibold text-ink-soft">Ferramentas usadas</p>
          <ol className="space-y-1.5">
            {trace.steps.map((s, i) => (
              <li key={i} className="rounded-md border border-line bg-white px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  {s.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-ok" /> : <XCircle className="h-3.5 w-3.5 text-danger" />}
                  <span className="font-medium">{s.label}</span>
                  <code className="ml-auto text-[10.5px] text-faint">
                    {s.tool} · {s.durationMs} ms{s.retries > 0 ? ` · ${s.retries} nova(s) tentativa(s)` : ''}
                  </code>
                </div>
                {Object.keys(s.input).length > 0 && (
                  <p className="mt-1 break-words font-mono text-[10.5px] text-muted">entrada: {JSON.stringify(s.input)}</p>
                )}
                <p className="mt-0.5 text-[11.5px] text-ink-soft">→ {s.output}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {trace.guardrails.length > 0 && (
        <div>
          <p className="mb-1.5 font-semibold text-ink-soft">Regras aplicadas pelo sistema</p>
          <ul className="space-y-1">
            {trace.guardrails.map((g, i) => (
              <li key={i} className="flex gap-1.5">
                {g.rule.startsWith('Falha') ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" /> : <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />}
                <span>
                  <span className="font-medium">{g.rule}:</span> {g.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-line pt-2 font-mono text-[10.5px] text-faint">
        {trace.model} · {(trace.latencyMs / 1000).toFixed(1)} s · {trace.usage.inputTokens} tokens de entrada
        {trace.usage.cachedInputTokens > 0 ? ` (${trace.usage.cachedInputTokens} do cache)` : ''} · {trace.usage.outputTokens} de saída
        {trace.costUsd != null ? ` · ~US$ ${trace.costUsd.toFixed(4)}` : ''}
      </p>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-muted">{children}</p>
}
