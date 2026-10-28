import 'server-only'
import DOMPurify from 'isomorphic-dompurify'
import type { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { MobileError } from '@/lib/mobile/http'
import { MobileNeighborsQuery } from '@/schemas/mobile.dto'
import { getArtworkReaderInitial } from '@/services/artwork-service/reader'
import { getArtworkSourceLinks, getArtworkSourceUrl } from '@/services/artwork/source-links'
import { getNeighboringArtworks } from '@/services/artwork-service/related'
import { getReadingSummaries } from '@/services/reading-service'

/** The native detail renders text, never HTML or embedded remote resources. */
export function mobileDescription(description: string | null): string | null {
  if (!description) return null
  const breaks = description.replace(/<br\b[^>]*>|<\/(?:p|div|li|h[1-6])\s*>/gi, '\n')
  const fragment = DOMPurify.sanitize(breaks, { ALLOWED_TAGS: [], ALLOWED_ATTR: [], RETURN_DOM: true })
  return fragment.textContent?.replace(/\n[\t ]*\n[\t ]*\n/g, '\n\n').trim() || null
}

export async function mobileArtworkDetail(artworkId: number) {
  // Reuse the bounded H5 reader query and explicitly project its private management DTO.
  const initial = await getArtworkReaderInitial(artworkId)
  if (!initial) throw new MobileError(404, 'NOT_FOUND')
  const artwork = initial.artwork
  const links = await getArtworkSourceLinks(artworkId)
  const sources = (await Promise.all(links.map(async (source) => {
    const url = await getArtworkSourceUrl(artworkId, source.id)
    return url ? { id: source.id, label: source.label, url } : null
  }))).filter((source) => source !== null)
  if (artwork.pixivArtworkId) {
    sources.push({ id: 'pixiv', label: `Pixiv #${artwork.pixivArtworkId}`,
      url: `https://www.pixiv.net/artworks/${artwork.pixivArtworkId}` })
  }
  const neighborIds = artwork.series.flatMap((series) => [series.prev?.id, series.next?.id].filter((id): id is number => id !== undefined))
  const available = new Set(neighborIds.length ? (await prisma.artwork.findMany({
    where: { id: { in: neighborIds }, deletedAt: null, archiveLifecycleState: 'ACTIVE' }, select: { id: true }
  })).map((row) => row.id) : [])
  return {
    id: artwork.id, title: artwork.title, description: mobileDescription(artwork.description),
    createdAt: artwork.createdAt, sourceDate: artwork.sourceDate,
    mediaCount: initial.total, totalMediaSize: artwork.totalMediaSize,
    creators: artwork.creators.map((creator) => ({ id: creator.id, name: creator.name, kind: creator.kind,
      pixivUserId: creator.pixivUserId && /^[1-9]\d*$/.test(creator.pixivUserId) ? creator.pixivUserId : null })),
    tags: artwork.tags.map((tag) => ({ id: tag.id, name: tag.name, nameZh: tag.name_zh })),
    series: artwork.series.map((series) => ({ id: series.id, title: series.title, order: series.order,
      prev: series.prev && available.has(series.prev.id) ? series.prev : null,
      next: series.next && available.has(series.next.id) ? series.next : null })),
    sources
  }
}

export async function mobileArtworkNeighbors(userId: string, artworkId: number, input: z.infer<typeof MobileNeighborsQuery>) {
  const neighbors = await getNeighboringArtworks({ artworkId, artistId: input.artistId, limit: input.limit,
    direction: input.direction, dateMode: input.dateMode })
  const ids = neighbors.map((artwork) => artwork.id)
  const [versions, reading] = ids.length ? await Promise.all([
    prisma.artwork.findMany({ where: { id: { in: ids }, deletedAt: null, archiveLifecycleState: 'ACTIVE' },
      select: { id: true, mediaRevision: true, images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: 1, select: { id: true } } } }),
    getReadingSummaries(userId, ids)
  ]) : [[], { summaries: [] }]
  const byId = new Map(versions.map((row) => [row.id, row]))
  const summaries = new Map(reading.summaries.map((row) => [row.artworkId, row]))
  return { items: neighbors.flatMap((artwork) => {
    const version = byId.get(artwork.id)
    if (!version) return []
    const cover = version.images[0]
    return [{ id: artwork.id, title: artwork.title, author: artwork.creators.map((creator: { name: string }) => creator.name).join(' · '),
      imageCount: artwork.mediaCount || artwork.imageCount, mediaType: artwork.images[0]?.mediaType ?? 'image',
      mediaRevision: version.mediaRevision,
      coverUrl: cover ? `/api/mobile/v1/media/${cover.id}?expectedUserId=${encodeURIComponent(userId)}&variant=thumbnail` : null,
      readingStatus: summaries.get(artwork.id)?.status ?? 'UNREAD' }]
  }) }
}
