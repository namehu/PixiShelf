import 'server-only'
import { createHash } from 'crypto'
import { TRPCError } from '@trpc/server'
import type { ArtworksInfiniteQuerySchema } from '@/schemas/artwork.dto'

type SortValue = string | number | null
interface CursorPayload {
  id: number
  value: SortValue
  sortBy: string
  randomSeed: number | null
  filterHash: string
}

const artistSort = `(SELECT ca.name FROM effective_artwork_creators c JOIN "Artist" ca ON ca.id=c."artistId" WHERE c."artworkId"=a.id ORDER BY (ca.kind='GROUP'), ca.name, ca.id LIMIT 1)`

function sortSpec(sortBy: string, randomSeed: number | undefined, seedPlaceholder: string) {
  switch (sortBy) {
    case 'title_asc': return { value: 'a.title', direction: 'ASC', type: 'text', nullable: false }
    case 'title_desc': return { value: 'a.title', direction: 'DESC', type: 'text', nullable: false }
    case 'artist_asc': return { value: artistSort, direction: 'ASC', type: 'text', nullable: true }
    case 'artist_desc': return { value: artistSort, direction: 'DESC', type: 'text', nullable: true }
    case 'images_asc': return { value: 'a."imageCount"', direction: 'ASC', type: 'integer', nullable: false }
    case 'images_desc': return { value: 'a."imageCount"', direction: 'DESC', type: 'integer', nullable: false }
    case 'source_date_asc': return { value: 'COALESCE(a."sourceDate", a."createdAt")', direction: 'ASC', type: 'timestamp', nullable: false }
    case 'created_at_asc': return { value: 'a."createdAt"', direction: 'ASC', type: 'timestamp', nullable: false }
    case 'created_at_desc': return { value: 'a."createdAt"', direction: 'DESC', type: 'timestamp', nullable: false }
    case 'random':
      if (randomSeed === undefined) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Reading random pagination requires randomSeed' })
      return { value: `md5(a.id::text || ${seedPlaceholder})`, direction: 'ASC', type: 'text', nullable: false }
    case 'source_date_desc':
    default: return { value: 'COALESCE(a."sourceDate", a."createdAt")', direction: 'DESC', type: 'timestamp', nullable: false }
  }
}

function hashFilters(params: ArtworksInfiniteQuerySchema, userId: string) {
  const filters = Object.fromEntries(Object.entries(params).filter(([key]) => !['cursor', 'readingCursor', 'pageSize'].includes(key)))
  return createHash('sha256').update(JSON.stringify({ userId, filters })).digest('hex')
}

function decodeCursor(encoded: string, params: ArtworksInfiniteQuerySchema, userId: string): CursorPayload {
  try {
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as CursorPayload
    if (
      !Number.isSafeInteger(data.id) || data.id < 1 ||
      !(data.value === null || typeof data.value === 'string' || (typeof data.value === 'number' && Number.isFinite(data.value))) ||
      data.sortBy !== (params.sortBy ?? 'source_date_desc') ||
      data.randomSeed !== (params.randomSeed ?? null) ||
      data.filterHash !== hashFilters(params, userId)
    ) throw new Error('Cursor context changed')
    return data
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid reading cursor' })
  }
}

export function encodeReadingCursor(params: ArtworksInfiniteQuerySchema, userId: string, row: { id: number; reading_sort_value: string | number | Date | null }) {
  const value = row.reading_sort_value instanceof Date ? row.reading_sort_value.toISOString() : row.reading_sort_value
  const payload: CursorPayload = {
    id: row.id,
    value,
    sortBy: params.sortBy ?? 'source_date_desc',
    randomSeed: params.randomSeed ?? null,
    filterHash: hashFilters(params, userId)
  }
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

export function appendReadingFilterAndCursor(
  params: ArtworksInfiniteQuerySchema,
  userId: string,
  base: { whereSQL: string; sqlParams: unknown[]; paramIndex: number }
) {
  let { whereSQL, sqlParams, paramIndex } = base
  const status = params.readingStatus
  if (!status) throw new Error('Reading status required')
  const summary = `SELECT 1 FROM artwork_reading_summaries rs WHERE rs."artworkId" = a.id AND rs."userId" = $${paramIndex} AND rs."viewCount" > 0`
  if (status === 'UNREAD') whereSQL += ` AND NOT EXISTS (${summary})`
  else if (status === 'IN_PROGRESS') whereSQL += ` AND EXISTS (${summary} AND (rs."totalCount" = 0 OR rs."seenCount" < rs."totalCount"))`
  else whereSQL += ` AND EXISTS (${summary} AND rs."totalCount" > 0 AND rs."seenCount" >= rs."totalCount")`
  sqlParams = [...sqlParams, userId]
  paramIndex++

  const seedPlaceholder = `$${paramIndex}`
  const spec = sortSpec(params.sortBy ?? 'source_date_desc', params.randomSeed, seedPlaceholder)
  if (params.sortBy === 'random') {
    sqlParams.push(String(params.randomSeed))
    paramIndex++
  }
  const countWhereSQL = whereSQL
  const countParams = [...sqlParams.slice(0, params.sortBy === 'random' ? -1 : undefined)]
  if (params.readingCursor) {
    const cursor = decodeCursor(params.readingCursor, params, userId)
    const idParam = `$${paramIndex + 1}`
    const comparator = spec.direction === 'ASC' ? '>' : '<'
    if (spec.nullable && cursor.value === null) {
      whereSQL += ` AND ${spec.value} IS NULL AND a.id ${comparator} $${paramIndex}`
      sqlParams.push(cursor.id)
      paramIndex++
    } else {
      const valueParam = `$${paramIndex}`
      const typedValue = `${valueParam}::${spec.type}`
      const ordinary = `(${spec.value} ${comparator} ${typedValue} OR (${spec.value} = ${typedValue} AND a.id ${comparator} ${idParam}))`
      whereSQL += ` AND ${spec.nullable ? `(${spec.value} IS NULL OR ${ordinary})` : ordinary}`
      sqlParams.push(cursor.value, cursor.id)
      paramIndex += 2
    }
  }
  return {
    whereSQL,
    sqlParams,
    paramIndex,
    countWhereSQL,
    countParams,
    sortValueSQL: spec.value,
    orderBySQL: `ORDER BY reading_sort_value ${spec.direction}${spec.nullable ? ' NULLS LAST' : ''}, a.id ${spec.direction}`
  }
}
