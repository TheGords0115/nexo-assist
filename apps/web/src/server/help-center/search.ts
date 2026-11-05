import { ARTICLES, type Article } from './articles'

// Busca simples por palavras-chave. Com 9 artigos não compensa usar embeddings: isso custaria uma
// chamada a mais por pergunta e mais uma dependência. Se a central crescer, troco por busca vetorial
// sem mexer no agent (a tool só conhece a função searchArticles).

export interface ArticleHit {
  article: Article
  score: number
}

const STOPWORDS = new Set([
  'a', 'o', 'e', 'de', 'do', 'da', 'dos', 'das', 'um', 'uma', 'no', 'na', 'nos', 'nas', 'em', 'meu', 'minha',
  'para', 'pra', 'com', 'que', 'nao', 'sim', 'esta', 'estou', 'ta', 'to', 'por', 'como', 'qual', 'quando', 'se',
  'ao', 'aos', 'eu', 'me', 'mais', 'muito', 'desde', 'ontem', 'hoje', 'aparece', 'ja', 'isso', 'ele', 'ela',
])

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

/** Pontua cada artigo: palavra-chave vale mais que palavra do título, que vale mais que do texto. */
export function searchArticles(query: string, limit = 3): ArticleHit[] {
  const q = tokens(query)
  if (q.length === 0) return []
  const hits = ARTICLES.map((article) => {
    const keywords = article.keywords.map(normalize)
    const title = tokens(article.title)
    const body = tokens(article.body)
    let score = 0
    for (const term of q) {
      if (keywords.some((k) => k === term || k.includes(term) || (term.length > 4 && term.includes(k)))) score += 3
      if (title.includes(term)) score += 2
      if (body.includes(term)) score += 1
    }
    return { article, score }
  })
  return hits
    .filter((h) => h.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
