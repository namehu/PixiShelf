import { createHash } from 'node:crypto'
import type { EnqueuedChildJob, ExecutionContext, QueueSqlExecutor } from '@pixishelf/job-runtime'
import type { ScanPayload } from '@pixishelf/job-contracts'
import { collectLocalMedia, verifyLocalWorkFingerprint } from './discovery.ts'
import { ScanExecutorError } from './errors.ts'
import { localWorkInputDigest } from './digests.ts'
import type { LocalWorkInputRow, ScanRunRecord } from './run-store.ts'
import type { ScanExecutorDependencies, ScanExecutorLimits, ScanTransaction } from './types.ts'
import type { SafeScanRoot } from './paths.ts'

export async function executeLocalArtworkRescan(input: {
  context: ExecutionContext<ScanPayload, EnqueuedChildJob>
  dependencies: ScanExecutorDependencies
  root: SafeScanRoot
  run: ScanRunRecord
  limits: ScanExecutorLimits
  now: Date
}) {
  if (input.context.payload.mode !== 'ARTWORK_RESCAN') {
    throw new ScanExecutorError('STATE_CONFLICT', 'Local artwork rescan requires an ARTWORK_RESCAN payload')
  }
  const artworkId = input.context.payload.artworkId
  const work = await loadFrozenWork(input.dependencies, input.run)
  await verifyLocalWorkFingerprint({
    root: input.root,
    relativeDirectory: work.relativePath,
    kind: work.kind,
    expectedFingerprint: work.fingerprint,
    limits: input.limits,
    signal: input.context.signal
  })
  const media = await collectLocalMedia(
    input.root,
    work.relativePath,
    { maxEntries: input.limits.maxEntries, maxMediaPerArtwork: input.limits.maxMediaPerArtwork },
    input.context.signal
  )
  if (media.length === 0) throw new ScanExecutorError('MEDIA_NOT_FOUND', 'Local artwork has no supported media')

  return input.context.mutateInTransaction<
    ScanTransaction & QueueSqlExecutor,
    { status: 'SUCCESS'; newImages: number }
  >(async (transaction) => {
    const artwork = await transaction.artwork.findUnique({
      where: { id: artworkId },
      select: { id: true, source: true, storagePath: true }
    })
    if (
      !artwork ||
      (artwork.source !== 'LOCAL_CREATED' && artwork.source !== 'LOCAL_IMPORT') ||
      artwork.storagePath !== work.relativePath
    ) {
      throw new ScanExecutorError('STATE_CONFLICT', 'Artwork source or storage path changed after the rescan snapshot')
    }
    const checkpointKey = localRescanCheckpointKey(artwork.id, work.relativePath)
    const checkpoint = await transaction.scanRunItem.findUnique({
      where: { scanRunId_checkpointKey: { scanRunId: input.run.id, checkpointKey } },
      select: { status: true, newImageCount: true }
    })
    if (checkpoint?.status === 'SUCCESS') {
      return { status: 'SUCCESS' as const, newImages: checkpoint.newImageCount }
    }
    const ordered = await reconcileLocalArtworkImages(transaction, artwork.id, media, input.now)
    await transaction.scanRunItem.upsert({
      where: { scanRunId_checkpointKey: { scanRunId: input.run.id, checkpointKey } },
      create: {
        scanRunId: input.run.id,
        checkpointKey,
        externalId: String(artwork.id),
        relativeDirectory: work.relativePath,
        status: 'SUCCESS',
        action: 'UPDATE',
        attempt: 1,
        mediaCount: ordered.length,
        newImageCount: ordered.length,
        finishedAt: input.now
      },
      update: {
        status: 'SUCCESS',
        action: 'UPDATE',
        attempt: { increment: 1 },
        mediaCount: ordered.length,
        newImageCount: ordered.length,
        errorMessage: null,
        finishedAt: input.now
      }
    })
    await transaction.scanRun.update({
      where: { id: input.run.id },
      data: { checkpointOrdinal: 1, checkpointStage: 'PROCESSING' }
    })
    return { status: 'SUCCESS' as const, newImages: ordered.length }
  })
}

export async function reconcileLocalArtworkImages(
  transaction: ScanTransaction,
  artworkId: number,
  media: readonly Awaited<ReturnType<typeof collectLocalMedia>>[number][],
  now: Date
) {
  const incomingIdentities = new Set<string>()
  for (const item of media) {
    const identity = normalizePath(item.relativePath)
    if (incomingIdentities.has(identity)) {
      throw new ScanExecutorError(
        'INPUT_SNAPSHOT_INVALID',
        'Local artwork contains media paths that collide after case folding'
      )
    }
    incomingIdentities.add(identity)
  }
  const existing = await transaction.image.findMany({
    where: { artworkId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
  })
  const existingIdentities = new Set<string>()
  for (const image of existing) {
    const identity = normalizePath(image.path)
    if (existingIdentities.has(identity)) {
      throw new ScanExecutorError(
        'STATE_CONFLICT',
        'Artwork database contains image paths that collide after case folding'
      )
    }
    existingIdentities.add(identity)
  }
  const existingByPath = new Map(existing.map((image) => [normalizePath(image.path), image]))
  const incomingByPath = new Map(media.map((item) => [normalizePath(item.relativePath), item]))
  const ordered = [
    ...existing.flatMap((image) => {
      const item = incomingByPath.get(normalizePath(image.path))
      return item ? [item] : []
    }),
    ...media.filter((item) => !existingByPath.has(normalizePath(item.relativePath)))
  ]
  const retainedIds: number[] = []
  const additions: Array<{
    artworkId: number
    path: string
    size: bigint
    sortOrder: number
    mediaType: 'IMAGE' | 'ANIMATION' | 'VIDEO'
    webpAnimationStatus: number | null
    chaptersPath: string | null
    chaptersCount: number
    chaptersDuration: number | null
    chaptersUpdatedAt: Date | null
    chaptersHash: string | null
  }> = []
  for (const [sortOrder, item] of ordered.entries()) {
    const previous = existingByPath.get(normalizePath(item.relativePath))
    const data = {
      path: item.relativePath,
      size: item.size,
      sortOrder,
      mediaType: item.mediaType,
      webpAnimationStatus: item.webpAnimationStatus,
      chaptersPath: item.chaptersPath,
      chaptersCount: item.chaptersCount,
      chaptersDuration: item.chaptersDuration,
      chaptersUpdatedAt: item.chaptersPath ? now : null,
      chaptersHash: item.chaptersHash
    }
    if (previous) {
      retainedIds.push(previous.id)
      if (
        previous.path !== data.path ||
        previous.size !== data.size ||
        previous.sortOrder !== data.sortOrder ||
        previous.mediaType !== data.mediaType ||
        previous.webpAnimationStatus !== data.webpAnimationStatus ||
        (previous.chaptersPath ?? null) !== data.chaptersPath ||
        (previous.chaptersCount ?? 0) !== data.chaptersCount ||
        (previous.chaptersDuration ?? null) !== data.chaptersDuration ||
        (previous.chaptersUpdatedAt?.getTime() ?? null) !== (data.chaptersUpdatedAt?.getTime() ?? null) ||
        (previous.chaptersHash ?? null) !== data.chaptersHash
      ) {
        await transaction.image.update({ where: { id: previous.id }, data })
      }
    } else {
      additions.push({ artworkId, ...data })
    }
  }
  const retainedIdSet = new Set(retainedIds)
  const removedIds = existing.filter((image) => !retainedIdSet.has(image.id)).map((image) => image.id)
  if (removedIds.length > 0) {
    await transaction.image.deleteMany({ where: { artworkId, id: { in: removedIds } } })
  }
  if (additions.length > 0) await transaction.image.createMany({ data: additions })
  return ordered
}

async function loadFrozenWork(
  dependencies: ScanExecutorDependencies,
  run: ScanRunRecord
): Promise<LocalWorkInputRow & { kind: 'MEDIA_DIRECTORY' }> {
  if (!run.inputFrozenAt || run.inputCount !== 1 || !run.inputDigest) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Local artwork rescan has no frozen directory snapshot')
  }
  const rows = await dependencies.database.scanRunLocalWorkInput.findMany({
    where: { scanRunId: run.id },
    orderBy: { ordinal: 'asc' },
    take: 2
  })
  const work = rows[0]
  if (rows.length !== 1 || !work || work.ordinal !== 0) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Local artwork rescan snapshot is invalid')
  }
  if (work.kind !== 'MEDIA_DIRECTORY') {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Local artwork rescan work kind is no longer supported')
  }
  if (!work.fingerprint || localWorkInputDigest([work]) !== run.inputDigest) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Local artwork rescan snapshot is invalid')
  }
  return { ...work, kind: 'MEDIA_DIRECTORY' }
}

function normalizePath(value: string) {
  return value
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .normalize('NFC')
    .toLocaleLowerCase('und')
}

function localRescanCheckpointKey(artworkId: number, relativePath: string) {
  const digest = createHash('sha256').update(String(artworkId)).update('\0').update(relativePath).digest('hex')
  return `local-rescan:${digest}`
}
