import 'server-only'
import { prisma } from '@/lib/prisma'
import { MobileError } from '@/lib/mobile/http'
import { getArtworkCardsPage } from '@/services/artwork-service'
import { getReaderInitialization, getReadingSummaries } from '@/services/reading-service'
import { getReaderMediaPage } from '@/services/artwork-service/reader'
import { getArtworkRating } from '@/services/artwork-rating-service'
import { ArtworksInfiniteQuerySchema } from '@/schemas/artwork.dto'
import { MobileFeedQuery } from '@/schemas/mobile.dto'
import type { z } from 'zod'
import { ARTWORK_STACK_RULE_VERSION, buildArtworkStacks } from '@/lib/reading/artwork-stacks'
import { getUserSettings } from '@/services/user-setting-service'
import { getPreferredTagName } from '@/components/artwork/preferred-tag'
import { toApiImageSize } from '@/utils/image-size'
export async function mobileFeed(userId: string, input: z.infer<typeof MobileFeedQuery>) {
  const sortBy = input.sortBy ?? (input.mode === 'random' ? 'random' : 'created_at_desc')
  if (input.cursor && sortBy !== 'random' && !input.readingStatus && !input.likedOnly) {
    throw new MobileError(400, 'INVALID_CURSOR')
  }
  const page = await getArtworkCardsPage(
    ArtworksInfiniteQuerySchema.parse({
      pageSize: 20,
      cursor: input.page,
      search: input.search,
      artistId: input.artistId,
      tagIds: input.tagIds,
      sortBy,
      mediaType: input.mediaType,
      readingStatus: input.readingStatus,
      likedOnly: input.likedOnly,
      randomSeed: input.seed,
      randomCursor: sortBy === 'random' ? input.cursor : undefined,
      readingCursor: sortBy !== 'random' ? input.cursor : undefined,
      expectedUserId: userId
    }),
    userId
  )
  const ids = page.items.map((item) => item.id)
  const [versions, reading, settings] = await Promise.all([
    ids.length ?
    prisma.artwork.findMany({
      where: { id: { in: ids }, deletedAt: null, archiveLifecycleState: 'ACTIVE' },
      select: { id: true, mediaRevision: true, images: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: 1,
        select: { id: true }
      } }
    }) : [],
    ids.length ? getReadingSummaries(userId, ids) : { summaries: [] },
    getUserSettings(userId)
  ])
  const byId = new Map(versions.map((row) => [row.id, row]))
  const summaries = new Map(reading.summaries.map((row) => [row.artworkId, row]))
  return {
    items: page.items.flatMap((item) => {
      const version = byId.get(item.id)
      if (!version) return []
      const cover = version.images[0]
      return [{
        id: item.id, title: item.title, author: item.artist?.name ?? '',
        imageCount: item.imageCount, mediaType: item.images[0]?.mediaType ?? 'image',
        totalMediaSize: toApiImageSize(item.totalMediaSize) ?? 0,
        preferredTag: getPreferredTagName(settings.preferred_tags ?? [], item.tags) || null,
        mediaRevision: version.mediaRevision,
        coverUrl: cover ? `/api/mobile/v1/media/${cover.id}?expectedUserId=${encodeURIComponent(userId)}&variant=thumbnail` : null,
        readingStatus: summaries.get(item.id)?.status ?? 'UNREAD'
      }]
    }),
    nextPage: page.hasNextPage ? input.page + 1 : null,
    nextCursor: page.nextRandomCursor ?? page.nextReadingCursor ?? null
  }
}

export async function mobileReader(userId: string, artworkId: number) {
  const [reader, rating, artwork] = await Promise.all([
    getReaderInitialization(userId, artworkId),
    getArtworkRating(userId, artworkId),
    prisma.artwork.findUnique({
      where: { id: artworkId, deletedAt: null, archiveLifecycleState: 'ACTIVE' },
      select: { artist: { select: { name: true } } }
    })
  ])
  if (!artwork) throw new MobileError(404, 'NOT_FOUND')
  return { ...reader, author: artwork.artist?.name ?? '', rating,
    stack: { ruleVersion: ARTWORK_STACK_RULE_VERSION, fingerprint: reader.index.fingerprint,
      groups: buildArtworkStacks(reader.index.items) } }
}
export async function mobileMediaPage(artworkId: number, fingerprint: string, page: number, userId: string) {
  const result = await getReaderMediaPage(artworkId, fingerprint, page)
  return {
    fingerprint: result.fingerprint,
    page: result.page,
    images: result.images.map((image) => ({
      id: image.id,
      width: image.width,
      height: image.height,
      isApng: /\.apng(?:\?|$)/i.test(image.path),
      thumbnailUrl: `/api/mobile/v1/media/${image.id}?expectedUserId=${encodeURIComponent(userId)}&variant=thumbnail`,
      previewUrl: `/api/mobile/v1/media/${image.id}?expectedUserId=${encodeURIComponent(userId)}&variant=preview`,
      originalUrl: `/api/mobile/v1/media/${image.id}?expectedUserId=${encodeURIComponent(userId)}&variant=original`
    }))
  }
}
