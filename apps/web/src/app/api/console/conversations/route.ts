import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/server/http'
import { countByStatus, listConversations, type ConsoleFilter } from '@/server/store/conversations'

// Lista do console do analista (Telas 4 e 5), com filtros e busca.

const FILTERS: ConsoleFilter[] = ['todas', 'para_voce', 'com_agent', 'minhas']

export const GET = handle(async (req: Request) => {
  const analyst = await requireUser('analyst')
  const url = new URL(req.url)
  const filterParam = url.searchParams.get('filter') as ConsoleFilter | null
  const filter = filterParam && FILTERS.includes(filterParam) ? filterParam : 'todas'
  const [conversations, counts, mine] = await Promise.all([
    listConversations(filter, analyst.id, url.searchParams.get('q') ?? ''),
    countByStatus(),
    listConversations('minhas', analyst.id),
  ])
  return NextResponse.json({
    conversations,
    counts: {
      todas: counts.agent + counts.waiting_analyst + counts.with_analyst + counts.closed,
      para_voce: counts.waiting_analyst,
      com_agent: counts.agent,
      minhas: mine.length,
    },
  })
})
