import 'server-only'
import { createHash } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import type { ArtworksInfiniteQuerySchema } from '@/schemas/artwork.dto'
import { buildArtworkWhereClause } from './query-builder'
import { appendReadingPredicate } from './reading-keyset'

// Must match the partial expression index in 20261016090000_artwork_browse_indexes.
export const RANDOM_KEY_SQL = `(md5(a.id::text || ':artwork-random-v1') COLLATE "C")`
const digest = (value: string) => createHash('md5').update(value).digest('hex')
const cursorSchema = z.object({
  version: z.literal(1),
  pivot: z.string().regex(/^[0-9a-f]{32}$/),
  phase: z.union([z.literal(0), z.literal(1)]),
  key: z.string().regex(/^[0-9a-f]{32}$/),
  id: z.number().int().positive().safe(),
  context: z.string().length(64)
})
type RandomCursor = z.infer<typeof cursorSchema>
type RandomRow = { id: number; random_key: string; phase: 0 | 1 }
export type PageQueryDatabase = Pick<typeof prisma, '$queryRawUnsafe'>

function cursorError(): never {
  throw new TRPCError({ code: 'BAD_REQUEST', message: 'ARTWORK_RANDOM_CURSOR_INVALID' })
}

export function randomPageContext(params: ArtworksInfiniteQuerySchema, userId: string) {
  if (!userId) throw new TRPCError({ code: 'UNAUTHORIZED' })
  if (params.sortBy !== 'random' || params.randomSeed === undefined) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Random pagination requires randomSeed' })
  }
  if (params.readingCursor || (params.cursor ?? 1) !== 1) cursorError()
  const entries = Object.entries(params)
    .filter(([key]) => !['cursor', 'readingCursor', 'randomCursor', 'pageSize', 'expectedUserId'].includes(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, Array.isArray(value) ? [...new Set<string | number>(value)].sort() : value])
  const context = createHash('sha256')
    .update(JSON.stringify([userId, entries]))
    .digest('hex')
  const pivot = digest(`artwork-random-v1:seed:${params.randomSeed}`)
  let cursor: RandomCursor | undefined
  if (params.randomCursor) {
    try {
      cursor = cursorSchema.parse(JSON.parse(Buffer.from(params.randomCursor, 'base64url').toString('utf8')))
      if (
        cursor.context !== context ||
        cursor.pivot !== pivot ||
        (cursor.phase === 0 ? cursor.key < pivot : cursor.key >= pivot)
      ) {
        cursorError()
      }
    } catch {
      cursorError()
    }
  }
  return { context, pivot, cursor }
}

/** Each half of the ring has a simple indexed range and its own LIMIT. */
export function buildRandomRangeQuery(
  params: ArtworksInfiniteQuerySchema,
  userId: string,
  phase: 0 | 1,
  limit: number,
  state = randomPageContext(params, userId)
) {
  let base = buildArtworkWhereClause(params, 1, 'exists', userId)
  if (params.readingStatuses.length) base = appendReadingPredicate(params.readingStatuses, userId, base)
  const values: unknown[] = [...base.sqlParams, state.pivot]
  let where = `${base.whereSQL} AND ${RANDOM_KEY_SQL} ${phase === 0 ? '>=' : '<'} $${values.length}::text COLLATE "C"`
  if (state.cursor?.phase === phase) {
    values.push(state.cursor.key, state.cursor.id)
    where += ` AND (${RANDOM_KEY_SQL}, a.id) > ($${values.length - 1}::text COLLATE "C", $${values.length}::int)`
  }
  values.push(limit)
  return {
    sql: `SELECT a.id, ${RANDOM_KEY_SQL} AS random_key FROM "Artwork" a ${where}
      ORDER BY ${RANDOM_KEY_SQL} ASC, a.id ASC LIMIT $${values.length}`,
    values
  }
}

export async function queryRandomArtworkIdsPage(
  params: ArtworksInfiniteQuerySchema,
  userId: string,
  db: PageQueryDatabase = prisma
) {
  const state = randomPageContext(params, userId)
  const rows: RandomRow[] = []
  for (let phase = state.cursor?.phase ?? 0; phase <= 1 && rows.length < params.pageSize + 1; phase++) {
    const query = buildRandomRangeQuery(params, userId, phase as 0 | 1, params.pageSize + 1 - rows.length, state)
    const batch = await db.$queryRawUnsafe<Array<{ id: number; random_key: string }>>(query.sql, ...query.values)
    rows.push(...batch.map((row) => ({ ...row, phase: phase as 0 | 1 })))
  }
  const visible = rows.slice(0, params.pageSize)
  const last = visible.at(-1)
  const hasNextPage = rows.length > params.pageSize
  return {
    ids: visible.map((row) => row.id),
    hasNextPage,
    nextRandomCursor:
      hasNextPage && last
        ? Buffer.from(
            JSON.stringify({
              version: 1,
              pivot: state.pivot,
              context: state.context,
              phase: last.phase,
              key: last.random_key,
              id: last.id
            } satisfies RandomCursor)
          ).toString('base64url')
        : undefined
  }
}
