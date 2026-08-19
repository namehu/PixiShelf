import * as fs from 'node:fs/promises'
import {
  JobExecutionFenceError,
  type EnqueuedChildJob,
  type ExecutionContext,
  type FencedExecutionTransaction,
  type JobExecutionOutcome,
  type QueueSqlExecutor
} from '@pixishelf/job-runtime'
import type { DerivedMediaGcPayload } from './executors.ts'
import { lockVideoPoster } from './lock.ts'
import { inspectGcCandidate } from './paths.ts'
import type { VideoMediaDatabase, VideoMediaRuntimeConfig, VideoMediaTransaction } from './types.ts'

const DEFAULT_BATCH_SIZE = 100
const DEFAULT_RECONCILIATION_LIMIT = 500
const STREAMING_ARTIFACT_PATTERN = /\.pixishelf-remux-[A-Za-z0-9_-]{1,120}\.(?:tmp|backup)\.mp4$/

type GcEntry = {
  id: string
  mediaKind: string
  relativePath: string
  referenceType: string | null
  referenceId: string | null
  status: 'PENDING' | 'PROCESSING' | 'DELETED' | 'FAILED' | 'SKIPPED_REFERENCED'
  attempt: number
  maxAttempts: number
}

type GcContext = ExecutionContext<DerivedMediaGcPayload, EnqueuedChildJob>
type GcTransaction = VideoMediaTransaction & QueueSqlExecutor
type GcScope = FencedExecutionTransaction<GcTransaction>

interface StagedGcCandidate {
  entry: GcEntry
  originalPath: string
  quarantinePath: string
}

export interface DerivedMediaGcResult {
  selected: number
  processed: number
  deleted: number
  missing: number
  referenced: number
  failed: number
  dryRun: boolean
  reconciliationScanned: number
  reconciliationCandidates: number
  untrackedCandidates: number
}

export async function executeDerivedMediaGc(
  context: GcContext,
  dependencies: { database: VideoMediaDatabase; config: VideoMediaRuntimeConfig; now?: () => Date }
): Promise<JobExecutionOutcome<DerivedMediaGcResult>> {
  const now = dependencies.now ?? (() => new Date())
  const limit = Math.min(dependencies.config.gcBatchSize ?? DEFAULT_BATCH_SIZE, DEFAULT_BATCH_SIZE)
  let activeEntry: GcEntry | null = null
  let stagedCandidate: StagedGcCandidate | null = null
  try {
    const entries = await loadGcEntries(context, dependencies.database, now(), limit)
    const result: DerivedMediaGcResult = {
      selected: entries.length,
      processed: 0,
      deleted: 0,
      missing: 0,
      referenced: 0,
      failed: 0,
      dryRun: context.payload.dryRun,
      reconciliationScanned: 0,
      reconciliationCandidates: 0,
      untrackedCandidates: 0
    }
    if (context.payload.dryRun) {
      await inspectDryRunEntries(context, dependencies, entries, result)
      if (context.payload.reconcile && !context.payload.entryIds) {
        const reconciliation = await dryRunPosterReconciliation(
          dependencies.database,
          dependencies.config.posterStorageRoot,
          Math.min(
            dependencies.config.reconciliationLimit ?? DEFAULT_RECONCILIATION_LIMIT,
            DEFAULT_RECONCILIATION_LIMIT
          )
        )
        result.reconciliationScanned = reconciliation.inspected
        result.reconciliationCandidates = reconciliation.candidates
        result.untrackedCandidates = reconciliation.untracked
      }
      return { kind: 'completed', result, message: `派生媒体 GC dry-run 完成，检查 ${entries.length} 条记录` }
    }

    for (const entry of entries) {
      throwIfAborted(context.signal)
      activeEntry = entry
      const claimed = await claimGcEntry(context, entry)
      if (!claimed) {
        activeEntry = null
        continue
      }
      result.processed += 1
      try {
        const staged = await stageGcCandidate(context, dependencies.config, entry, now())
        if (staged.kind === 'referenced') {
          result.referenced += 1
        } else if (staged.kind === 'missing') {
          result.missing += 1
        } else {
          stagedCandidate = staged.candidate
          throwIfAborted(context.signal)
          const deletionAllowed = await confirmGcDeletion(context, stagedCandidate)
          if (!deletionAllowed) {
            result.referenced += 1
          } else {
            throwIfAborted(context.signal)
            await fs.rm(stagedCandidate.quarantinePath, { force: true })
            const terminal = await finalizeDeletedGcEntry(context, stagedCandidate, now())
            if (terminal === 'deleted') result.deleted += 1
            else if (terminal === 'referenced') result.referenced += 1
            else result.failed += 1
          }
        }
      } catch (error) {
        if (context.signal.aborted || error instanceof JobExecutionFenceError) throw error
        result.failed += 1
        const compensation = stagedCandidate ? await restoreStagedCandidate(stagedCandidate).catch(errorMessage) : null
        const message = [errorMessage(error), compensation ? `restore failed: ${compensation}` : null]
          .filter(Boolean)
          .join('; ')
        await markGcEntryFailed(context, entry, message)
      }
      stagedCandidate = null
      activeEntry = null
      await context.progress({
        progress: Math.min(99, Math.floor((result.processed / Math.max(entries.length, 1)) * 99)),
        stage: 'DELETING',
        message: `GC 已处理 ${result.processed}/${entries.length} 条记录`
      })
    }
    return { kind: 'completed', result, message: `派生媒体 GC 完成，删除 ${result.deleted} 个文件` }
  } catch (error) {
    if (error instanceof JobExecutionFenceError) throw error
    if (context.signal.aborted) {
      return context.finalizeInTransaction<GcTransaction>(async (scope) => {
        if (stagedCandidate) await restoreStagedCandidateUnderLock(scope, stagedCandidate)
        if (activeEntry) {
          await scope.transaction.derivedMediaGcEntry.updateMany({
            where: { id: activeEntry.id, status: 'PROCESSING', lastSystemJobId: context.job.id },
            data: { status: 'PENDING', error: null }
          })
        }
        if (scope.executionStatus === 'PAUSING') {
          await scope.pause({ reason: 'USER_REQUESTED', message: '派生媒体 GC 已暂停' })
        } else if (scope.executionStatus === 'CANCELLING') {
          await scope.cancel('派生媒体 GC 已取消')
        } else {
          await scope.release('派生媒体 GC Worker 已停止')
        }
      })
    }
    const message = errorMessage(error)
    return context.job.attempt < context.job.maxAttempts
      ? {
          kind: 'retry',
          availableAt: new Date(now().getTime() + 60_000),
          errorCode: 'INTERNAL_ERROR',
          error: message,
          message: '派生媒体 GC 异常，等待重试'
        }
      : { kind: 'failed', errorCode: 'INTERNAL_ERROR', error: message, message: '派生媒体 GC 失败' }
  }
}

async function loadGcEntries(context: GcContext, database: VideoMediaDatabase, timestamp: Date, limit: number) {
  const ids = context.payload.entryIds ? [...new Set(context.payload.entryIds)] : null
  const chunks = ids ? chunk(ids, limit) : [null]
  const entries: GcEntry[] = []
  for (const idChunk of chunks) {
    throwIfAborted(context.signal)
    entries.push(
      ...(await database.derivedMediaGcEntry.findMany({
        where: {
          OR: [
            {
              status: { in: ['PENDING', 'FAILED'] },
              attempt: { lt: database.derivedMediaGcEntry.fields.maxAttempts }
            },
            { status: 'PROCESSING' }
          ],
          notBefore: { lte: timestamp },
          ...(idChunk ? { id: { in: idChunk } } : {})
        },
        orderBy: [{ notBefore: 'asc' }, { createdAt: 'asc' }],
        take: idChunk?.length ?? limit,
        select: {
          id: true,
          mediaKind: true,
          relativePath: true,
          referenceType: true,
          referenceId: true,
          status: true,
          attempt: true,
          maxAttempts: true
        }
      }))
    )
  }
  return entries
}

async function inspectDryRunEntries(
  context: GcContext,
  dependencies: { database: VideoMediaDatabase; config: VideoMediaRuntimeConfig },
  entries: GcEntry[],
  result: DerivedMediaGcResult
) {
  for (const entry of entries) {
    throwIfAborted(context.signal)
    const target = resolveGcTarget(dependencies.config, entry)
    if (await isReferenced(dependencies.database, entry)) result.referenced += 1
    else {
      const inspected = await inspectGcCandidate(target.root, entry.relativePath)
      if (inspected.exists) result.deleted += 1
      else result.missing += 1
    }
  }
}

async function claimGcEntry(context: GcContext, entry: GcEntry) {
  return context.mutateInTransaction<GcTransaction, boolean>(async (transaction) => {
    const updated = await transaction.derivedMediaGcEntry.updateMany({
      where: { id: entry.id, status: entry.status },
      data: {
        status: 'PROCESSING',
        attempt: { increment: 1 },
        lastSystemJobId: context.job.id,
        error: null
      }
    })
    return updated.count === 1
  })
}

async function stageGcCandidate(context: GcContext, config: VideoMediaRuntimeConfig, entry: GcEntry, timestamp: Date) {
  const target = resolveGcTarget(config, entry)
  return context.mutateInTransaction<
    GcTransaction,
    { kind: 'referenced' } | { kind: 'missing' } | { kind: 'staged'; candidate: StagedGcCandidate }
  >(async (transaction) => {
    await assertGcOwnership(transaction, context.job.id, entry.id)
    await lockGcReference(transaction, entry)
    const candidate = await inspectGcCandidate(target.root, entry.relativePath)
    const quarantinePath = quarantinePathFor(candidate.outputPath, entry.id)
    const quarantineExists = await safeInternalFileExists(quarantinePath)
    if (await isReferenced(transaction, entry)) {
      if (quarantineExists && !candidate.exists) await fs.rename(quarantinePath, candidate.outputPath)
      else if (quarantineExists) await fs.rm(quarantinePath, { force: true })
      await transitionGcEntry(transaction, context.job.id, entry.id, { status: 'SKIPPED_REFERENCED' })
      return { kind: 'referenced' }
    }
    if (!candidate.exists && !quarantineExists) {
      await transitionGcEntry(transaction, context.job.id, entry.id, { status: 'DELETED', deletedAt: timestamp })
      return { kind: 'missing' }
    }
    if (candidate.exists) {
      if (quarantineExists) await fs.rm(quarantinePath, { force: true })
      await fs.rename(candidate.outputPath, quarantinePath)
    }
    return {
      kind: 'staged',
      candidate: { entry, originalPath: candidate.outputPath, quarantinePath }
    }
  })
}

async function confirmGcDeletion(context: GcContext, candidate: StagedGcCandidate) {
  return context.mutateInTransaction<GcTransaction, boolean>(async (transaction) => {
    await assertGcOwnership(transaction, context.job.id, candidate.entry.id)
    await lockGcReference(transaction, candidate.entry)
    if (!(await isReferenced(transaction, candidate.entry))) return true
    await restoreStagedCandidate(candidate)
    await transitionGcEntry(transaction, context.job.id, candidate.entry.id, { status: 'SKIPPED_REFERENCED' })
    return false
  })
}

async function finalizeDeletedGcEntry(context: GcContext, candidate: StagedGcCandidate, deletedAt: Date) {
  return context.mutateInTransaction<GcTransaction, 'deleted' | 'referenced' | 'failed'>(async (transaction) => {
    await assertGcOwnership(transaction, context.job.id, candidate.entry.id)
    await lockGcReference(transaction, candidate.entry)
    if (await isReferenced(transaction, candidate.entry)) {
      const originalExists = await safeInternalFileExists(candidate.originalPath)
      if (!originalExists) {
        await transitionGcEntry(transaction, context.job.id, candidate.entry.id, {
          status: 'FAILED',
          error: 'A live reference appeared after staged deletion without publishing a replacement file'
        })
        return 'failed'
      }
      await transitionGcEntry(transaction, context.job.id, candidate.entry.id, { status: 'SKIPPED_REFERENCED' })
      return 'referenced'
    }
    await transitionGcEntry(transaction, context.job.id, candidate.entry.id, { status: 'DELETED', deletedAt })
    return 'deleted'
  })
}

async function markGcEntryFailed(context: GcContext, entry: GcEntry, message: string) {
  await context.mutateInTransaction<GcTransaction>(async (transaction) => {
    await transitionGcEntry(transaction, context.job.id, entry.id, { status: 'FAILED', error: message })
  })
}

async function restoreStagedCandidateUnderLock(scope: GcScope, candidate: StagedGcCandidate) {
  await lockGcReference(scope.transaction, candidate.entry)
  await restoreStagedCandidate(candidate)
}

async function restoreStagedCandidate(candidate: StagedGcCandidate) {
  if (!(await safeInternalFileExists(candidate.quarantinePath))) return
  // A publisher may have recreated the final path after GC staged the old inode. In that case
  // the new final wins and only the attempt-owned quarantine is removed.
  if (await safeInternalFileExists(candidate.originalPath)) {
    await fs.rm(candidate.quarantinePath, { force: true })
    return
  }
  await fs.rename(candidate.quarantinePath, candidate.originalPath)
}

async function assertGcOwnership(transaction: GcTransaction, jobId: string, entryId: string) {
  const owned = await transaction.derivedMediaGcEntry.findFirst({
    where: { id: entryId, status: 'PROCESSING', lastSystemJobId: jobId },
    select: { id: true }
  })
  if (!owned) throw new Error('GC entry ownership changed')
}

async function transitionGcEntry(
  transaction: GcTransaction,
  jobId: string,
  entryId: string,
  input: {
    status: 'DELETED' | 'FAILED' | 'SKIPPED_REFERENCED'
    deletedAt?: Date
    error?: string | null
  }
) {
  const updated = await transaction.derivedMediaGcEntry.updateMany({
    where: { id: entryId, status: 'PROCESSING', lastSystemJobId: jobId },
    data: {
      status: input.status,
      error: input.error ?? null,
      ...(input.deletedAt ? { deletedAt: input.deletedAt } : {})
    }
  })
  if (updated.count !== 1) throw new Error('GC entry ownership changed during transition')
}

async function lockGcReference(transaction: GcTransaction, entry: GcEntry) {
  if (entry.mediaKind !== 'VIDEO_POSTER') return
  const imageId = positiveInteger(entry.referenceId)
  if (imageId !== null) await lockVideoPoster(transaction, imageId)
}

async function isReferenced(database: VideoMediaDatabase | VideoMediaTransaction, entry: GcEntry) {
  switch (entry.mediaKind) {
    case 'VIDEO_POSTER':
      return Boolean(
        await database.mediaVideoMetadata.findFirst({
          where: { posterPath: entry.relativePath },
          select: { imageId: true }
        })
      )
    case 'VIDEO_CHAPTER_PREVIEW':
      return Boolean(
        await database.mediaChapterPreview.findFirst({
          where: { previewPath: entry.relativePath },
          select: { id: true }
        })
      )
    case 'VIDEO_STREAMING_ARTIFACT': {
      const normalized = normalizeRelativePath(entry.relativePath)
      return Boolean(
        await database.image.findFirst({
          where: { path: { in: [normalized, `/${normalized}`] } },
          select: { id: true }
        })
      )
    }
    default:
      throw new Error(`Unsupported derived media kind: ${entry.mediaKind}`)
  }
}

function resolveGcTarget(config: VideoMediaRuntimeConfig, entry: GcEntry) {
  switch (entry.mediaKind) {
    case 'VIDEO_POSTER':
      if (entry.referenceType !== 'MEDIA_VIDEO_METADATA_POSTER') {
        throw new Error(`Invalid VIDEO_POSTER reference type: ${entry.referenceType ?? 'null'}`)
      }
      return { root: config.posterStorageRoot }
    case 'VIDEO_CHAPTER_PREVIEW':
      if (entry.referenceType !== 'MEDIA_CHAPTER_PREVIEW') {
        throw new Error(`Invalid VIDEO_CHAPTER_PREVIEW reference type: ${entry.referenceType ?? 'null'}`)
      }
      return { root: config.chapterPreviewStorageRoot }
    case 'VIDEO_STREAMING_ARTIFACT': {
      if (entry.referenceType !== 'IMAGE') {
        throw new Error(`Invalid VIDEO_STREAMING_ARTIFACT reference type: ${entry.referenceType ?? 'null'}`)
      }
      const normalized = normalizeRelativePath(entry.relativePath)
      if (!STREAMING_ARTIFACT_PATTERN.test(normalized)) throw new Error('Invalid streaming artifact filename')
      return { root: config.scanRoot }
    }
    default:
      throw new Error(`Unsupported derived media kind: ${entry.mediaKind}`)
  }
}

async function dryRunPosterReconciliation(database: VideoMediaDatabase, posterRoot: string, limit: number) {
  let directory: Awaited<ReturnType<typeof fs.opendir>>
  try {
    directory = await fs.opendir(posterRoot)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { inspected: 0, candidates: 0, untracked: 0 }
    }
    throw error
  }
  const paths: string[] = []
  let inspected = 0
  try {
    while (inspected < limit) {
      const entry = await directory.read()
      if (!entry) break
      inspected += 1
      if (entry.isFile() && entry.name.endsWith('.webp') && !entry.name.endsWith('.tmp.webp')) paths.push(entry.name)
    }
  } finally {
    await directory.close().catch(() => undefined)
  }
  if (paths.length === 0) return { inspected, candidates: 0, untracked: 0 }
  const [references, tracked] = await Promise.all([
    database.mediaVideoMetadata.findMany({ where: { posterPath: { in: paths } }, select: { posterPath: true } }),
    database.derivedMediaGcEntry.findMany({
      where: {
        mediaKind: 'VIDEO_POSTER',
        relativePath: { in: paths },
        OR: [
          { status: { in: ['PENDING', 'PROCESSING'] } },
          {
            status: 'FAILED',
            attempt: { lt: database.derivedMediaGcEntry.fields.maxAttempts }
          }
        ]
      },
      select: { relativePath: true }
    })
  ])
  const known = new Set([
    ...references.flatMap(({ posterPath }) => (posterPath ? [posterPath] : [])),
    ...tracked.map(({ relativePath }) => relativePath)
  ])
  return {
    inspected,
    candidates: paths.length,
    untracked: paths.filter((candidate) => !known.has(candidate)).length
  }
}

async function safeInternalFileExists(filePath: string) {
  try {
    const metadata = await fs.lstat(filePath)
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error('GC internal candidate is not a regular file')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function quarantinePathFor(outputPath: string, entryId: string) {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(entryId)) throw new Error('Invalid GC entry id for quarantine path')
  return `${outputPath}.pixishelf-gc-${entryId}.pending-delete`
}

function chunk<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size)
  )
}

function positiveInteger(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+/, '')
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown derived media GC failure'
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new Error('Derived media GC was interrupted')
}
