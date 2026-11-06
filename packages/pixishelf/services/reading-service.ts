import 'server-only'
import { VIDEO_FILE_EXTENSIONS } from '@pixishelf/job-contracts'
import { TRPCError } from '@trpc/server'
import type { ArtworkReadingProgress } from '@prisma/client'
import { Prisma, lockArtworkForReading, readArtworkReadingLayout, type LockedArtworkReading } from '@pixishelf/db'
import {
  READING_LAYOUT_VERSION_CONFLICT_CODE,
  READING_REPORT_MAX_AGE_MS,
  READING_VISIT_GAP_MS,
  getReadingStatus,
  isVideoReadingComplete,
  type ReadingBatchSummariesResult,
  type ReadingContextDto,
  type ReadingHistoryCursor,
  type ReadingMarkReadInput,
  type ReadingReportInput,
  type ReadingReportResult,
  type ReadingSummaryDto
} from '@pixishelf/db/reading-contract'
import type { ArtworkCardData } from '@/types'
import { prisma, type AppTransaction } from '@/lib/prisma'
import { isVideoFile, isGifFile, isApngFile } from '@/lib/media'
import { assertArtworkDedupAppWrite } from './artwork-dedup-write-guard'
import { getArtworkCardsByIds } from './artwork-service'
import { loadReaderIndex } from './artwork-service/reader'
import type { ReaderInitialization } from '@/schemas/artwork-reader.dto'

function toDto(
  artwork: Pick<LockedArtworkReading, 'id' | 'logicalMediaCount' | 'readingLayoutVersion'>,
  row?: ArtworkReadingProgress | null
): ReadingSummaryDto {
  const fields = {
    artworkId: artwork.id,
    readingLayoutVersion: artwork.readingLayoutVersion,
    stateVersion: row?.stateVersion ?? 0,
    viewCount: row?.viewCount ?? 0,
    progressCount: row?.completed ? artwork.logicalMediaCount : (row?.furthestMediaIndex ?? -1) + 1,
    totalCount: artwork.logicalMediaCount,
    completed: row?.completed ?? false,
    furthestMediaId: row?.furthestMediaId ?? null,
    furthestMediaIndex: row?.furthestMediaIndex ?? null,
    lastViewedAt: row?.lastViewedAt?.toISOString() ?? null,
    lastActiveAt: row?.lastActiveAt?.toISOString() ?? null,
    lastMediaId: row?.lastMediaId ?? null,
    lastMediaIndex: row?.lastMediaIndex ?? null
  }
  return { ...fields, status: getReadingStatus(fields) }
}
async function activeArtwork(tx: AppTransaction, artworkId: number) {
  const locked = await lockArtworkForReading(tx, artworkId)
  if (!locked) throw new TRPCError({ code: 'NOT_FOUND', message: 'Artwork not found' })
  await assertArtworkDedupAppWrite(tx, artworkId, 'READING')
  const artwork = await tx.artwork.findUnique({
    where: { id: artworkId },
    select: { deletedAt: true, archiveLifecycleState: true }
  })
  if (!artwork || artwork.deletedAt !== null || artwork.archiveLifecycleState !== 'ACTIVE') {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Artwork not found' })
  }
  return locked
}
function assertReportOwner(userId: string, expectedUserId: string) {
  if (userId !== expectedUserId) throw new TRPCError({ code: 'FORBIDDEN', message: 'Reading session changed' })
}
function assertLayout(artwork: LockedArtworkReading, expected: number) {
  if (artwork.readingLayoutVersion !== expected) {
    throw new TRPCError({ code: 'CONFLICT', message: READING_LAYOUT_VERSION_CONFLICT_CODE })
  }
}
export async function getReadingContext(userId: string, artworkId: number): Promise<ReadingContextDto> {
  return prisma.$transaction(async (tx) => {
    const artwork = await activeArtwork(tx, artworkId)
    const [layout, row] = await Promise.all([
      readArtworkReadingLayout(tx, artworkId),
      tx.artworkReadingProgress.findUnique({ where: { userId_artworkId: { userId, artworkId } } })
    ])
    const media = layout.map((item, index) => ({ ...item, index }))
    const resume = media.find((item) => item.mediaId === row?.lastMediaId) ?? media[0]
    return {
      artworkId,
      readingLayoutVersion: artwork.readingLayoutVersion,
      media,
      summary: toDto(artwork, row),
      resume: resume ? { mediaId: resume.mediaId, index: resume.index } : null
    }
  })
}
export async function getReaderInitialization(userId: string, artworkId: number): Promise<ReaderInitialization> {
  return prisma.$transaction(async (tx) => {
    const artwork = await activeArtwork(tx, artworkId)
    const [{ title, index }, row] = await Promise.all([
      loadReaderIndex(tx, artworkId),
      tx.artworkReadingProgress.findUnique({ where: { userId_artworkId: { userId, artworkId } } })
    ])
    const resume = index.items.find((item) => item.mediaId === row?.lastMediaId) ?? index.items[0]
    return {
      title,
      index,
      reading: {
        artworkId,
        readingLayoutVersion: artwork.readingLayoutVersion,
        summary: toDto(artwork, row),
        resume: resume ? { mediaId: resume.mediaId, index: resume.index } : null
      }
    }
  })
}
export async function reportReading(userId: string, input: ReadingReportInput): Promise<ReadingReportResult> {
  assertReportOwner(userId, input.expectedUserId)
  const now = Date.now()
  const ordered = input.events
    .map((event) => ({ event, at: new Date(event.observedAt) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
  if (
    ordered.some(
      ({ at }) =>
        !Number.isFinite(at.getTime()) || at.getTime() < now - READING_REPORT_MAX_AGE_MS || at.getTime() > now + 5_000
    )
  ) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Reading batch expired or has an invalid observation time' })
  }
  return prisma.$transaction(async (tx) => {
    const artwork = await activeArtwork(tx, input.artworkId)
    assertLayout(artwork, input.readingLayoutVersion)
    const ids = [
      ...new Set(
        input.events.flatMap((event) => [
          event.mediaId,
          ...(event.type === 'VIEW' && event.advanceTo ? [event.advanceTo.mediaId] : [])
        ])
      )
    ]
    // Only submitted anchors are returned, independent of the artwork's media count.
    const [images, previous] = await Promise.all([
      tx.image.findMany({
        where: { artworkId: input.artworkId, id: { in: ids } },
        select: { id: true, path: true, mediaType: true, webpAnimationStatus: true }
      }),
      tx.artworkReadingProgress.findUnique({ where: { userId_artworkId: { userId, artworkId: input.artworkId } } })
    ])
    const byId = new Map(images.map((item) => [item.id, item]))
    const apngIds = images.filter((image) => /\.apng$/i.test(image.path)).map((image) => image.id)
    if (apngIds.length) {
      // APNGs paired with a video are not logical representatives. Never let the poster bypass playback gating.
      const paired = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        WITH anchors AS (
          SELECT i.id, i."artworkId", n.name FROM "Image" i
          CROSS JOIN LATERAL (SELECT regexp_replace(regexp_replace(replace(i.path, chr(92), '/'), '/+$', ''), '^.*/', '') AS name) n
          WHERE i.id IN (${Prisma.join(apngIds)})
        )
        SELECT i.id FROM anchors i WHERE (
          SELECT v.id FROM "Image" v
          CROSS JOIN LATERAL (SELECT regexp_replace(regexp_replace(replace(v.path, chr(92), '/'), '/+$', ''), '^.*/', '') AS name) n
          WHERE v."artworkId" = i."artworkId"
          AND (v."mediaType" = 'VIDEO' OR lower(substring(split_part(v.path, '?', 1) from '\\.[^.]*$')) IN (${Prisma.join(VIDEO_FILE_EXTENSIONS)}))
          AND CASE WHEN n.name <> '..' AND length(n.name) - strpos(reverse(n.name), '.') > 0 AND strpos(reverse(n.name), '.') > 0
            THEN left(n.name, length(n.name) - strpos(reverse(n.name), '.')) ELSE n.name END =
            CASE WHEN i.name <> '..' AND length(i.name) - strpos(reverse(i.name), '.') > 0 AND strpos(reverse(i.name), '.') > 0
            THEN left(i.name, length(i.name) - strpos(reverse(i.name), '.')) ELSE i.name END
          ORDER BY v."sortOrder", v.id LIMIT 1
        ) <> i.id
      `)
      if (paired.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Report the logical video representative' })
      }
    }
    const video = (id: number) => {
      const item = byId.get(id)!
      return item.mediaType === 'VIDEO' || isVideoFile(item.path)
    }
    const staticImage = (id: number) => {
      const item = byId.get(id)!
      return (
        !video(id) &&
        item.mediaType !== 'ANIMATION' &&
        item.webpAnimationStatus !== 2 &&
        !isGifFile(item.path) &&
        !isApngFile(item.path)
      )
    }
    for (const event of input.events) {
      if (
        !byId.has(event.mediaId) ||
        event.index < 0 ||
        event.index >= artwork.logicalMediaCount ||
        !Number.isInteger(event.index)
      ) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid reading media or position' })
      }
      if (
        event.type === 'VIEW' &&
        event.advanceTo &&
        (!byId.has(event.advanceTo.mediaId) ||
          event.advanceTo.index < event.index ||
          event.advanceTo.index >= artwork.logicalMediaCount ||
          !Number.isInteger(event.advanceTo.index) ||
          !staticImage(event.mediaId) ||
          !staticImage(event.advanceTo.mediaId))
      ) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid static stack tail' })
      }
    }
    let viewCount = previous?.viewCount ?? 0
    let lastViewedAt = previous?.lastViewedAt ?? null
    let lastActiveAt = previous?.lastActiveAt ?? null
    let lastMediaId = previous?.lastMediaId ?? null
    let lastMediaIndex = previous?.lastMediaIndex ?? null
    let furthestMediaId = previous?.furthestMediaId ?? null
    let furthestMediaIndex = previous?.furthestMediaIndex ?? null
    let completed = previous?.completed ?? false
    let changed = false
    for (const { event, at } of ordered) {
      if (video(event.mediaId) && !event.playback) continue
      if (event.type === 'HEARTBEAT') {
        if (
          !lastActiveAt ||
          at <= lastActiveAt ||
          at.getTime() - lastActiveAt.getTime() >= READING_VISIT_GAP_MS ||
          (!video(event.mediaId) && !completed && event.index > (furthestMediaIndex ?? -1))
        ) {
          continue
        }
        lastActiveAt = at
        changed = true
        continue
      }
      if (!lastActiveAt || at.getTime() - lastActiveAt.getTime() >= READING_VISIT_GAP_MS) viewCount++
      if (!lastActiveAt || at > lastActiveAt) {
        lastActiveAt = at
        changed = true
      }
      if (
        !lastViewedAt ||
        at > lastViewedAt ||
        (at.getTime() === lastViewedAt.getTime() && (lastMediaId !== event.mediaId || lastMediaIndex !== event.index))
      ) {
        lastViewedAt = at
        lastMediaId = event.mediaId
        lastMediaIndex = event.index
        changed = true
      }
      if (!video(event.mediaId) || (event.playback && isVideoReadingComplete(event.playback))) {
        const target = event.advanceTo ?? { mediaId: event.mediaId, index: event.index }
        if (target.index > (furthestMediaIndex ?? -1)) {
          furthestMediaId = target.mediaId
          furthestMediaIndex = target.index
          changed = true
        }
        if (!completed && artwork.logicalMediaCount > 0 && target.index === artwork.logicalMediaCount - 1) {
          completed = true
          changed = true
        }
      }
    }
    if (!changed) return { readingLayoutVersion: artwork.readingLayoutVersion, summary: toDto(artwork, previous) }
    const data = {
      viewCount,
      lastViewedAt,
      lastActiveAt,
      lastMediaId,
      lastMediaIndex,
      furthestMediaId,
      furthestMediaIndex,
      completed
    }
    const row = await tx.artworkReadingProgress.upsert({
      where: { userId_artworkId: { userId, artworkId: input.artworkId } },
      create: { userId, artworkId: input.artworkId, ...data, stateVersion: 1 },
      update: { ...data, stateVersion: { increment: 1 } }
    })
    return { readingLayoutVersion: artwork.readingLayoutVersion, summary: toDto(artwork, row) }
  })
}
export async function markReadingRead(userId: string, input: ReadingMarkReadInput): Promise<ReadingReportResult> {
  assertReportOwner(userId, input.expectedUserId)
  return prisma.$transaction(async (tx) => {
    const artwork = await activeArtwork(tx, input.artworkId)
    assertLayout(artwork, input.readingLayoutVersion)
    const key = { userId_artworkId: { userId, artworkId: input.artworkId } }
    let row = await tx.artworkReadingProgress.findUnique({ where: key })
    if (artwork.logicalMediaCount > 0 && !row?.completed) {
      row = await tx.artworkReadingProgress.upsert({
        where: key,
        create: { userId, artworkId: input.artworkId, completed: true, stateVersion: 1 },
        update: { completed: true, stateVersion: { increment: 1 } }
      })
    }
    return { readingLayoutVersion: artwork.readingLayoutVersion, summary: toDto(artwork, row) }
  })
}
export async function getReadingSummaries(userId: string, artworkIds: number[]): Promise<ReadingBatchSummariesResult> {
  const ids = [...new Set(artworkIds)]
  if (!ids.length) return { summaries: [] }
  const artworks = await prisma.artwork.findMany({
    where: { id: { in: ids }, deletedAt: null, archiveLifecycleState: 'ACTIVE' },
    select: { id: true, logicalMediaCount: true, readingLayoutVersion: true, readingProgress: { where: { userId } } }
  })
  return { summaries: artworks.map((artwork) => toDto(artwork, artwork.readingProgress[0])) }
}
export interface ReadingHistoryItem {
  artwork: ArtworkCardData
  reading: ReadingSummaryDto
}
export interface ReadingHistoryPage {
  items: ReadingHistoryItem[]
  nextCursor?: ReadingHistoryCursor
}
export async function getContinueReading(userId: string): Promise<{ items: ReadingHistoryItem[] }> {
  const rows = await prisma.artworkReadingProgress.findMany({
    where: {
      userId,
      completed: false,
      viewCount: { gt: 0 },
      lastViewedAt: { not: null },
      artwork: { logicalMediaCount: { gt: 0 }, deletedAt: null, archiveLifecycleState: 'ACTIVE' }
    },
    include: { artwork: { select: { id: true, logicalMediaCount: true, readingLayoutVersion: true } } },
    orderBy: [{ lastViewedAt: 'desc' }, { artworkId: 'desc' }],
    take: 6
  })
  const cards = new Map((await getArtworkCardsByIds(rows.map((row) => row.artworkId))).map((card) => [card.id, card]))
  return {
    items: rows.flatMap((row) => {
      const artwork = cards.get(row.artworkId)
      return artwork ? [{ artwork, reading: toDto(row.artwork, row) }] : []
    })
  }
}
export async function getReadingHistory(
  userId: string,
  pageSize: number,
  cursor?: ReadingHistoryCursor
): Promise<ReadingHistoryPage> {
  const rows = await prisma.artworkReadingProgress.findMany({
    where: {
      userId,
      viewCount: { gt: 0 },
      lastViewedAt: { not: null },
      artwork: { deletedAt: null, archiveLifecycleState: 'ACTIVE' },
      ...(cursor
        ? {
            OR: [
              { lastViewedAt: { lt: new Date(cursor.lastViewedAt) } },
              { lastViewedAt: new Date(cursor.lastViewedAt), artworkId: { lt: cursor.artworkId } }
            ]
          }
        : {})
    },
    include: { artwork: { select: { id: true, logicalMediaCount: true, readingLayoutVersion: true } } },
    orderBy: [{ lastViewedAt: 'desc' }, { artworkId: 'desc' }],
    take: pageSize + 1
  })
  const visible = rows.slice(0, pageSize)
  const cards = new Map(
    (await getArtworkCardsByIds(visible.map((row) => row.artworkId))).map((card) => [card.id, card])
  )
  const items = visible.flatMap((row) => {
    const artwork = cards.get(row.artworkId)
    return artwork ? [{ artwork, reading: toDto(row.artwork, row) }] : []
  })
  const last = visible.at(-1)
  return {
    items,
    nextCursor:
      rows.length > pageSize && last?.lastViewedAt
        ? { lastViewedAt: last.lastViewedAt.toISOString(), artworkId: last.artworkId }
        : undefined
  }
}
