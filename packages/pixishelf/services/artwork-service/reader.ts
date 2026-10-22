import 'server-only'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { TRPCError } from '@trpc/server'
import { prisma, type AppTransaction } from '@/lib/prisma'
import { toApiImageSize } from '@/utils/image-size'
import { isVideoFile, isGifFile, isApngFile } from '@/lib/media'
import { hasReliableSingleFrameDimensions } from '@/lib/media-animation'
import { EMediaAnimationStatus } from '@/enums/e-media-animation-status'
import { MEDIA_INDEX_CONFLICT, MEDIA_PAGE_SIZE, type MediaIndex, type MediaPage, type ReaderInitialPage } from '@/schemas/artwork-reader.dto'
import { groupLogicalMedia } from './logical-media'
import { getArtworkDetailRecord, publishedKeyframeSummaryInclude } from './index'
import { transformImages } from './utils'

export async function loadReaderIndex(tx: AppTransaction, artworkId: number) {
  const artwork = await tx.artwork.findUnique({
    where: { id: artworkId, deletedAt: null, archiveLifecycleState: 'ACTIVE' },
    select: { title: true, mediaRevision: true }
  })
  if (!artwork) throw new TRPCError({ code: 'NOT_FOUND', message: 'Artwork not found' })
  const rows = await tx.image.findMany({
    where: { artworkId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, path: true, mediaType: true, width: true, height: true, size: true, webpAnimationStatus: true }
  })
  const groups = groupLogicalMedia(rows)
  const items = groups.map(({ item, members }, index) => {
    const isAnimated = item.mediaType === 'ANIMATION' || item.webpAnimationStatus === EMediaAnimationStatus.animated || isGifFile(item.path) || isApngFile(item.path)
    return {
      mediaId: item.id, memberMediaIds: members.map((member) => member.id), index,
      width: item.width, height: item.height,
      mediaType: item.mediaType === 'VIDEO' || isVideoFile(item.path) ? 'video' as const : 'image' as const,
      isAnimated, reliableDimensions: hasReliableSingleFrameDimensions({ ...item, isAnimated })
    }
  })
  const fingerprint = createHash('sha256').update(JSON.stringify([artwork.mediaRevision, items])).digest('hex')
  const index: MediaIndex = { fingerprint, mediaRevision: artwork.mediaRevision, items }
  return { title: artwork.title, index, totalMediaSize: groups.reduce((sum, group) => sum + (toApiImageSize(group.item.size) ?? 0), 0) }
}

export async function loadReaderPage(tx: AppTransaction, artworkId: number, index: MediaIndex, page: number): Promise<MediaPage> {
  const ids = index.items.slice(page * MEDIA_PAGE_SIZE, (page + 1) * MEDIA_PAGE_SIZE).flatMap((item) => item.memberMediaIds)
  const rows = await tx.image.findMany({
    where: { artworkId, id: { in: ids } }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: { videoMetadata: true, animationMetadata: true, keyframeSets: publishedKeyframeSummaryInclude }
  })
  return { fingerprint: index.fingerprint, page, images: transformImages(rows).images }
}

export async function getReaderMediaPage(artworkId: number, fingerprint: string, page: number) {
  return prisma.$transaction(async (tx) => {
    const { index } = await loadReaderIndex(tx, artworkId)
    if (index.fingerprint !== fingerprint) throw new TRPCError({ code: 'CONFLICT', message: MEDIA_INDEX_CONFLICT })
    return loadReaderPage(tx, artworkId, index, page)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}

export async function getArtworkReaderInitial(artworkId: number): Promise<ReaderInitialPage | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      const { index, totalMediaSize } = await loadReaderIndex(tx, artworkId)
      const ids = index.items.slice(0, MEDIA_PAGE_SIZE).flatMap((item) => item.memberMediaIds)
      const artwork = await getArtworkDetailRecord(artworkId, tx, ids)
      if (!artwork) return null
      const hasVideo = index.items.some((item) => item.mediaType === 'video')
      return {
        artwork: { ...artwork, totalMediaSize, imageCount: hasVideo ? 0 : index.items.length, mediaCount: index.items.length },
        total: index.items.length, fingerprint: index.fingerprint
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  } catch (error) {
    if (error instanceof TRPCError && error.code === 'NOT_FOUND') return null
    throw error
  }
}
