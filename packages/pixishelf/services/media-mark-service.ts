import 'server-only'
import { assertArtworkDedupAppWrite } from './artwork-dedup-write-guard'
import { lockArtworkForReading, Prisma } from '@pixishelf/db'
import { TRPCError } from '@trpc/server'
import { prisma, type AppTransaction } from '@/lib/prisma'
import { isApngFile, isGifFile, isVideoFile } from '@/lib/media'
import { EMediaAnimationStatus } from '@/enums/e-media-animation-status'
import {
  MEDIA_MARK_PAGE_SIZE,
  MediaMarkListItemDto,
  type MediaMarkKind,
  type MediaMarkListResponseDto,
  type MediaMarkStateDto
} from '@/schemas/media-mark.dto'
import { groupLogicalMedia } from './artwork-service/logical-media'
import { transformImages } from './artwork-service/utils'

const contextSelect = {
  id: true,
  title: true,
  visualSummary: { select: { replaceInProgress: true } },
  contentSource: { select: { writeToken: true } },
  images: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      path: true,
      mediaType: true,
      webpAnimationStatus: true,
      summaryFeature: { select: { writeInProgress: true } },
      contentSource: { select: { writeToken: true } }
    }
  }
} satisfies Prisma.ArtworkSelect

type MediaContext = Prisma.ArtworkGetPayload<{ select: typeof contextSelect }>
type MarkDates = { id: string; bookmarkedAt: Date | null; likedAt: Date | null }
const activeArtwork = { deletedAt: null, archiveLifecycleState: 'ACTIVE' as const }
const markSelect = { id: true, bookmarkedAt: true, likedAt: true } as const
const fieldFor = (kind: MediaMarkKind) => (kind === 'bookmark' ? 'bookmarkedAt' : 'likedAt')

function combineMarks(marks: Array<MarkDates & { mediaId: number | null }>, canonicalId: number): MarkDates | null {
  const primary = marks.find((mark) => mark.mediaId === canonicalId) ?? marks[0]
  if (!primary) return null
  const latest = (field: 'bookmarkedAt' | 'likedAt') => {
    const dates = marks.flatMap((mark) => (mark[field] ? [mark[field]!.getTime()] : []))
    return dates.length ? new Date(Math.max(...dates)) : null
  }
  return { id: primary.id, bookmarkedAt: latest('bookmarkedAt'), likedAt: latest('likedAt') }
}

function toState(artworkId: number, mediaId: number, mark: MarkDates | null, available: boolean): MediaMarkStateDto {
  return {
    markId: mark?.id ?? null,
    artworkId,
    mediaId,
    available,
    bookmarkedAt: mark?.bookmarkedAt?.toISOString() ?? null,
    likedAt: mark?.likedAt?.toISOString() ?? null
  }
}

function logicalTargets(artwork: MediaContext) {
  return groupLogicalMedia(artwork.images).map((group, index) => ({
    ...group,
    position: index + 1,
    writing: Boolean(
      artwork.visualSummary?.replaceInProgress ||
        artwork.contentSource?.writeToken ||
        group.members.some((member) => member.summaryFeature?.writeInProgress || member.contentSource?.writeToken)
    )
  }))
}

async function loadContext(tx: AppTransaction, artworkId: number) {
  const artwork = await tx.artwork.findUnique({ where: { id: artworkId, ...activeArtwork }, select: contextSelect })
  if (!artwork) throw new TRPCError({ code: 'NOT_FOUND', message: '作品已不存在或不可用。' })
  return artwork
}

function snapshotMediaType(image: MediaContext['images'][number]): 'image' | 'animation' | 'video' {
  if (image.mediaType === 'VIDEO' || isVideoFile(image.path)) return 'video'
  if (
    image.mediaType === 'ANIMATION' ||
    image.webpAnimationStatus === EMediaAnimationStatus.animated ||
    isGifFile(image.path) ||
    isApngFile(image.path)
  ) {
    return 'animation'
  }
  return 'image'
}

export async function getLikedMediaIds(userId: string, artworkId: number) {
  return prisma.$transaction(async (tx) => {
    const artwork = await loadContext(tx, artworkId)
    const marks = await tx.mediaMark.findMany({
      where: { userId, artworkId, likedAt: { not: null }, mediaId: { not: null } },
      select: { mediaId: true }
    })
    const liked = new Set(marks.map((mark) => mark.mediaId))
    return {
      mediaIds: logicalTargets(artwork)
        .filter((target) => target.members.some((member) => liked.has(member.id)))
        .map((target) => target.item.id)
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}

export async function getMediaMarks(userId: string, artworkId: number, mediaIds: number[]) {
  return prisma.$transaction(
    async (tx) => {
      const artwork = await loadContext(tx, artworkId)
      const byMember = new Map(
        logicalTargets(artwork).flatMap((target) => target.members.map((member) => [member.id, target] as const))
      )
      const targets = [...new Map(mediaIds.map((id) => [byMember.get(id)?.item.id ?? id, byMember.get(id)])).entries()]
      const marks = await tx.mediaMark.findMany({
        where: {
          userId,
          artworkId,
          mediaId: { in: targets.flatMap(([, target]) => target?.members.map((member) => member.id) ?? []) }
        },
        select: { ...markSelect, mediaId: true },
        orderBy: { id: 'asc' }
      })
      return {
        items: targets.map(([id, target]) => {
          const members = new Set(target?.members.map((member) => member.id))
          return toState(
            artworkId,
            id,
            combineMarks(
              marks.filter((mark) => mark.mediaId !== null && members.has(mark.mediaId)),
              id
            ),
            Boolean(target && !target.writing)
          )
        })
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  )
}

/** The artwork lock serializes both mark fields with file-write guards and destructive media edits. */
export async function setMediaMark(
  userId: string,
  artworkId: number,
  mediaId: number,
  kind: MediaMarkKind,
  value: boolean
): Promise<MediaMarkStateDto> {
  return prisma.$transaction(async (tx) => {
    if (!(await lockArtworkForReading(tx, artworkId))) {
      throw new TRPCError({ code: 'NOT_FOUND', message: '作品已不存在。' })
    }
    const artwork = await loadContext(tx, artworkId)
    await assertArtworkDedupAppWrite(tx, artworkId, 'ORGANIZATION')
    const target = logicalTargets(artwork).find((group) => group.members.some((member) => member.id === mediaId))
    if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: '图片已不存在。' })
    if (target.writing) throw new TRPCError({ code: 'CONFLICT', message: '媒体正在写入，请稍后重试。' })
    const canonicalId = target.item.id
    const memberIds = target.members.map((member) => member.id)
    const existingMarks = await tx.mediaMark.findMany({
      where: { userId, artworkId, mediaId: { in: memberIds } },
      select: { ...markSelect, mediaId: true },
      orderBy: { id: 'asc' }
    })
    const existing = combineMarks(existingMarks, canonicalId)
    const field = fieldFor(kind)
    const sameValue = Boolean(existing?.[field]) === value
    if (
      sameValue &&
      (existingMarks.length === 0 || (existingMarks.length === 1 && existingMarks[0]!.mediaId === canonicalId))
    ) {
      return toState(artworkId, canonicalId, existing, true)
    }
    const bookmarkedAt =
      field === 'bookmarkedAt'
        ? value
          ? (existing?.bookmarkedAt ?? new Date())
          : null
        : (existing?.bookmarkedAt ?? null)
    const likedAt =
      field === 'likedAt' ? (value ? (existing?.likedAt ?? new Date()) : null) : (existing?.likedAt ?? null)
    if (existing && !bookmarkedAt && !likedAt) {
      await tx.mediaMark.deleteMany({ where: { userId, artworkId, mediaId: { in: memberIds } } })
      return toState(artworkId, canonicalId, null, true)
    }
    const snapshot = {
      artworkTitle: artwork.title,
      mediaPosition: target.position,
      mediaType: snapshotMediaType(target.item)
    }
    // A normal scan can introduce a video's APNG companion. Normalize existing member marks under the same lock.
    if (existingMarks.length > 1) {
      await tx.mediaMark.deleteMany({
        where: { id: { in: existingMarks.filter((mark) => mark.id !== existing!.id).map((mark) => mark.id) } }
      })
    }
    const data = { mediaId: canonicalId, bookmarkedAt, likedAt, ...snapshot }
    const mark = existing
      ? await tx.mediaMark.update({ where: { id: existing.id }, data, select: markSelect })
      : await tx.mediaMark.create({ data: { userId, artworkId, ...data }, select: markSelect })
    return toState(artworkId, canonicalId, mark, true)
  })
}

export async function listMediaMarks(
  userId: string,
  kind: MediaMarkKind,
  page: number
): Promise<MediaMarkListResponseDto> {
  return prisma.$transaction(
    async (tx) => {
      const field = fieldFor(kind)
      const where = { userId, [field]: { not: null }, artwork: activeArtwork }
      const total = await tx.mediaMark.count({ where })
      const marks = await tx.mediaMark.findMany({
        where,
        orderBy: [{ [field]: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * MEDIA_MARK_PAGE_SIZE,
        take: MEDIA_MARK_PAGE_SIZE
      })
      const artworks = await tx.artwork.findMany({
        where: { id: { in: [...new Set(marks.map((mark) => mark.artworkId))] }, ...activeArtwork },
        select: contextSelect
      })
      const contexts = new Map(artworks.map((artwork) => [artwork.id, { artwork, targets: logicalTargets(artwork) }]))
      const liveTargets = marks.flatMap((mark) => {
        const target = contexts
          .get(mark.artworkId)
          ?.targets.find((candidate) => candidate.members.some((member) => member.id === mark.mediaId))
        return target && !target.writing ? target.members.map((member) => member.id) : []
      })
      const mediaRows = await tx.image.findMany({
        where: { id: { in: liveTargets } },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: { videoMetadata: true, animationMetadata: true }
      })
      // Group within each artwork: identical filenames in unrelated works must never merge.
      const media = new Map(
        artworks.flatMap((artwork) =>
          transformImages(mediaRows.filter((row) => row.artworkId === artwork.id)).images.map(
            (image) => [image.id, image] as const
          )
        )
      )
      const items = marks.map((mark) => {
        const context = contexts.get(mark.artworkId)
        const target = context?.targets.find((candidate) =>
          candidate.members.some((member) => member.id === mark.mediaId)
        )
        const unavailableReason = !target ? 'deleted' : target.writing ? 'writing' : null
        return MediaMarkListItemDto.parse({
          id: mark.id,
          artworkId: mark.artworkId,
          mediaId: target?.item.id ?? null,
          artworkTitle: target ? context!.artwork.title : mark.artworkTitle,
          mediaPosition: target?.position ?? mark.mediaPosition,
          mediaType: target ? snapshotMediaType(target.item) : mark.mediaType,
          media: unavailableReason === null ? (media.get(target!.item.id) ?? null) : null,
          bookmarkedAt: mark.bookmarkedAt?.toISOString() ?? null,
          likedAt: mark.likedAt?.toISOString() ?? null,
          unavailableReason
        })
      })
      return { items, total, page, pageSize: MEDIA_MARK_PAGE_SIZE }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  )
}

/** Stable mark IDs allow removing a flag after the original Image foreign key has been cleared. */
export async function removeMediaMark(userId: string, markId: string, kind: MediaMarkKind) {
  return prisma.$transaction(async (tx) => {
    const initial = await tx.mediaMark.findUnique({ where: { id: markId, userId }, select: { artworkId: true } })
    if (!initial) return { success: true as const }
    await lockArtworkForReading(tx, initial.artworkId)
    const existing = await tx.mediaMark.findUnique({
      where: { id: markId, userId },
      select: { ...markSelect, mediaId: true }
    })
    if (!existing) return { success: true as const }
    const artwork = await loadContext(tx, initial.artworkId)
    await assertArtworkDedupAppWrite(tx, initial.artworkId, 'ORGANIZATION')
    const target = logicalTargets(artwork).find((group) =>
      group.members.some((member) => member.id === existing.mediaId)
    )
    if (artwork.visualSummary?.replaceInProgress || artwork.contentSource?.writeToken || target?.writing) {
      throw new TRPCError({ code: 'CONFLICT', message: '媒体正在写入，请稍后重试。' })
    }
    const field = fieldFor(kind)
    if (!existing[field]) return { success: true as const }
    const otherField = kind === 'bookmark' ? 'likedAt' : 'bookmarkedAt'
    if (!existing[otherField]) await tx.mediaMark.delete({ where: { id: markId } })
    else await tx.mediaMark.update({ where: { id: markId }, data: { [field]: null } })
    return { success: true as const }
  })
}
