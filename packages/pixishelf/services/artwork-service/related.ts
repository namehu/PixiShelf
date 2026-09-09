import 'server-only'
import { creatorInclude, activeCreatorMembership, visibleCreatorArtwork } from '@pixishelf/db'
import { prisma } from '@/lib/prisma'
import type { NeighboringArtworksGetSchema } from '@/schemas/artwork.dto'
import { transformSingleArtwork } from './utils'
import { VIDEO_POSTER_METADATA_SELECT } from '@/lib/media-cover'
import { ARTIST_SELECT } from '@/schemas/models/artists'

export async function getNeighboringArtworks(input: NeighboringArtworksGetSchema) {
  const { artistId, artworkId, limit, direction, dateMode = 'source' } = input
  const cursor = await prisma.artwork.findFirst({
    where: { id: artworkId, ...visibleCreatorArtwork, creators: { some: { artistId, ...activeCreatorMembership } } },
    select: { id: true, sourceDate: true, createdAt: true }
  })
  if (!cursor) return []
  const date = dateMode === 'created' ? cursor.createdAt : (cursor.sourceDate ?? cursor.createdAt)
  const expression = dateMode === 'created' ? 'a."createdAt"' : 'COALESCE(a."sourceDate", a."createdAt")'
  async function neighbors(newer: boolean) {
    const comparison = newer ? '>' : '<'
    const order = newer ? 'ASC' : 'DESC'
    return prisma.$queryRawUnsafe<Array<{ id: number }>>(
      'SELECT a.id FROM "Artwork" a WHERE a."deletedAt" IS NULL AND a."archiveLifecycleState" = \'ACTIVE\' ' +
        'AND EXISTS (SELECT 1 FROM effective_artwork_creators c WHERE c."artworkId"=a.id AND c."artistId"=$1) ' +
        'AND (' +
        expression +
        ', a.id) ' +
        comparison +
        ' ($2::timestamp, $3::integer) ' +
        'ORDER BY ' +
        expression +
        ' ' +
        order +
        ', a.id ' +
        order +
        ' LIMIT $4',
      artistId,
      date,
      artworkId,
      limit
    )
  }
  const [newer, older] = await Promise.all([
    direction === 'older' ? [] : neighbors(true),
    direction === 'newer' ? [] : neighbors(false)
  ])
  const ids = [
    ...newer.reverse().map((a) => a.id),
    ...(direction === 'both' ? [artworkId] : []),
    ...older.map((a) => a.id)
  ]
  const artworks = await prisma.artwork.findMany({
    where: { id: { in: ids }, ...visibleCreatorArtwork },
    include: {
      images: {
        take: 2,
        orderBy: { sortOrder: 'asc' },
        include: { videoMetadata: { select: VIDEO_POSTER_METADATA_SELECT } }
      },
      artist: { select: ARTIST_SELECT },
      creators: creatorInclude,
      artworkTags: { include: { tag: true } }
    }
  })
  const byId = new Map(artworks.map((a) => [a.id, a]))
  return ids.flatMap((id) => {
    const artwork = byId.get(id)
    return artwork ? [transformSingleArtwork(artwork)] : []
  })
}
