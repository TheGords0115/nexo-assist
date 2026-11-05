import { Agent } from '@mastra/core/agent'
import { z } from 'zod'
import { INTENTS } from '@/shared/types'
import { NEXO_INSTRUCTIONS } from './prompt'
import { nexoTools } from './tools'

// Definição do agent (Mastra). O modelo vem do .env (NEXO_MODEL) para dar para trocar sem mexer
// no código. Uso o Claude Haiku: é rápido e barato, e as decisões difíceis (prioridade, duplicidade,
// confirmação) não dependem só dele, porque estão em código.

export const NEXO_MODEL = process.env.NEXO_MODEL ?? 'anthropic/claude-haiku-5-5'

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

/** Preço por milhão de tokens (US$), para estimar o custo por conversa no detalhe da decisão. */
const PRICES: Record<string, { input: number; output: number; cachedInput: number }> = {
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
