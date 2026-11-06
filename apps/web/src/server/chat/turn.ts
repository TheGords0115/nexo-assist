import type { Employee } from '@nexo/domain'
import { formatDateTime } from '@nexo/domain'
import type { AgentTrace, Card, ChatMessage, ChatStreamEvent, ConversationView, Decision, Guardrail } from '@/shared/types'
import { NEXO_MODEL, estimateCost, nexoAgent, type TurnOutput } from '@/server/agent/agent'
import { createTurnContext, type TurnState } from '@/server/agent/context'
import { RUNNING_LABELS } from '@/server/agent/tools'
import { TicketsClient } from '@/server/tickets/client'
import {
  MESSAGE_LIMIT,
  appendMessage,
  getConversation,
  getDraft,
  getPendingDraft,
  listMessages,
  saveDraft,
  updateConversation,
} from '@/server/store/conversations'
import { transferConversation } from './actions'

// Fluxo de um turno do chat (uma mensagem do funcionário):
//  1. confere se a conversa está com o agent (se estiver com analista, o agent NÃO responde);
//  2. confere o limite de mensagens da sessão;
//  3. salva a mensagem e chama o agent com as últimas mensagens + contexto do funcionário;
//  4. repassa para a tela, em tempo real, as ações (tools) e o texto da resposta;
//  5. aplica regras de saída em código (ex.: confiança baixa → transfere) e salva tudo.

/** Abaixo disso o agent "não tem segurança" e a conversa vai para um analista (Anexo A). */
export const CONFIDENCE_THRESHOLD = 0.5
/** Quantas mensagens anteriores vão para o modelo. Conversa longa não fica cara. */
const HISTORY_WINDOW = 14
/** Pedido explícito de atendimento humano (usado só quando o modelo falha). */
const ASKED_FOR_HUMAN = /\b(analista|atendente|pessoa|humano)\b/i

type Emit = (event: ChatStreamEvent) => void

/** Lê o valor (possivelmente incompleto) de um campo texto dentro de um JSON que ainda está chegando. */
export function partialJsonString(json: string, key: string): string {
  const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(json)
  if (!match) return ''
  const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '', '"': '"', '\\': '\\', '/': '/' }
  let out = ''
  for (let i = match.index + match[0].length; i < json.length; i++) {
    const c = json[i]!
    if (c === '"') break
    if (c !== '\\') {
      out += c
      continue
    }
    const next = json[i + 1]
    if (next === undefined) break
    if (next === 'u') {
      const hex = json.slice(i + 2, i + 6)
      if (hex.length < 4) break
      out += String.fromCharCode(parseInt(hex, 16))
      i += 5
    } else {
      out += ESCAPES[next] ?? next
      i += 1
    }
  }
  return out
}

/** A chamada de tool pode vir no formato do AI SDK ({ toolName }) ou do Mastra ({ payload: { toolName } }). */
function isResponderCall(call: unknown): boolean {
  const c = call as { toolName?: string; payload?: { toolName?: string } }
  return (c.toolName ?? c.payload?.toolName) === 'responder'
}

/** Converte o histórico salvo no formato de mensagens do modelo, resumindo os cards. */

type ModelMessage = { role: 'user'; content: string } | { role: 'assistant'; content: string }

function toModelMessages(history: ChatMessage[]): ModelMessage[] {
  const out: ModelMessage[] = []
  for (const m of history.slice(-HISTORY_WINDOW)) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
      continue
    }
    const notes = m.cards.map(describeCard).filter(Boolean)
    const prefix = m.role === 'analyst' ? `[Analista ${m.authorName}] ` : m.role === 'system' ? '[Sistema] ' : ''
    out.push({ role: 'assistant', content: `${prefix}${m.content}${notes.length ? `\n(${notes.join(' | ')})` : ''}` })
  }
  // A API exige que a conversa comece pelo usuário.
  while (out[0]?.role === 'assistant') out.shift()
  return out
}

function describeCard(card: Card): string {
  switch (card.kind) {
    case 'ticket_select':
      return `lista mostrada: ${card.tickets.map((t) => `${t.id} ${t.title}`).join('; ')}`
    case 'ticket_detail':
      return `detalhe mostrado: ${card.ticket.id} ${card.ticket.status}${card.ticket.overdue ? ' (vencido)' : ''}`
    case 'draft':
      return `rascunho ${card.draft.id} (${card.draft.status}): ${card.draft.kind === 'create' ? card.draft.title : `atualizar ${card.draft.ticketId}`}`
    case 'transfer':
      return `transferido para Suporte ${card.queue}`
    case 'articles':
      return ''
  }
}

function employeeContext(employee: Employee, pendingDraft: string | null): string {
  return [
    `Funcionário logado: ${employee.name} (${employee.email}), área ${employee.department}.`,
    `Equipamento: ${employee.device}.`,
    `Agora: ${formatDateTime(new Date().toISOString())} (horário de Brasília).`,
    pendingDraft ? `Rascunho aguardando confirmação: ${pendingDraft}.` : 'Nenhum rascunho pendente.',
  ].join('\n')
}

function toDecision(output: TurnOutput['decisao']): Decision {
  return {
    understood: output.entendimento,
    intent: output.intencao,
    action: output.acao,
    confidence: output.confianca,
    reasoning: output.justificativa,
    rulesApplied: output.regras_aplicadas,
  }
}

export interface RunTurnInput {
  conversationId: string
  employee: Employee
  text: string
  emit: Emit
}

export async function runTurn({ conversationId, employee, text, emit }: RunTurnInput): Promise<void> {
  const conversation = await getConversation(conversationId)
  if (!conversation || conversation.employee.id !== employee.id) {
    emit({ type: 'error', message: 'Conversa não encontrada.' })
    return
  }
  if (conversation.status === 'closed') {
    emit({ type: 'error', message: 'Essa conversa foi encerrada. Comece uma nova.' })
    return
  }
  if (conversation.userMessageCount >= MESSAGE_LIMIT) {
    emit({ type: 'error', message: `Limite de ${MESSAGE_LIMIT} mensagens desta sessão atingido. Comece uma nova conversa.` })
    return
  }

  const userMessage = await appendMessage(conversationId, { role: 'user', content: text })
  let conv = await updateConversation(conversationId, {
    userMessageCountDelta: 1,
    ...(conversation.status !== 'agent' ? { analystUnread: 'increment' as const } : {}),
  })
  emit({ type: 'user_message', message: userMessage })
  emit({ type: 'conversation', conversation: conv })

  // Agent pausado: a conversa está com um analista. A mensagem fica salva para ele ver,
  // e o modelo nem é chamado.
  if (conversation.status !== 'agent') {
    emit({
      type: 'paused',
      reason: conversation.status === 'with_analyst' ? `${conversation.assignedAnalyst?.name} está te atendendo.` : 'Um analista vai assumir em breve.',
    })
    return
  }

  const started = Date.now()
  const pending = await getPendingDraft(conversationId)
  const state: TurnState = {
    employee,
    conversationId,
    userSeq: userMessage.seq,
    client: TicketsClient.fromEnv(employee.id),
    cards: [],
    steps: [],
    guardrails: [],
    transferred: null,
    final: null,
    onStepStart: (tool) => emit({ type: 'step_start', tool, label: RUNNING_LABELS[tool] ?? tool }),
  }

  let output: TurnOutput | null = null
  let rateLimited = false
  let usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }
  try {
    const history = await listMessages(conversationId)
    const stream = await nexoAgent.stream(toModelMessages(history), {
      system: employeeContext(employee, pending ? `${pending.draft.id} (${pending.draft.kind === 'create' ? pending.draft.title : `atualizar ${pending.draft.ticketId}`})` : null),
      requestContext: createTurnContext(state),
      // Toda etapa precisa usar uma tool, e o turno termina na tool "responder" (ver tools.ts).
      // Funciona igual em qualquer provedor, sem depender de saída estruturada nativa.
      toolChoice: 'required',
      stopWhen: ({ steps }: { steps: { toolCalls?: unknown[] }[] }) => steps.some((s) => s.toolCalls?.some(isResponderCall)),
      maxSteps: 7,
      // O raciocínio interno do Gemini conta no limite de saída: com pouco limite a resposta
      // era cortada no meio. Raciocínio "low" deixa o turno mais rápido e barato, e as decisões
      // críticas não dependem dele (estão nas tools).
      modelSettings: { temperature: 0.2, maxOutputTokens: 2500 },
      providerOptions: { google: { thinkingConfig: { thinkingLevel: 'low' } } },
    })

    // Repasse em tempo real: cada tool que termina vira um passo na tela, e o campo "resposta"
    // dos argumentos da tool "responder" vira texto aparecendo aos poucos (quando o provedor
    // manda os argumentos em pedaços; senão o texto aparece inteiro de uma vez).
    let sentSteps = 0
    let sentText = ''
    let responderArgs = ''
    for await (const chunk of stream.fullStream) {
      while (sentSteps < state.steps.length) emit({ type: 'step_end', step: state.steps[sentSteps++]! })
      if (chunk.type === 'tool-call-delta' && chunk.payload.toolName === 'responder') {
        responderArgs += chunk.payload.argsTextDelta
        const reply = partialJsonString(responderArgs, 'resposta')
        if (reply.length > sentText.length && reply.startsWith(sentText)) {
          emit({ type: 'delta', text: reply.slice(sentText.length) })
          sentText = reply
        }
      }
    }
    while (sentSteps < state.steps.length) emit({ type: 'step_end', step: state.steps[sentSteps++]! })
    output = state.final
    const u = await stream.usage
    usage = {
      inputTokens: u?.inputTokens ?? 0,
      outputTokens: u?.outputTokens ?? 0,
      cachedInputTokens: u?.cachedInputTokens ?? 0,
    }
  } catch (error) {
    rateLimited = /429|quota|rate.?limit/i.test(String((error as { message?: string })?.message ?? error))
    console.error('[nexo] falha no turno do agent', rateLimited ? '(limite de uso do provedor)' : error)
  }

  const guardrails: Guardrail[] = [...state.guardrails]
  let content: string
  let quickReplies: string[] = []
  let decision: Decision | null = null

  if (!output && !state.transferred && ASKED_FOR_HUMAN.test(text)) {
    // Modelo fora do ar, mas o funcionário pediu uma pessoa: transfiro sem depender do modelo.
    state.transferred = await transferConversation(conversationId, {
      reason: 'pedido_do_funcionario',
      queue: 'N1',
      summary: `Funcionário pediu um analista enquanto o assistente estava indisponível. Última mensagem: "${text}"`,
      ticketId: null,
      confidence: null,
      client: state.client,
    })
    content = 'Certo, chamei um analista para você. Ele continua por aqui mesmo.'
    guardrails.push({ rule: 'Falha do modelo', detail: 'Modelo indisponível; pedido de analista atendido direto pelo sistema.' })
  } else if (!output) {
    // Falha do modelo: não deixo o funcionário sem resposta e não finjo que algo foi feito.
    content = rateLimited
      ? 'Estou recebendo muitas mensagens agora e atingi meu limite por alguns instantes. Pode tentar de novo daqui a pouco? Se preferir, chamo um analista.'
      : 'Tive um problema para processar sua mensagem agora. Pode tentar de novo? Se preferir, posso chamar um analista.'
    quickReplies = ['Tentar de novo', 'Falar com um analista']
    guardrails.push({ rule: 'Falha do modelo', detail: 'O modelo não respondeu no formato esperado; resposta padrão enviada.' })
  } else {
    decision = toDecision(output.decisao)
    content = output.resposta
    quickReplies = output.opcoes_rapidas

    // Regra do Anexo A: sem segurança → analista. Aplicada em código, com o número que o
    // próprio modelo declarou, para não depender de ele "lembrar" de transferir.
    if (decision.confidence < CONFIDENCE_THRESHOLD && !state.transferred) {
      state.transferred = await transferConversation(conversationId, {
        reason: 'baixa_confianca',
        queue: 'N1',
        summary: `O agent não teve segurança (${Math.round(decision.confidence * 100)}%). Entendimento: ${decision.understood}. Última mensagem: "${text}"`,
        ticketId: null,
        confidence: decision.confidence,
        client: state.client,
      })
      guardrails.push({
        rule: 'Transferência por baixa confiança',
        detail: `Confiança ${Math.round(decision.confidence * 100)}% abaixo de ${CONFIDENCE_THRESHOLD * 100}%: conversa enviada ao Suporte N1.`,
      })
      content = `${content}\n\nPara não arriscar uma resposta errada, chamei um analista para te ajudar.`
      quickReplies = []
    }
  }
  if (state.transferred) quickReplies = []

  const trace: AgentTrace = {
    steps: state.steps,
    decision,
    guardrails,
    model: NEXO_MODEL,
    latencyMs: Date.now() - started,
    usage,
    costUsd: estimateCost(NEXO_MODEL, usage),
  }
  const message = await appendMessage(conversationId, { role: 'assistant', content, cards: state.cards, quickReplies, trace })

  // Liga o rascunho à mensagem onde ele aparece, para o card mudar quando for confirmado.
  for (const card of state.cards) {
    if (card.kind === 'draft') {
      const stored = await getDraft(card.draft.id)
      if (stored) await saveDraft({ ...stored, messageId: message.id })
    }
  }

  conv = (await getConversation(conversationId)) as ConversationView
  emit({ type: 'message', message })
  emit({ type: 'conversation', conversation: conv })
}
