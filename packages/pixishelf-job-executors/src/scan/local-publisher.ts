import { createHash } from 'node:crypto'
import type { Prisma } from '@pixishelf/db'
import { ScanExecutorError } from './errors.js'
import type { DiscoveredLocalMediaFile } from './discovery.js'
import { selectMediaDerivedTagIds, type MediaDerivedTagIds } from '../maintenance/media-derived-tag-sync.js'
import type { ScanTransaction } from './types.js'

export interface LocalPublishBase {
  transaction: ScanTransaction
  runId: string
  work: LocalWorkRow
  title: string
  now: Date
}

export async function publishLocalMediaWork(
  input: LocalPublishBase & {
    artistId: number
    media: readonly DiscoveredLocalMediaFile[]
    mediaDerivedTagIds: MediaDerivedTagIds
    defaultTagIds: readonly number[]
  }
) {
  const checkpoint = await completedCheckpoint(input)
  if (checkpoint) return checkpoint
  const existing = await input.transaction.artwork.findUnique({
    where: { storagePath: input.work.relativePath },
    select: { id: true }
  })
  if (existing) {
    await writeLocalItem(input, {
      externalId: null,
      status: 'SKIPPED',
      action: 'SKIP_EXISTING',
      mediaCount: 0,
      newImageCount: 0
    })
    return { status: 'SKIPPED' as const, newImages: 0, artworkId: existing.id }
  }
  const artist = await input.transaction.artist.findUnique({ where: { id: input.artistId }, select: { id: true } })
  if (!artist) throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen local artist mapping no longer exists')
  const tags = await input.transaction.tag.findMany({
    where: { id: { in: [...input.defaultTagIds] } },
    select: { id: true }
  })
  if (tags.length !== input.defaultTagIds.length) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'A frozen default tag no longer exists')
  }
  const artwork = await input.transaction.artwork.create({
    data: {
      title: input.title,
      artistId: input.artistId,
      source: 'LOCAL_IMPORT',
      createdVia: 'LOCAL_DIRECTORY',
      storagePath: input.work.relativePath,
      sourceDate: earliestModifiedAt(input.media)
    },
    select: { id: true }
  })
  const storageKey = localStorageKey(artwork.id, input.work.relativePath)
  await input.transaction.artwork.update({ where: { id: artwork.id }, data: { storageKey } })
  await input.transaction.image.createMany({
    data: input.media.map((item) => ({
      artworkId: artwork.id,
      path: item.relativePath,
      width: item.width,
      height: item.height,
      size: item.size,
      sortOrder: item.sortOrder,
      mediaType: item.mediaType,
      webpAnimationStatus: item.webpAnimationStatus,
      chaptersPath: item.chaptersPath,
      chaptersCount: item.chaptersCount,
      chaptersDuration: item.chaptersDuration,
      chaptersUpdatedAt: item.chaptersPath ? input.now : null,
      chaptersHash: item.chaptersHash
    }))
  })
  const derivedTagIds = selectMediaDerivedTagIds(
    input.mediaDerivedTagIds,
    input.media.map((item) => item.relativePath)
  )
  await input.transaction.artworkTag.createMany({
    data: derivedTagIds.map((tagId) => ({ artworkId: artwork.id, tagId, provenance: 'DERIVED' as const })),
    skipDuplicates: true
  })
  if (tags.length > 0) {
    await input.transaction.artworkTag.createMany({
      data: tags.map((tag) => ({ artworkId: artwork.id, tagId: tag.id, provenance: 'MANUAL' as const })),
      skipDuplicates: true
    })
  }
  await writeLocalItem(input, {
    externalId: storageKey,
    status: 'SUCCESS',
    action: 'CREATE',
    mediaCount: input.media.length,
    newImageCount: input.media.length
  })
  return { status: 'SUCCESS' as const, newImages: input.media.length, artworkId: artwork.id }
}

function earliestModifiedAt(media: readonly DiscoveredLocalMediaFile[]): Date {
  if (media.length === 0) throw new ScanExecutorError('MEDIA_NOT_FOUND', 'Local work has no supported media')
  return media.reduce(
    (earliest, item) => (item.modifiedAt < earliest ? item.modifiedAt : earliest),
    media[0]!.modifiedAt
  )
}

async function completedCheckpoint(input: LocalPublishBase) {
  const item = await input.transaction.scanRunItem.findUnique({
    where: { scanRunId_checkpointKey: { scanRunId: input.runId, checkpointKey: localCheckpointKey(input.work) } }
  })
  if (item?.status !== 'SUCCESS' && item?.status !== 'SKIPPED') return null
  return { status: item.status, newImages: item.newImageCount, artworkId: null as number | null }
}

async function writeLocalItem(
  input: LocalPublishBase,
  result: {
    externalId: string | null
    status: 'SUCCESS' | 'SKIPPED'
    action: 'CREATE' | 'SKIP_EXISTING'
    mediaCount: number
    newImageCount: number
  }
) {
  await input.transaction.scanRunItem.upsert({
    where: { scanRunId_checkpointKey: { scanRunId: input.runId, checkpointKey: localCheckpointKey(input.work) } },
    create: {
      scanRunId: input.runId,
      checkpointKey: localCheckpointKey(input.work),
      externalId: result.externalId,
      title: input.title,
      relativeDirectory: input.work.relativePath,
      status: result.status,
      action: result.action,
      attempt: 1,
      mediaCount: result.mediaCount,
      newImageCount: result.newImageCount,
      finishedAt: input.now
    },
    update: {
      externalId: result.externalId,
      title: input.title,
      status: result.status,
      action: result.action,
      attempt: { increment: 1 },
      mediaCount: result.mediaCount,
      newImageCount: result.newImageCount,
      errorMessage: null,
      finishedAt: input.now
    }
  })
  await input.transaction.scanRun.updateMany({
    where: { id: input.runId, checkpointOrdinal: { lt: input.work.ordinal + 1 } },
    data: { checkpointStage: 'PROCESSING', checkpointOrdinal: input.work.ordinal + 1 }
  })
}

export type LocalWorkRow = Prisma.ScanRunLocalWorkInputGetPayload<Record<string, never>>

export function localCheckpointKey(work: Pick<LocalWorkRow, 'ordinal' | 'kind' | 'relativePath'>) {
  const identity = createHash('sha256').update(work.kind).update('\0').update(work.relativePath).digest('hex')
  return `local:${work.ordinal}:${identity}`
}

function localStorageKey(artworkId: number, relativePath: string) {
  const value = createHash('sha256').update(relativePath).digest().readUInt32BE(0) % 9_000_000
  return `e_${artworkId}_${String(value + 1_000_000)}`
}
