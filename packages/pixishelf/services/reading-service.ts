import 'server-only'
import { TRPCError } from '@trpc/server'
import { Prisma, type ArtworkReadingSummary } from '@prisma/client'
import { lockArtworkForReading } from '@pixishelf/db'
import {
  READING_MEDIA_REVISION_CONFLICT_CODE,
  READING_REPORT_MAX_AGE_MS,
  READING_VISIT_GAP_MS,
  type ReadingBatchSummariesResult,
  type ReadingContextDto,
  type ReadingHistoryCursor,
  type ReadingMediaItem,
  type ReadingReportInput,
  type ReadingReportResult,
  type ReadingSummaryDto
} from '@pixishelf/db/reading-contract'
import type { ArtworkCardData } from '@/types'
import { prisma } from '@/lib/prisma'
import { groupLogicalMedia } from './artwork-service/logical-media'
import { getArtworkCardsByIds } from './artwork-service'

type ReadingTx = Prisma.TransactionClient

function status(summary: { viewCount: number; seenCount: number; totalCount: number }) {
  if (summary.viewCount === 0) return 'UNREAD' as const
  if (summary.totalCount > 0 && summary.seenCount >= summary.totalCount) return 'COMPLETED' as const
  return 'IN_PROGRESS' as const
}

function toDto(row: ArtworkReadingSummary): ReadingSummaryDto {
  const fields = {
    artworkId: row.artworkId,
    viewCount: row.viewCount,
    seenCount: row.seenCount,
    totalCount: row.totalCount,
    lastViewedAt: row.lastViewedAt.toISOString(),
    lastActiveAt: row.lastActiveAt.toISOString(),
    lastMediaId: row.lastMediaId,
    lastMediaIndex: row.lastMediaIndex
  }
  return { ...fields, status: status(fields) }
}

function emptySummary(artworkId: number, totalCount: number): ReadingSummaryDto {
  return {
    artworkId,
    viewCount: 0,
    seenCount: 0,
    totalCount,
    status: 'UNREAD',
    lastViewedAt: null,
    lastActiveAt: null,
    lastMediaId: null,
    lastMediaIndex: null
  }
}

async function loadMedia(tx: ReadingTx, artworkId: number): Promise<ReadingMediaItem[]> {
  const images = await tx.image.findMany({
    where: { artworkId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, path: true, mediaType: true }
  })
  return groupLogicalMedia(images).map((group, index) => ({
    mediaId: group.item.id,
    memberMediaIds: group.members.map((member) => member.id),
    index
  }))
}

function seenLogicalCount(media: ReadingMediaItem[], seenIds: Set<number>) {
  return media.filter((item) => item.memberMediaIds.some((id) => seenIds.has(id))).length
}

function locateMedia(media: ReadingMediaItem[], memberId: number | null) {
  return memberId === null ? undefined : media.find((item) => item.memberMediaIds.includes(memberId))
}

async function reconcileSummary(tx: ReadingTx, userId: string, artworkId: number, media: ReadingMediaItem[]) {
  const key = { userId_artworkId: { userId, artworkId } }
  const [row, seenRows] = await Promise.all([
    tx.artworkReadingSummary.findUnique({ where: key }),
    tx.artworkReadMedia.findMany({ where: { userId, artworkId }, select: { mediaId: true } })
  ])
  const seenIds = new Set(seenRows.map((item) => item.mediaId))
  if (!row) return { row: null, seenIds }
  const seenCount = seenLogicalCount(media, seenIds)
  const position = locateMedia(media, row.lastMediaId)
  const lastMediaId = position ? row.lastMediaId : null
  const lastMediaIndex = position?.index ?? null
  if (
    row.seenCount === seenCount &&
    row.totalCount === media.length &&
    row.lastMediaId === lastMediaId &&
    row.lastMediaIndex === lastMediaIndex
  ) return { row, seenIds }
  const updated = await tx.artworkReadingSummary.update({
    where: key,
    data: { seenCount, totalCount: media.length, lastMediaId, lastMediaIndex }
  })
  return { row: updated, seenIds }
}

function ensureArtworkActive(artwork: { deletedAt: Date | null; archiveLifecycleState: string } | null) {
  if (!artwork || artwork.deletedAt !== null || artwork.archiveLifecycleState !== 'ACTIVE') {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Artwork not found' })
  }
}

export async function getReadingContext(userId: string, artworkId: number): Promise<ReadingContextDto> {
  return prisma.$transaction(async (tx) => {
    const readingTx = tx as unknown as ReadingTx
    const locked = await lockArtworkForReading(readingTx, artworkId)
    if (!locked) throw new TRPCError({ code: 'NOT_FOUND', message: 'Artwork not found' })
    ensureArtworkActive(await tx.artwork.findUnique({
      where: { id: artworkId },
      select: { deletedAt: true, archiveLifecycleState: true }
    }))
    const media = await loadMedia(readingTx, artworkId)
    const { row, seenIds } = await reconcileSummary(readingTx, userId, artworkId, media)
    const position = locateMedia(media, row?.lastMediaId ?? null)
    const fallback = media.find((item) => !item.memberMediaIds.some((id) => seenIds.has(id))) ?? media[0]
    const resume = position ?? fallback
    return {
      artworkId,
      mediaRevision: locked.mediaRevision,
      media,
      summary: row ? toDto(row) : emptySummary(artworkId, media.length),
      resume: resume ? { mediaId: resume.mediaId, index: resume.index } : null
    }
  })
}

export async function reportReading(userId: string, input: ReadingReportInput): Promise<ReadingReportResult> {
  const now = Date.now()
  const ordered = input.events.map((event) => ({ event, at: new Date(event.observedAt) }))
  if (ordered.some(({ at }) => !Number.isFinite(at.getTime()) || at.getTime() < now - READING_REPORT_MAX_AGE_MS || at.getTime() > now + 5_000)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Reading batch expired or has an invalid observation time' })
  }
  ordered.sort((a, b) => a.at.getTime() - b.at.getTime())

  return prisma.$transaction(async (tx) => {
    const readingTx = tx as unknown as ReadingTx
    const locked = await lockArtworkForReading(readingTx, input.artworkId)
    if (!locked) throw new TRPCError({ code: 'NOT_FOUND', message: 'Artwork not found' })
    ensureArtworkActive(await tx.artwork.findUnique({
      where: { id: input.artworkId },
      select: { deletedAt: true, archiveLifecycleState: true }
    }))
    if (locked.mediaRevision !== input.mediaRevision) {
      throw new TRPCError({ code: 'CONFLICT', message: READING_MEDIA_REVISION_CONFLICT_CODE })
    }
    const media = await loadMedia(readingTx, input.artworkId)
    const byMemberId = new Map(media.flatMap((item) => item.memberMediaIds.map((id) => [id, item] as const)))
    const { row: previous, seenIds } = await reconcileSummary(readingTx, userId, input.artworkId, media)
    let viewCount = previous?.viewCount ?? 0
    let lastViewedAt = previous?.lastViewedAt ?? null
    let lastActiveAt = previous?.lastActiveAt ?? null
    let lastMediaId = previous?.lastMediaId ?? null
    let lastMediaIndex = previous?.lastMediaIndex ?? null
    let accepted = false
    const newlySeen = new Set<number>()
    for (const { event, at } of ordered) {
      const item = byMemberId.get(event.mediaId)
      if (!item) continue
      if (event.type === 'HEARTBEAT') {
        // A heartbeat only extends the same active visit. It never opens one.
        if (!lastActiveAt || at < lastActiveAt || at.getTime() - lastActiveAt.getTime() >= READING_VISIT_GAP_MS || !locateMedia(media, lastMediaId) || !item.memberMediaIds.includes(lastMediaId!)) continue
        lastActiveAt = at
        accepted = true
        continue
      }
      if (!lastActiveAt || at.getTime() - lastActiveAt.getTime() >= READING_VISIT_GAP_MS) viewCount++
      // A valid late observation still contributes seen media and is the last accepted position.
      // Observation timestamps and visit counts must not move backwards when devices report out of order.
      if (!lastActiveAt || at > lastActiveAt) lastActiveAt = at
      if (!lastViewedAt || at > lastViewedAt) lastViewedAt = at
      lastMediaId = event.mediaId
      lastMediaIndex = item.index
      accepted = true
      for (const memberId of item.memberMediaIds) {
        if (!seenIds.has(memberId)) newlySeen.add(memberId)
      }
    }
    if (newlySeen.size > 0) {
      await tx.artworkReadMedia.createMany({
        data: [...newlySeen].map((mediaId) => ({ userId, artworkId: input.artworkId, mediaId })),
        skipDuplicates: true
      })
      for (const id of newlySeen) seenIds.add(id)
    }
    if (!accepted || !lastViewedAt || !lastActiveAt) {
      return { mediaRevision: locked.mediaRevision, summary: previous ? toDto(previous) : emptySummary(input.artworkId, media.length) }
    }
    const data = {
      viewCount,
      seenCount: seenLogicalCount(media, seenIds),
      totalCount: media.length,
      lastViewedAt,
      lastActiveAt,
      lastMediaId,
      lastMediaIndex
    }
    const updated = await tx.artworkReadingSummary.upsert({
      where: { userId_artworkId: { userId, artworkId: input.artworkId } },
      create: { userId, artworkId: input.artworkId, ...data },
      update: data
    })
    return { mediaRevision: locked.mediaRevision, summary: toDto(updated) }
  })
}

export async function getReadingSummaries(userId: string, artworkIds: number[]): Promise<ReadingBatchSummariesResult> {
  const ids = [...new Set(artworkIds)]
  if (ids.length === 0) return { summaries: [] }
  const rows = await prisma.artworkReadingSummary.findMany({ where: { userId, artworkId: { in: ids } } })
  return { summaries: rows.map(toDto) }
}

export interface ReadingHistoryItem {
  artwork: ArtworkCardData
  reading: ReadingSummaryDto
}

export interface ReadingHistoryPage {
  items: ReadingHistoryItem[]
  nextCursor?: ReadingHistoryCursor
}

export async function getReadingHistory(userId: string, pageSize: number, cursor?: ReadingHistoryCursor): Promise<ReadingHistoryPage> {
  const rows = await prisma.artworkReadingSummary.findMany({
    where: {
      userId,
      artwork: { deletedAt: null, archiveLifecycleState: 'ACTIVE' },
      ...(cursor ? {
        OR: [
          { lastViewedAt: { lt: new Date(cursor.lastViewedAt) } },
          { lastViewedAt: new Date(cursor.lastViewedAt), artworkId: { lt: cursor.artworkId } }
        ]
      } : {})
    },
    orderBy: [{ lastViewedAt: 'desc' }, { artworkId: 'desc' }],
    take: pageSize + 1
  })
  const visible = rows.slice(0, pageSize)
  const cards = await getArtworkCardsByIds(visible.map((item) => item.artworkId))
  const byId = new Map(cards.map((card) => [card.id, card]))
  const items = visible.flatMap((row) => {
    const artwork = byId.get(row.artworkId)
    return artwork ? [{ artwork, reading: toDto(row) }] : []
  })
  const last = visible.at(-1)
  return {
    items,
    nextCursor: rows.length > pageSize && last ? { lastViewedAt: last.lastViewedAt.toISOString(), artworkId: last.artworkId } : undefined
  }
}
