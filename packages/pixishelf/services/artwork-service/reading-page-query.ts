import 'server-only'
import type { ArtworksInfiniteQuerySchema } from '@/schemas/artwork.dto'
import { prisma } from '@/lib/prisma'
import { buildArtworkWhereClause } from './query-builder'
import { appendReadingFilterAndCursor, encodeReadingCursor } from './reading-keyset'

interface ReadingPageRow {
  id: number
  reading_sort_value: string | number | Date | null
}

export function requireReadingUserId(userId?: string): string {
  if (!userId) throw new Error('Authenticated user required for account filter')
  return userId
}

export function readingCountClause(params: ArtworksInfiniteQuerySchema, userId: string) {
  const query = appendReadingFilterAndCursor(params, userId, buildArtworkWhereClause(params, 1, 'grouped', userId))
  return { whereSQL: query.countWhereSQL, sqlParams: query.countParams }
}

export async function queryReadingArtworkRowsPage(params: ArtworksInfiniteQuerySchema, userId: string) {
  const query = appendReadingFilterAndCursor(params, userId, buildArtworkWhereClause(params, 1, 'grouped', userId))
  const rawRows = await prisma.$queryRawUnsafe<Array<ReadingPageRow & Record<string, unknown>>>(
    `SELECT a.*, ${query.sortValueSQL} AS reading_sort_value,
      artist.id as artist_id,
      artist.name as artist_name,
      artist.username as artist_username,
      artist.bio as artist_bio,
      artist.avatar as artist_avatar,
      artist."backgroundImg" as artist_background_img,
      artist."isStarred" as artist_is_starred,
      artist."createdAt" as artist_createdAt,
      artist."updatedAt" as artist_updatedAt
     FROM "Artwork" a
     LEFT JOIN "Artist" artist ON a."artistId" = artist.id
     ${query.whereSQL}
     ${query.orderBySQL}
     LIMIT $${query.paramIndex}`,
    ...query.sqlParams,
    params.pageSize + 1
  )
  const rows = rawRows.slice(0, params.pageSize)
  const last = rows.at(-1)
  return {
    rows,
    hasNextPage: rawRows.length > params.pageSize,
    nextReadingCursor: rawRows.length > params.pageSize && last ? encodeReadingCursor(params, userId, last) : undefined
  }
}

export async function queryReadingArtworkIdsPage(params: ArtworksInfiniteQuerySchema, userId: string) {
  const query = appendReadingFilterAndCursor(params, userId, buildArtworkWhereClause(params, 1, 'grouped', userId))
  const idQuery = `SELECT a.id, ${query.sortValueSQL} AS reading_sort_value
    FROM "Artwork" a
    ${query.whereSQL}
    ${query.orderBySQL}
    LIMIT $${query.paramIndex}`
  const rawRows = await prisma.$queryRawUnsafe<ReadingPageRow[]>(idQuery, ...query.sqlParams, params.pageSize + 1)
  const visible = rawRows.slice(0, params.pageSize)
  const last = visible.at(-1)
  return {
    ids: visible.map((row) => row.id),
    hasNextPage: rawRows.length > params.pageSize,
    nextReadingCursor: rawRows.length > params.pageSize && last ? encodeReadingCursor(params, userId, last) : undefined
  }
}
