import { Agent } from '@mastra/core/agent'
import { z } from 'zod'
import { INTENTS } from '@/shared/types'
import { NEXO_INSTRUCTIONS } from './prompt'
import { nexoTools } from './tools'

// Definição do agent (Mastra). O modelo vem do .env (NEXO_MODEL) para dar para trocar sem mexer
// no código. O padrão é o Gemini Flash: tem plano gratuito, é rápido, e as decisões que não podem
// errar (prioridade, duplicidade, confirmação) não dependem só dele, porque estão em código.
// Também funciona com Claude (anthropic/claude-haiku-5-5), é só trocar no .env.

export const NEXO_MODEL = process.env.NEXO_MODEL ?? 'google/gemini-3.5-flash'

/**
 * O Gemini não aceita saída estruturada nativa junto com tools na mesma chamada, então nele o
 * formato vai como instrução no prompt de sistema. No Claude uso o modo nativo.
 */
export const SCHEMA_IN_PROMPT: boolean = NEXO_MODEL.startsWith('google/')

/** Variável de ambiente com a chave de cada provedor (para avisar quando estiver faltando). */
export function providerKeyEnv(model = NEXO_MODEL): string {
  if (model.startsWith('google/')) return 'GOOGLE_GENERATIVE_AI_API_KEY'
  if (model.startsWith('openai/')) return 'OPENAI_API_KEY'
  return 'ANTHROPIC_API_KEY'
}

/**
 * Saída estruturada de cada turno: a decisão vem ANTES da resposta, para o modelo decidir e
 * depois escrever (e para a tela poder mostrar o porquê de cada resposta).
 */
export const turnOutputSchema = z.object({
  decisao: z.object({
    entendimento: z.string(),
    intencao: z.enum(INTENTS),
    acao: z.string(),
    confianca: z.number().min(0).max(1),
    justificativa: z.string(),
    regras_aplicadas: z.array(z.string()),
  }),
  resposta: z.string().describe('Mensagem para o funcionário, curta, sem repetir os dados dos cards'),
  opcoes_rapidas: z.array(z.string()).max(4).describe('Respostas sugeridas, quando houver uma pergunta com opções previsíveis'),
})

export type TurnOutput = z.infer<typeof turnOutputSchema>

export const nexoAgent = new Agent({
  id: 'nexo-assist',
  name: 'Nexo Assist',
  description: 'Agent de atendimento do service desk de TI da Nexo',
  instructions: [
    {
      role: 'system',
      content: NEXO_INSTRUCTIONS,
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    },
  ],
  model: NEXO_MODEL,
  tools: nexoTools,
})

/**
 * Preço por milhão de tokens (US$), para estimar o custo por conversa no detalhe da decisão.
 * Valores de referência; no plano gratuito do Gemini o custo real é zero.
 */
const PRICES: Record<string, { input: number; output: number; cachedInput: number }> = {
  'google/gemini-3.5-flash': { input: 0.3, output: 2.5, cachedInput: 0.075 },
  'anthropic/claude-haiku-5-5': { input: 1, output: 5, cachedInput: 0.1 },
  'anthropic/claude-haiku-4-5': { input: 1, output: 5, cachedInput: 0.1 },
  'anthropic/claude-sonnet-5-5': { input: 3, output: 15, cachedInput: 0.3 },
}

export function estimateCost(model: string, usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number }): number | null {
  const price = PRICES[model]
  if (!price) return null
  const fresh = Math.max(0, usage.inputTokens - usage.cachedInputTokens)
  return (fresh * price.input + usage.cachedInputTokens * price.cachedInput + usage.outputTokens * price.output) / 1_000_000
}
