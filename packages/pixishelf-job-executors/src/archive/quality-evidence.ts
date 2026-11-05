import path from 'node:path'
import { z } from 'zod'
import { Prisma } from '@pixishelf/db'
import {
  ARCHIVE_QUALITY_DEFINITION_VERSION,
  archiveDeliveryEvidenceSchema,
  archivePageQualityEvidenceSchema,
  type ArchivePageQualityEvidence,
  type ArchiveQualityEvidence,
  type ArchiveQualityStatus
} from '@pixishelf/job-contracts'
import { classifyEhDelivery } from './eh-quality.ts'
import type { ArchiveTransaction } from './types.ts'

const mediaSchema = archivePageQualityEvidenceSchema
  .pick({ imageId: true, index: true, path: true, size: true, sha256: true })
  .extend({
    imageId: archivePageQualityEvidenceSchema.shape.imageId.optional(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    mimeType: z.string().nullable()
  })
const frozenReuseSchema = z.object({
  media: z.array(z.object({ index: z.number(), sha256: z.string(), size: z.string() }))
})
type Revision = Prisma.ArchiveRevisionGetPayload<{ include: { archiveImport: { include: { items: true } } } }>
type ImageIdentity = { id: number; path: string; sortOrder: number | null; size: bigint | null }
type PriorEvidence = { revisionId: string; pages: ArchivePageQualityEvidence[] }
export type ArchiveCompletedDeliveryItem = Pick<
  NonNullable<Revision['archiveImport']>['items'][number],
  | 'status'
  | 'attempts'
  | 'lastDownloadUrl'
  | 'lastDownloadAt'
  | 'lastDownloadAttempt'
  | 'startedAt'
  | 'finishedAt'
  | 'sha256'
  | 'byteCount'
  | 'width'
  | 'height'
  | 'mimeType'
  | 'deliveryEvidence'
>

/** Shared receipt boundary for publication, resumed downloads and historical record audits. */
export function classifyArchiveCompletedDelivery(
  item: ArchiveCompletedDeliveryItem
): Pick<ArchivePageQualityEvidence, 'quality' | 'reason' | 'evidence'> {
  const unknown = (reason: string) => ({ quality: 'UNKNOWN' as const, reason })
  if (
    item.status !== 'COMPLETED' ||
    !item.lastDownloadUrl ||
    !item.lastDownloadAt ||
    !item.startedAt ||
    item.attempts < 1 ||
    item.lastDownloadAttempt !== item.attempts ||
    !item.finishedAt ||
    item.lastDownloadAt < item.startedAt ||
    item.lastDownloadAt > item.finishedAt
  )
    return unknown('NO_FINAL_SUCCESSFUL_ATTEMPT')
  if (!item.sha256 || item.byteCount === null || item.width === null || item.height === null || item.mimeType === null)
    return unknown('INCOMPLETE_MEDIA_FACTS')
  const delivered = archiveDeliveryEvidenceSchema.safeParse(item.deliveryEvidence)
  if (
    item.deliveryEvidence !== null &&
    (!delivered.success ||
      delivered.data.attempt !== item.attempts ||
      delivered.data.sha256 !== item.sha256 ||
      delivered.data.byteCount !== item.byteCount.toString() ||
      delivered.data.downloadUrl !== item.lastDownloadUrl)
  )
    return unknown('DELIVERY_RECEIPT_MISMATCH')
  const classificationInput = {
    url: item.lastDownloadUrl,
    actual: {
      byteCount: item.byteCount,
      width: item.width,
      height: item.height,
      mimeType: item.mimeType,
      ...(delivered.success && delivered.data.actualSha1 ? { sha1: delivered.data.actualSha1 } : {})
    },
    originalResponse: delivered.success ? (delivered.data.originalResponse ?? false) : false,
    ...(delivered.success && delivered.data.responseMimeType !== undefined
      ? { responseMimeType: delivered.data.responseMimeType }
      : {}),
    ...(delivered.success && delivered.data.originalClaim ? { originalClaim: delivered.data.originalClaim } : {}),
    ...(delivered.success && delivered.data.sourceOriginalClaim
      ? { sourceOriginalClaim: delivered.data.sourceOriginalClaim }
      : {})
  }
  const classified = classifyEhDelivery(classificationInput)
  if (
    delivered.success &&
    (delivered.data.quality !== classified.quality || delivered.data.reason !== classified.reason)
  ) {
    // The old xres writer could not have included a source comparison in its receipt.
    const matchesLegacyXres =
      !delivered.data.sourceOriginalClaim &&
      delivered.data.quality === 'UNKNOWN' &&
      delivered.data.reason === 'CONFLICTING_HATH_XRES' &&
      classifyEhDelivery(classificationInput, 'legacy-xres').reason === delivered.data.reason
    if (!matchesLegacyXres) return unknown('DELIVERY_CLASSIFICATION_MISMATCH')
  }
  return {
    ...classified,
    evidence: {
      attempt: item.attempts,
      downloadUrl: item.lastDownloadUrl,
      ...(delivered.success && delivered.data.actualSha1 ? { actualSha1: delivered.data.actualSha1 } : {}),
      ...(delivered.success && delivered.data.originalResponse !== undefined
        ? { originalResponse: delivered.data.originalResponse }
        : {}),
      ...(delivered.success && delivered.data.responseMimeType !== undefined
        ? { responseMimeType: delivered.data.responseMimeType }
        : {}),
      ...(delivered.success && delivered.data.originalClaim ? { originalClaim: delivered.data.originalClaim } : {}),
      ...(delivered.success && delivered.data.sourceOriginalClaim
        ? { sourceOriginalClaim: delivered.data.sourceOriginalClaim }
        : {})
    }
  }
}

/** Uses database receipts only. It must never open media files or contact the provider. */
export function buildArchiveQualityEvidence(
  revision: Revision,
  images: readonly ImageIdentity[] | undefined,
  previous: readonly PriorEvidence[] = []
): ArchiveQualityEvidence {
  const currentImages = revision.isCurrent ? images : undefined
  const parsed = z.array(mediaSchema).safeParse(revision.mediaSnapshot)
  if (!parsed.success || parsed.data.length === 0)
    return {
      version: 1,
      pages: [],
      reason: 'INVALID_MEDIA_SNAPSHOT',
      unresolvedPageCount:
        currentImages?.length ?? (Array.isArray(revision.mediaSnapshot) ? revision.mediaSnapshot.length : 0)
    }
  const media = parsed.data
  if (currentImages && currentImages.length !== media.length)
    return { version: 1, pages: [], reason: 'CURRENT_MEDIA_SET_MISMATCH', unresolvedPageCount: currentImages.length }
  const importRecord = revision.archiveImport
  const reuse = frozenReuseSchema.safeParse(importRecord?.completionSnapshot ?? importRecord?.upgradeSnapshot)
  const pages = media
    .map((entry): ArchivePageQualityEvidence | null => {
      const fullPath = path.posix.join(revision.archivePath, entry.path)
      const matchesCurrentImage = (image: ImageIdentity) =>
        image.path === fullPath && image.sortOrder === entry.index && image.size?.toString() === entry.size
      // Early publishers did not freeze an Image ID. Only current media can supply that identity.
      const matches = entry.imageId === undefined ? currentImages?.filter(matchesCurrentImage) : undefined
      const imageId = entry.imageId ?? (matches?.length === 1 ? matches[0]!.id : undefined)
      if (imageId === undefined) return null

      const item = importRecord?.items.find((item) => item.pageIndex === entry.index)
      const base = {
        imageId,
        index: entry.index,
        path: entry.path,
        size: entry.size,
        sha256: entry.sha256,
        sourcePageUrl: item?.sourcePageUrl ?? null
      }
      const unknown = (reason: string): ArchivePageQualityEvidence => ({ ...base, quality: 'UNKNOWN', reason })
      if (media.filter((other) => other.index === entry.index || other.imageId === imageId).length !== 1)
        return unknown('DUPLICATE_MEDIA_IDENTITY')
      if (entry.imageId !== undefined && currentImages) {
        const image = currentImages.find((image) => image.id === imageId)
        if (!image || !matchesCurrentImage(image)) return unknown('CURRENT_IMAGE_IDENTITY_MISMATCH')
      }
      if (
        !item ||
        item.status !== 'COMPLETED' ||
        item.stagedPath !== entry.path ||
        item.sha256 !== entry.sha256 ||
        item.byteCount?.toString() !== entry.size ||
        item.width !== entry.width ||
        item.height !== entry.height ||
        item.mimeType !== entry.mimeType
      )
        return unknown('SUCCESSFUL_ITEM_MISMATCH')

      const identityEvidence =
        entry.imageId === undefined ? { imageIdSource: 'CURRENT_IMAGE_PATH_ORDER_SIZE' as const } : undefined
      const reused =
        reuse.success &&
        reuse.data.media.some(
          (page) => page.index === entry.index && page.sha256 === entry.sha256 && page.size === entry.size
        )
      if (reused && item.attempts === 0) {
        for (const older of [...previous].reverse()) {
          const page = older.pages.find(
            (page) =>
              page.index === entry.index &&
              page.sourcePageUrl === item.sourcePageUrl &&
              page.sha256 === entry.sha256 &&
              page.size === entry.size &&
              page.quality !== 'UNKNOWN'
          )
          if (page)
            return {
              ...base,
              quality: page.quality,
              reason: 'FROZEN_PAGE_REUSE',
              evidence: { ...identityEvidence, inheritedFromRevisionId: older.revisionId }
            }
        }
      }
      const classified = classifyArchiveCompletedDelivery(item)
      const evidence = classified.evidence
        ? { ...identityEvidence, archiveImportId: importRecord!.id, ...classified.evidence }
        : identityEvidence
      return {
        ...base,
        ...classified,
        ...(evidence ? { evidence } : {})
      }
    })
    .filter((page) => page !== null)
  const unresolvedPageCount = media.length - pages.length
  return {
    version: 1,
    pages,
    ...(unresolvedPageCount > 0
      ? {
          reason: currentImages ? 'CURRENT_IMAGE_IDENTITY_MISMATCH' : 'LEGACY_MEDIA_IMAGE_ID_UNAVAILABLE',
          unresolvedPageCount
        }
      : {})
  }
}

export function summarizeArchiveQuality(evidence: ArchiveQualityEvidence) {
  const qualityOriginalCount = evidence.pages.filter((page) => page.quality === 'ORIGINAL').length
  const qualityDisplayCount = evidence.pages.filter((page) => page.quality === 'DISPLAY').length
  const qualityUnknownCount =
    evidence.pages.filter((page) => page.quality === 'UNKNOWN').length + (evidence.unresolvedPageCount ?? 0)
  const qualityStatus: ArchiveQualityStatus =
    evidence.reason || qualityUnknownCount > 0
      ? 'UNKNOWN'
      : qualityOriginalCount > 0 && qualityDisplayCount > 0
        ? 'MIXED'
        : qualityOriginalCount > 0
          ? 'ORIGINAL'
          : qualityDisplayCount > 0
            ? 'DISPLAY'
            : 'UNKNOWN'
  return { qualityStatus, qualityOriginalCount, qualityDisplayCount, qualityUnknownCount }
}

/** Rebuild older frozen receipts first so legacy completion reuse has a provable chain. */
export async function refreshArchiveQualityEvidence(tx: ArchiveTransaction, revisionId: string, now: Date) {
  const target = await tx.archiveRevision.findUniqueOrThrow({ where: { id: revisionId } })
  const [revisions, images] = await Promise.all([
    tx.archiveRevision.findMany({
      where: { externalRefId: target.externalRefId, publishedAt: { lte: target.publishedAt } },
      orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
      include: { archiveImport: { include: { items: true } } }
    }),
    tx.image.findMany({
      where: { artworkId: target.artworkId },
      select: { id: true, path: true, sortOrder: true, size: true }
    })
  ])
  const previous: PriorEvidence[] = []
  let summary = summarizeArchiveQuality({ version: 1, pages: [] })
  for (const revision of revisions) {
    const evidence = buildArchiveQualityEvidence(revision, revision.isCurrent ? images : undefined, previous)
    const currentSummary = summarizeArchiveQuality(evidence)
    await tx.archiveRevision.update({
      where: { id: revision.id },
      data: {
        ...currentSummary,
        qualityEvidence: evidence as Prisma.InputJsonValue,
        qualityDefinitionVersion: ARCHIVE_QUALITY_DEFINITION_VERSION,
        qualityVerifiedAt: now
      }
    })
    previous.push({ revisionId: revision.id, pages: evidence.pages })
    if (revision.id === revisionId) summary = currentSummary
  }
  return summary
}
