import 'server-only'
import { performance } from 'node:perf_hooks'
import type { PrismaClient } from '@pixishelf/db'
import type { ArtworksInfiniteQuerySchema } from '@/schemas/artwork.dto'
import { buildRandomRangeQuery, queryRandomArtworkIdsPage, randomPageContext } from './random-page-query'
import { getArtworkCardsByIds } from './index'

// Whitelist structural/measurement fields: PostgreSQL plan predicates can expose input values.
export function sanitizeBrowsePlan(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeBrowsePlan)
  if (!value || typeof value !== 'object') return value
  const allowed = new Set([
    'QUERY PLAN',
    'Plan',
    'Plans',
    'Node Type',
    'Join Type',
    'Index Name',
    'Relation Name',
    'Actual Rows',
    'Actual Loops',
    'Actual Total Time',
    'Rows Removed by Filter',
    'Rows Removed by Join Filter',
    'Shared Hit Blocks',
    'Shared Read Blocks',
    'Temp Read Blocks',
    'Temp Written Blocks',
    'Sort Method',
    'Sort Space Used',
    'Sort Space Type',
    'Planning Time',
    'Execution Time'
  ])
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => allowed.has(key))
      .map(([key, item]) => [key, sanitizeBrowsePlan(item)])
  )
}

export async function diagnoseArtworkBrowse(db: PrismaClient, params: ArtworksInfiniteQuerySchema, userId: string) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '15s'")
      const started = performance.now()
      const selected = await queryRandomArtworkIdsPage(params, userId, tx)
      const selectionMs = performance.now() - started
      const hydrationStart = performance.now()
      const cards = await getArtworkCardsByIds(selected.ids, tx)
      const hydrationMs = performance.now() - hydrationStart
      const serviceMs = performance.now() - started
      const plans: unknown[] = []
      const state = randomPageContext(params, userId)
      for (const phase of [0, 1] as const) {
        if (phase < (state.cursor?.phase ?? 0)) continue
        const query = buildRandomRangeQuery(params, userId, phase, params.pageSize + 1)
        const plan = await tx.$queryRawUnsafe(
          `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON) ${query.sql}`,
          ...query.values
        )
        plans.push(sanitizeBrowsePlan(plan))
      }
      return { selectionMs, hydrationMs, serviceMs, returned: cards.length, hasNextPage: selected.hasNextPage, plans }
    },
    { maxWait: 5000, timeout: 60000 }
  )
}
