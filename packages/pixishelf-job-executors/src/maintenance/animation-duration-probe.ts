import {
  getAnimationDurationInventory,
  listAnimationDurationCandidates,
  listDueAnimationDurationRetries,
  publishAnimationDurationProbe,
  type AnimationDurationProbeResult,
  type AnimationDurationCandidate,
  type Prisma,
  type PrismaClient
} from '@pixishelf/db'
import type { AnimationDurationProgressData } from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { IsolatedDurationProbe } from './animation-duration-child.ts'

export const ANIMATION_DURATION_CANDIDATE_PAGE_SIZE = 100
export const ANIMATION_DURATION_BATCH_FILES = 10
export const ANIMATION_DURATION_BATCH_ACTIVE_MS = 5_000
export const ANIMATION_DURATION_YIELD_MS = 5_000

type ProbeContext = ExecutionContext<Record<string, never>, EnqueuedChildJob>
type ProbeTransaction = Prisma.TransactionClient & QueueSqlExecutor

interface Checkpoint {
  kind: 'ANIMATION_DURATION_CHECKPOINT'
  afterImageId: number
  succeeded: number
  static: number
  failedAttempts: number
  logicalReadBytes: number
  logicalReadOperations: number
  unmeasuredFailureAttempts: number
  probeElapsedMs: number
}

const EMPTY_CHECKPOINT: Checkpoint = {
  kind: 'ANIMATION_DURATION_CHECKPOINT',
  afterImageId: 0,
  succeeded: 0,
  static: 0,
  failedAttempts: 0,
  logicalReadBytes: 0,
  logicalReadOperations: 0,
  unmeasuredFailureAttempts: 0,
  probeElapsedMs: 0
}

// Writer-lane yields retain this one child across execution slices. A child
// stuck in uninterruptible NFS I/O poisons the shared instance until it exits.
let sharedProbe: IsolatedDurationProbe | null = null

export interface AnimationDurationExecutorDependencies {
  database: Pick<PrismaClient, 'image' | 'imageAnimationMetadata' | 'systemJob'>
  scanRoot: string
  now?: () => Date
  createProbe?: () => IsolatedDurationProbe
}

export async function executeAnimationDurationProbe(
  context: ProbeContext,
  dependencies: AnimationDurationExecutorDependencies
) {
  if (!dependencies.scanRoot.trim()) throw new Error('Animation duration scan root is required')
  const now = dependencies.now ?? (() => new Date())
  const probe = dependencies.createProbe?.() ?? (sharedProbe ??= new IsolatedDurationProbe())
  const started = Date.now()
  let processed = 0
  let checkpoint = parseCheckpoint((await dependencies.database.systemJob.findUnique({
    where: { id: context.job.id }, select: { result: true }
  }))?.result)
  let cursor = checkpoint.afterImageId
  let reachedEnd = false
  let childUnavailable = false
  const priorityIds = new Set<number>()

  const processCandidate = async (candidate: AnimationDurationCandidate, advanceCursor: boolean): Promise<boolean> => {
    let outcome: Awaited<ReturnType<typeof probeCandidate>>
    try {
      outcome = await probeCandidate(probe, dependencies.scanRoot, candidate, context.signal)
    } catch (error) {
      if (context.signal.aborted) return false
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null
      if (code === 'PROBE_CHILD_UNAVAILABLE') {
        childUnavailable = true
        return false
      }
      throw error
    }
    if (context.signal.aborted) return false
    checkpoint = await context.mutateInTransaction<ProbeTransaction, Checkpoint>(async (tx) => {
      const current = await tx.systemJob.findUniqueOrThrow({ where: { id: context.job.id }, select: { result: true } })
      const previous = parseCheckpoint(current.result)
      const published = await publishAnimationDurationProbe(tx, {
        imageId: candidate.id,
        expectedPath: candidate.path,
        expectedRevision: candidate.animationMetadata?.sourceRevision ?? 0,
        ...(outcome.preState ? { preState: outcome.preState, postState: outcome.postState! } : {}),
        result: outcome.result,
        now: now()
      })
      if (published && outcome.result.status === 'FAILED') {
        await context.recordDiagnostic?.(tx, {
          key: 'animation-duration:' + candidate.id,
          scope: 'ITEM',
          targetType: 'IMAGE',
          targetId: String(candidate.id),
          targetLabel: candidate.path,
          stage: 'ANIMATION_DURATION_PROBE',
          code: outcome.result.failureCode,
          message: '动图时长探测失败',
          itemAttempt: (candidate.animationMetadata?.attemptCount ?? 0) + 1
        })
      }
      const next: Checkpoint = {
        ...previous,
        afterImageId: advanceCursor ? candidate.id : previous.afterImageId,
        succeeded: previous.succeeded + (published && outcome.result.status === 'READY' ? 1 : 0),
        static: previous.static + (published && outcome.result.status === 'NOT_APPLICABLE' ? 1 : 0),
        failedAttempts: previous.failedAttempts + (published && outcome.result.status === 'FAILED' ? 1 : 0),
        logicalReadBytes: previous.logicalReadBytes + outcome.logicalReadBytes,
        logicalReadOperations: previous.logicalReadOperations + outcome.logicalReadOperations,
        unmeasuredFailureAttempts: previous.unmeasuredFailureAttempts +
          (published && outcome.result.status === 'FAILED' ? 1 : 0),
        probeElapsedMs: previous.probeElapsedMs + outcome.elapsedMs
      }
      await tx.systemJob.update({
        where: { id: context.job.id },
        data: { result: next as unknown as Prisma.InputJsonValue, stage: 'PROBING' }
      })
      return next
    })
    if (advanceCursor) cursor = candidate.id
    processed += 1
    if (outcome.result.status === 'FAILED') {
      context.logger.warn('animation.duration.probe.failed', {
        imageId: candidate.id,
        code: outcome.result.failureCode,
        logicalReadBytes: outcome.logicalReadBytes,
        elapsedMs: outcome.elapsedMs
      })
    }
    return true
  }

  const dueRetries = await listDueAnimationDurationRetries(dependencies.database, { limit: 2, now: now() })
  for (const candidate of dueRetries) {
    if (context.signal.aborted || processed >= ANIMATION_DURATION_BATCH_FILES ||
        Date.now() - started >= ANIMATION_DURATION_BATCH_ACTIVE_MS) break
    priorityIds.add(candidate.id)
    if (!(await processCandidate(candidate, false))) break
  }

  while (!childUnavailable && processed < ANIMATION_DURATION_BATCH_FILES && Date.now() - started < ANIMATION_DURATION_BATCH_ACTIVE_MS) {
    if (context.signal.aborted) break
    const page = await listAnimationDurationCandidates(dependencies.database, {
      afterImageId: cursor, limit: ANIMATION_DURATION_CANDIDATE_PAGE_SIZE, now: now()
    })
    if (page.length === 0) {
      reachedEnd = true
      break
    }
    let consumedInPage = 0
    for (const candidate of page) {
      if (processed >= ANIMATION_DURATION_BATCH_FILES || Date.now() - started >= ANIMATION_DURATION_BATCH_ACTIVE_MS) break
      if (context.signal.aborted) break
      consumedInPage += 1
      if (priorityIds.has(candidate.id)) {
        cursor = candidate.id
        continue
      }
      if (!(await processCandidate(candidate, true))) break
    }
    if (childUnavailable) break
    if (consumedInPage === page.length && page.length < ANIMATION_DURATION_CANDIDATE_PAGE_SIZE) {
      reachedEnd = true
      break
    }
  }

  return context.finalizeInTransaction<ProbeTransaction>(async (scope) => {
    if (scope.executionStatus === 'CANCELLING') {
      await scope.cancel('动图时长探测已取消')
      return
    }
    if (scope.executionStatus === 'PAUSING') {
      await scope.pause({ reason: 'USER_REQUESTED', message: '动图时长探测已暂停' })
      return
    }
    if (context.signal.aborted) {
      await scope.release('动图时长探测在文件边界停止，等待 Worker 恢复')
      return
    }
    const current = await scope.transaction.systemJob.findUniqueOrThrow({
      where: { id: context.job.id }, select: { result: true }
    })
    checkpoint = parseCheckpoint(current.result)
    const inventory = await getAnimationDurationInventory(scope.transaction, { now: now() })
    if (reachedEnd && inventory.dueCount > 0) {
      checkpoint = { ...checkpoint, afterImageId: 0 }
    }
    const remainingItems = inventory.dueCount + inventory.retryPendingCount + inventory.writePendingCount
    const stage: AnimationDurationProgressData['stage'] =
      remainingItems === 0 && !childUnavailable
        ? 'COMPLETED'
        : inventory.dueCount > 0 || childUnavailable
          ? 'YIELDING'
          : inventory.retryPendingCount > 0
            ? 'WAITING_RETRY'
            : 'WAITING_SOURCE_WRITE'
    const progressData: AnimationDurationProgressData = {
      version: 1,
      kind: 'animation-duration-probe',
      stage,
      succeededItems: checkpoint.succeeded,
      staticItems: checkpoint.static,
      failedItems: inventory.failedCount,
      remainingItems,
      retryPendingItems: inventory.retryPendingCount,
      writePendingItems: inventory.writePendingCount,
      logicalReadBytes: checkpoint.logicalReadBytes,
      logicalReadOperations: checkpoint.logicalReadOperations,
      unmeasuredFailureAttempts: checkpoint.unmeasuredFailureAttempts,
      probeElapsedMs: checkpoint.probeElapsedMs,
      sampledAt: now().toISOString()
    }
    await scope.transaction.systemJob.update({
      where: { id: context.job.id },
      data: {
        result: checkpoint as unknown as Prisma.InputJsonValue,
        stage,
        progressData,
        progress: remainingItems === 0 && !childUnavailable
          ? 100
          : Math.min(99, Math.max(1, Math.floor(((inventory.totalCount - remainingItems) / Math.max(1, inventory.totalCount)) * 100)))
      }
    })
    if (remainingItems === 0 && !childUnavailable) {
      await scope.complete({
        result: { ...checkpoint, permanentFailures: inventory.failedPermanentCount },
        message: `动图时长探测完成：成功 ${checkpoint.succeeded}，静态 ${checkpoint.static}，失败 ${inventory.failedPermanentCount}`
      })
      return
    }
    const availableAt = childUnavailable
      ? new Date(now().getTime() + 60_000)
      : inventory.dueCount > 0
      ? new Date(now().getTime() + ANIMATION_DURATION_YIELD_MS)
      : inventory.nextRetryAt ?? new Date(now().getTime() + 600_000)
    await scope.retry({
      availableAt,
      errorCode: 'RESOURCE_BUSY',
      error: childUnavailable
        ? 'Animation duration child is unavailable or the source changed during a read'
        : 'Animation duration probe yielded after a durable batch',
      message: stage === 'WAITING_SOURCE_WRITE'
        ? `等待 ${inventory.writePendingCount} 个源文件写入结束；10 分钟后复核`
        : `已探测 ${checkpoint.succeeded} 个动图，剩余 ${remainingItems} 个，正在让出 Worker`,
      preserveAttempt: true,
      schedulingYield: !childUnavailable
    })
  })
}

async function probeCandidate(
  probe: IsolatedDurationProbe,
  scanRoot: string,
  candidate: AnimationDurationCandidate,
  signal: AbortSignal
): Promise<{
  result: AnimationDurationProbeResult
  preState?: Awaited<ReturnType<IsolatedDurationProbe['probe']>>['preState']
  postState?: Awaited<ReturnType<IsolatedDurationProbe['probe']>>['postState']
  logicalReadBytes: number
  logicalReadOperations: number
  elapsedMs: number
}> {
  const started = performance.now()
  try {
    const result = await probe.probe(scanRoot, candidate.path, signal)
    return {
      result: result.probe.status === 'READY'
        ? {
            status: 'READY', format: 'WEBP', durationMs: BigInt(result.probe.durationMs!),
            frameCount: result.probe.frameCount!, loopCount: result.probe.loopCount!
          }
        : { status: 'NOT_APPLICABLE', format: 'WEBP' },
      preState: result.preState,
      postState: result.postState,
      logicalReadBytes: result.probe.readBytes,
      logicalReadOperations: result.probe.readOperations,
      elapsedMs: Math.max(0, Math.round(result.elapsedMs))
    }
  } catch (error) {
    if (signal.aborted) throw error
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code : 'PROBE_IO_ERROR'
    if (code === 'PROBE_CHILD_UNAVAILABLE') throw error
    return {
      result: {
        status: 'FAILED', format: 'WEBP', failureCode: code,
        transient: isTransientFailure(code)
      },
      ...(code !== 'SOURCE_CHANGED' && error && typeof error === 'object' && 'preState' in error && 'postState' in error
        ? { preState: error.preState as Awaited<ReturnType<IsolatedDurationProbe['probe']>>['preState'],
            postState: error.postState as Awaited<ReturnType<IsolatedDurationProbe['probe']>>['postState'] }
        : {}),
      logicalReadBytes: 0,
      logicalReadOperations: 0,
      elapsedMs: Math.max(0, Math.round(performance.now() - started))
    }
  }
}

function isTransientFailure(code: string): boolean {
  return !new Set([
    'INVALID_WEBP', 'TRUNCATED_WEBP', 'WEBP_READ_BUDGET_EXCEEDED', 'WEBP_CHUNK_LIMIT_EXCEEDED',
    'UNSUPPORTED_WEBP_ANIMATION', 'PATH_OUTSIDE_SCAN_ROOT', 'EISDIR'
  ]).has(code)
}

function parseCheckpoint(value: unknown): Checkpoint {
  if (!value || typeof value !== 'object') return { ...EMPTY_CHECKPOINT }
  const parsed = value as Partial<Checkpoint>
  if (parsed.kind !== 'ANIMATION_DURATION_CHECKPOINT' || !Number.isSafeInteger(parsed.afterImageId)) {
    return { ...EMPTY_CHECKPOINT }
  }
  return {
    kind: 'ANIMATION_DURATION_CHECKPOINT',
    afterImageId: parsed.afterImageId!,
    succeeded: safeCount(parsed.succeeded),
    static: safeCount(parsed.static),
    failedAttempts: safeCount(parsed.failedAttempts),
    logicalReadBytes: safeCount(parsed.logicalReadBytes),
    logicalReadOperations: safeCount(parsed.logicalReadOperations),
    unmeasuredFailureAttempts: safeCount(parsed.unmeasuredFailureAttempts),
    probeElapsedMs: safeCount(parsed.probeElapsedMs)
  }
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}
