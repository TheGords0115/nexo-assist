import { z } from 'zod'
import { INTENTS } from '@/shared/types'

// Formato do fim de cada turno: a decisão vem ANTES da resposta, para o modelo decidir e depois
// escrever (e para a tela mostrar o porquê de cada resposta). É o input da tool "responder".
// Os campos opcionais têm valor padrão: um modelo menor que esqueça a lista de regras não derruba
// o turno inteiro.

export const turnOutputSchema = z.object({
  decisao: z.object({
    entendimento: z.string().describe('O que você entendeu do pedido, em uma frase'),
    intencao: z.enum(INTENTS),
    acao: z.string().describe('O que você fez neste turno'),
    confianca: z.number().min(0).max(1).describe('0 a 1. Menos de 0.5 quando estiver em dúvida'),
    justificativa: z.string().describe('Por que essa ação e não outra, citando a regra quando houver'),
    regras_aplicadas: z.array(z.string()).default([]),
  }),
  resposta: z.string().describe('Mensagem para o funcionário, curta, sem repetir os dados dos cards'),
  opcoes_rapidas: z.array(z.string()).max(4).default([]).describe('Respostas sugeridas, quando houver uma pergunta com opções previsíveis'),
})

export type TurnOutput = z.infer<typeof turnOutputSchema>
