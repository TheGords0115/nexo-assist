import { describe, expect, it } from 'vitest'
import { partialJsonString } from '@/server/chat/turn'

// O texto da resposta aparece aos poucos lendo os argumentos da tool "responder" enquanto chegam.
describe('partialJsonString', () => {
  it('lê o campo mesmo com o JSON incompleto', () => {
    expect(partialJsonString('{"decisao":{"x":1},"resposta":"Olá, Ana. Vou ', 'resposta')).toBe('Olá, Ana. Vou ')
  })
  it('decodifica escapes e para no fim do campo', () => {
    const json = JSON.stringify({ resposta: 'Linha 1\nLinha "2" é', opcoes_rapidas: [] })
    expect(partialJsonString(json, 'resposta')).toBe('Linha 1\nLinha "2" é')
  })
  it('não devolve escape cortado pela metade', () => {
    const json = '{"resposta":"abc' + String.fromCharCode(92)
    expect(partialJsonString(json, 'resposta')).toBe('abc')
  })
  it('campo ainda não chegou', () => {
    expect(partialJsonString('{"decisao":{"entendimento":"', 'resposta')).toBe('')
  })
})
