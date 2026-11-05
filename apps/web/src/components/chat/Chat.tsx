'use client'

import { ArrowUp, Headphones, Loader2, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage, ChatStreamEvent, ConversationView, DraftView, TicketSummary, TraceStep } from '@/shared/types'
import { ActionsLine, MessageItem } from './MessageItem'

// Tela de atendimento do funcionário (Telas 2 e 3).
// - envia a mensagem e lê a resposta em tempo real (SSE): passos, texto e mensagem final;
// - quando a conversa está com um analista, o agent fica pausado e a tela busca novidades a cada 3 s;
// - rascunho pendente pode ser confirmado com Ctrl+Enter;
// - limite de mensagens por sessão (30), com contador embaixo do campo.

interface Streaming {
  steps: TraceStep[]
  running: string | null
  text: string
}

async function readEvents(res: Response, onEvent: (e: ChatStreamEvent) => void): Promise<void> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      if (raw.startsWith('data: ')) onEvent(JSON.parse(raw.slice(6)) as ChatStreamEvent)
    }
  }
}

export function Chat() {
  const [conversation, setConversation] = useState<ConversationView | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [streaming, setStreaming] = useState<Streaming | null>(null)
  const [input, setInput] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [busyDraftId, setBusyDraftId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const sending = streaming !== null
  const paused = conversation?.status === 'waiting_analyst' || conversation?.status === 'with_analyst'
  const limitReached = !!conversation && conversation.userMessageCount >= conversation.messageLimit
  const closed = conversation?.status === 'closed'

  // Carrega a conversa em aberto (ou cria uma), para continuar de onde parou.
  const load = useCallback(async () => {
    try {
      let res = await fetch('/api/conversation')
      if (res.status === 401) {
        window.location.href = '/login'
        return
      }
      let data = (await res.json()) as { conversation: ConversationView | null; messages: ChatMessage[] }
      if (!data.conversation) {
        res = await fetch('/api/conversation', { method: 'POST' })
        data = await res.json()
      }
      setConversation(data.conversation)
      setMessages(data.messages)
    } catch {
      setNotice('Não consegui carregar sua conversa. Atualize a página.')
    } finally {
      setLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!conversation) return
    const res = await fetch(`/api/conversation/${conversation.id}/messages`)
    if (!res.ok) return
    const data = (await res.json()) as { conversation: ConversationView; messages: ChatMessage[] }
    setConversation(data.conversation)
    setMessages(data.messages)
  }, [conversation])

  useEffect(() => {
    void load()
  }, [load])

  // Com analista: busca mensagens novas a cada 3 s (o agent não responde nesse período).
  useEffect(() => {
    if (!paused || sending) return
    const timer = setInterval(() => void refresh(), 3000)
    return () => clearInterval(timer)
  }, [paused, sending, refresh])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streaming])

  const lastAgentIndex = useMemo(() => messages.findLastIndex((m) => m.role === 'assistant'), [messages])
  const activeDraft = useMemo<DraftView | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const card of messages[i]!.cards) if (card.kind === 'draft' && card.draft.status === 'pending') return card.draft
    }
    return null
  }, [messages])

  async function send(text: string) {
    const content = text.trim()
    if (!content || !conversation || sending) return
    setInput('')
    setNotice(null)
    setStreaming({ steps: [], running: null, text: '' })
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId: conversation.id, text: content }),
      })
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? 'Não consegui enviar sua mensagem.')
      }
      await readEvents(res, (event) => {
        switch (event.type) {
          case 'user_message':
            setMessages((m) => [...m, event.message])
            break
          case 'step_start':
            setStreaming((s) => s && { ...s, running: event.label })
            break
          case 'step_end':
            setStreaming((s) => s && { ...s, running: null, steps: [...s.steps, event.step] })
            break
          case 'delta':
            setStreaming((s) => s && { ...s, text: s.text + event.text })
            break
          case 'message':
            setMessages((m) => [...m, event.message])
            break
          case 'conversation':
            setConversation(event.conversation)
            break
          case 'paused':
            setNotice(event.reason)
            break
          case 'error':
            setNotice(event.message)
            break
          case 'done':
            break
        }
      })
      // Garante que o card do rascunho reflita o estado salvo (ex.: rascunho anterior substituído).
      await refresh()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Não consegui enviar sua mensagem.')
      setInput(content)
    } finally {
      setStreaming(null)
    }
  }

  async function draftAction(draft: DraftView, action: 'confirm' | 'cancel') {
    setBusyDraftId(draft.id)
    setNotice(null)
    try {
      const res = await fetch(`/api/drafts/${draft.id}/${action}`, { method: 'POST' })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Não foi possível concluir.')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Não foi possível concluir.')
    } finally {
      setBusyDraftId(null)
      await refresh()
    }
  }

  // Ctrl+Enter confirma o rascunho pendente (atalho do protótipo).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && activeDraft && !busyDraftId && !sending) {
        e.preventDefault()
        void draftAction(activeDraft, 'confirm')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function newConversation() {
    const res = await fetch('/api/conversation', { method: 'POST' })
    const data = (await res.json()) as { conversation: ConversationView; messages: ChatMessage[] }
    setConversation(data.conversation)
    setMessages(data.messages)
    setNotice(null)
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando sua conversa…
      </div>
    )
  }

  const firstName = conversation?.employee.name.split(' ')[0] ?? ''
  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[600px] space-y-5 px-5 py-8">
          {messages.length === 0 && (
            <div className="rounded-lg border border-dashed border-line px-5 py-6 text-center">
              <p className="font-serif text-[20px]">Olá, {firstName}. Como posso ajudar?</p>
              <p className="mt-1 text-[12.5px] text-muted">Descreva o problema com suas palavras. Eu consulto seus chamados e a central de ajuda.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                {['Qual o status do meu chamado?', 'Minha VPN não conecta', 'Preciso de um software novo'].map((s) => (
                  <button key={s} onClick={() => void send(s)} className="rounded-md border border-line px-2.5 py-1 text-[12px] hover:border-brand hover:text-brand">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <MessageItem
              key={m.id}
              message={m}
              perspective="employee"
              interactive={i === lastAgentIndex && i === messages.length - 1 && !sending && !paused}
              onQuickReply={(q) => void send(q)}
              onSelectTicket={(t: TicketSummary) => void send(`${t.id} · ${t.title}`)}
              drafts={{
                activeDraftId: activeDraft?.id ?? null,
                busyDraftId,
                onConfirm: (d) => void draftAction(d, 'confirm'),
                onCancel: (d) => void draftAction(d, 'cancel'),
                onEdit: () => {
                  setInput('')
                  inputRef.current?.focus()
                  setNotice('Diga o que quer mudar no rascunho, que eu monto de novo.')
                },
              }}
            />
          ))}

          {streaming && (
            <div className="max-w-[92%]">
              <ActionsLine steps={streaming.steps} running={streaming.running ?? (streaming.text ? null : 'pensando')} />
              {streaming.text && (
                <div className="typing-caret max-w-[560px] whitespace-pre-wrap rounded-lg border border-line bg-white px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm">
                  {streaming.text}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-5 pb-4">
        <div className="mx-auto max-w-[600px]">
          {paused && (
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[12px] text-warn">
              <Headphones className="h-3.5 w-3.5" />
              {conversation?.status === 'with_analyst'
                ? `${conversation.assignedAnalyst?.name} está te atendendo. O assistente está pausado.`
                : 'Um analista vai assumir sua conversa. Enquanto isso, o assistente fica pausado; pode deixar mensagens.'}
            </div>
          )}
          {notice && !paused && <div className="mb-2 rounded-lg bg-canvas px-3 py-2 text-[12px] text-ink-soft">{notice}</div>}

          {limitReached || closed ? (
            <div className="flex items-center justify-between rounded-lg border border-line px-4 py-3 text-[12.5px]">
              <span className="text-muted">{closed ? 'Este atendimento foi encerrado.' : 'Você chegou ao limite de mensagens desta sessão.'}</span>
              <button onClick={() => void newConversation()} className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 font-semibold text-white">
                <RotateCcw className="h-3.5 w-3.5" /> Nova conversa
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void send(input)
              }}
              className="flex items-end gap-2 rounded-lg border border-line px-3 py-2 shadow-sm focus-within:border-brand"
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault()
                    void send(input)
                  }
                }}
                rows={1}
                maxLength={2000}
                placeholder={paused ? 'Escreva para o analista…' : 'Escreva para o Nexo…'}
                className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[13px] outline-none"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />} Enviar
              </button>
            </form>
          )}
          <p className="mt-1.5 text-right text-[11px] text-faint">
            {conversation?.userMessageCount ?? 0}/{conversation?.messageLimit ?? 30} mensagens nesta sessão
          </p>
        </div>
      </div>
    </div>
  )
}
