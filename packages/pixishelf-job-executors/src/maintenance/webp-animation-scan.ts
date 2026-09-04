import * as fs from 'node:fs/promises'
import path from 'node:path'
import { animationScanProgressDataSchema, type AnimationScanProgressData } from '@pixishelf/job-contracts'
import { IsolatedSharpAnimationProbePool, SHARP_ANIMATION_PROBE_TIMEOUT_SECONDS } from './sharp-animation-probe-pool.ts'
import type { MaintenanceOperationInput, MaintenanceProgress, RunMaintenanceProgressMutation } from './types.ts'
import { throwIfMaintenanceAborted } from './types.ts'

export const ANIMATION_SCAN_BATCH_SIZE = 20
export const ANIMATION_INITIALIZE_BATCH_SIZE = 500
export const ANIMATION_SCAN_CONCURRENCY_DEFAULT = 4
export const ANIMATION_SCAN_CONCURRENCY_MIN = 1
export const ANIMATION_SCAN_CONCURRENCY_MAX = 8
export const ANIMATION_SCAN_RESULT_FLUSH_MS = 2_000
export const ANIMATION_SCAN_SLOW_ITEM_MS = 10_000
export const ANIMATION_SCAN_SHARP_TIMEOUT_SECONDS = SHARP_ANIMATION_PROBE_TIMEOUT_SECONDS
const FAILED_SAMPLE_LIMIT = 20
const ANIMATION_STATUS = { pending: 0, static: 1, animated: 2 } as const
const ANIMATION_EXTENSIONS = ['.webp', '.gif', '.png', '.apng']
const PATH_FILTERS = ANIMATION_EXTENSIONS.map((extension) => ({
  path: { endsWith: extension, mode: 'insensitive' as const }
}))
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const APNG_CONTROL_DATA_LENGTH = 8

export interface WebpAnimationScanResult {
  initialized: number
  processed: number
  animated: number
  static: number
  failed: number
  remainingPending: number
  failedSamples: Array<{ id: number; path: string; errorCode: WebpAnimationFailureCode; error: string }>
}

export type WebpAnimationFailureCode =
  | 'PATH_OUTSIDE_SCAN_ROOT'
  | 'MEDIA_FILE_NOT_FOUND'
  | 'MEDIA_FILE_UNREADABLE'
  | 'INVALID_ANIMATION_MEDIA'
  | 'ANIMATION_PROBE_FAILED'

export class WebpAnimationScanConfigurationError extends Error {
  readonly code = 'SCAN_ROOT_UNAVAILABLE'

  constructor() {
    super('Configured animation scan root is unavailable')
    this.name = 'WebpAnimationScanConfigurationError'
  }
}

export async function scanWebpAnimations(
  input: MaintenanceOperationInput & {
    scanRoot: string
    concurrency?: number
    now?: () => Date
    slowItemThresholdMs?: number
    resumeProgressData?: AnimationScanProgressData | null
    detectAnimated?: (absolutePath: string, mediaPath: string, signal: AbortSignal) => Promise<boolean>
  }
): Promise<WebpAnimationScanResult> {
  const canonicalRoot = await resolveCanonicalScanRoot(input.scanRoot)
  const concurrency = assertAnimationScanConcurrency(input.concurrency ?? ANIMATION_SCAN_CONCURRENCY_DEFAULT)
  const sharpProbePool = input.detectAnimated ? undefined : new IsolatedSharpAnimationProbePool({ size: concurrency })
  const detect =
    input.detectAnimated ??
    ((absolutePath: string, mediaPath: string, signal: AbortSignal) =>
      detectAnimatedWithPool(sharpProbePool!, absolutePath, mediaPath, signal))
  const slowItemThresholdMs = input.slowItemThresholdMs ?? ANIMATION_SCAN_SLOW_ITEM_MS
  const now = input.now ?? (() => new Date())
  const parsedCheckpoint = input.resumeProgressData
    ? animationScanProgressDataSchema.parse(input.resumeProgressData)
    : null
  const checkpoint = parsedCheckpoint
  const commitProgress: RunMaintenanceProgressMutation =
    input.checkpoint ??
    (async (operation) => {
      // Direct executor tests and embedders can retain the legacy adapter. The
      // production Worker always supplies the atomic fenced implementation.
      const durable = await input.mutate(operation)
      await input.progress(durable.update)
      return durable.result
    })
  const previousAttempted = checkpoint?.attemptedItems ?? 0
  const previousFailed = checkpoint?.failedItems ?? 0
  const previousSucceeded = checkpoint?.succeededItems ?? 0
  let initialized = checkpoint?.initializedItems ?? 0
  const result: WebpAnimationScanResult = {
    initialized,
    processed: previousSucceeded,
    animated: checkpoint?.animatedItems ?? 0,
    static: checkpoint?.staticItems ?? 0,
    failed: 0,
    remainingPending: checkpoint?.remainingItems ?? 0,
    failedSamples: []
  }
  if (checkpoint) {
    await input.progress({
      percentage: checkpointProgressPercentage(checkpoint),
      stage: checkpoint.stage === 'COMPLETED' ? 'SCANNING' : checkpoint.stage,
      message: `正在恢复动画识别：已尝试 ${previousAttempted} / ${checkpoint.totalItems} 个`,
      progressData: createProgressData({
        stage: checkpoint.stage === 'COMPLETED' ? 'SCANNING' : checkpoint.stage,
        initialized,
        total: checkpoint.totalItems,
        result,
        attempted: previousAttempted,
        failed: previousFailed,
        activeProbes: 0,
        concurrency,
        samples: [],
        now: now()
      }),
      persistenceMode: 'REALTIME',
      forcePersistence: true
    })
  } else {
    await input.progress({
      percentage: 0,
      stage: 'INITIALIZING',
      message: '正在统计动画识别候选图片',
      progressData: createProgressData({
        stage: 'INITIALIZING',
        initialized,
        total: 0,
        result,
        activeProbes: 0,
        concurrency,
        samples: [],
        now: now()
      }),
      persistenceMode: 'REALTIME',
      forcePersistence: true
    })
  }
  const initializable = await input.database.image.count({
    where: { webpAnimationStatus: null, OR: PATH_FILTERS }
  })
  const initializationTotal = checkpoint
    ? Math.max(checkpoint.totalItems, checkpoint.initializedItems + initializable)
    : initializable
  if (!checkpoint || initializable > 0) {
    await input.progress({
      percentage: checkpoint ? checkpointProgressPercentage(checkpoint) : 1,
      stage: checkpoint && checkpoint.stage !== 'INITIALIZING' ? 'SCANNING' : 'INITIALIZING',
      message: initializable === 0 ? '动画识别初始化完成' : `正在初始化 ${initializable} 个候选图片`,
      progressData: createProgressData({
        stage: checkpoint && checkpoint.stage !== 'INITIALIZING' ? 'SCANNING' : 'INITIALIZING',
        initialized,
        total: initializationTotal,
        result,
        attempted: previousAttempted,
        failed: previousFailed,
        activeProbes: 0,
        concurrency,
        samples: [],
        now: now()
      }),
      persistenceMode: 'REALTIME',
      forcePersistence: true
    })
  }
  const initializedBeforeAttempt = initialized
  const initializedThisAttempt = await initializePendingAnimationImages(input, commitProgress, (count) => {
    const durableInitialized = initializedBeforeAttempt + count
    const durableResult = { ...result, initialized: durableInitialized }
    return {
      percentage: checkpoint
        ? checkpoint.stage === 'INITIALIZING'
          ? checkpointProgressPercentage({
              ...checkpoint,
              initializedItems: durableInitialized,
              totalItems: initializationTotal
            })
          : checkpointProgressPercentage(checkpoint)
        : initializable === 0
          ? 4
          : Math.min(4, 1 + Math.floor((count / initializable) * 3)),
      stage: checkpoint && checkpoint.stage !== 'INITIALIZING' ? 'SCANNING' : 'INITIALIZING',
      message: checkpoint
        ? `恢复任务已初始化 ${count} 个新增候选图片`
        : `已初始化 ${count} / ${initializable} 个候选图片`,
      progressData: createProgressData({
        stage: checkpoint && checkpoint.stage !== 'INITIALIZING' ? 'SCANNING' : 'INITIALIZING',
        initialized: durableInitialized,
        total: initializationTotal,
        result: durableResult,
        attempted: previousAttempted,
        failed: previousFailed,
        activeProbes: 0,
        concurrency,
        samples: [],
        now: now()
      }),
      persistenceMode: 'REALTIME'
    }
  })
  initialized = initializedBeforeAttempt + initializedThisAttempt
  result.initialized = initialized

  throwIfMaintenanceAborted(input.signal)
  const pendingWhere = { webpAnimationStatus: ANIMATION_STATUS.pending, OR: PATH_FILTERS }
  const totalPending = await input.database.image.count({ where: pendingWhere })
  const totalItems = checkpoint ? Math.max(checkpoint.totalItems, previousSucceeded + totalPending) : totalPending
  result.remainingPending = totalPending
  const samples: Array<{ attempted: number; at: number }> = []
  let attemptedThisAttempt = 0
  let activeProbes = 0
  let reportingError: unknown
  const reportingOperations = new Set<Promise<void>>()
  let commitBarrier: Promise<void> = Promise.resolve()

  const createScanningProgress = (
    snapshotResult: WebpAnimationScanResult,
    attemptedInAttempt: number,
    options: {
      force?: boolean
      level?: 'INFO' | 'WARN' | 'ERROR'
      data?: Record<string, unknown>
    } = {}
  ): MaintenanceProgress & { progressData: AnimationScanProgressData } => {
    const attempted = Math.min(totalItems, Math.max(previousAttempted, previousSucceeded + attemptedInAttempt))
    const failed = checkpoint ? Math.max(previousFailed, snapshotResult.failed) : snapshotResult.failed
    const sampledAt = now()
    recordRateSample(samples, attempted, sampledAt.getTime())
    return {
      percentage: Math.max(
        checkpoint ? checkpointProgressPercentage(checkpoint) : 0,
        scanProgressPercentage(attempted, totalItems)
      ),
      stage: 'SCANNING',
      message:
        totalItems === 0
          ? '没有待识别动画图片'
          : `已尝试 ${attempted} / ${totalItems} 个，活动探测 ${activeProbes} 个，失败 ${failed} 个`,
      progressData: createProgressData({
        stage: 'SCANNING',
        initialized,
        total: totalItems,
        result: snapshotResult,
        attempted,
        failed,
        activeProbes,
        concurrency,
        samples,
        now: sampledAt
      }),
      persistenceMode: 'REALTIME',
      ...(options.force === undefined ? {} : { forcePersistence: options.force }),
      ...(options.level ? { level: options.level } : {}),
      ...(options.data ? { data: options.data } : {})
    }
  }

  const progressSnapshot = async (
    options: {
      force?: boolean
      level?: 'INFO' | 'WARN' | 'ERROR'
      data?: Record<string, unknown>
    } = {}
  ) => {
    // Observation snapshots may lag an in-flight detection batch. Waiting on
    // commitBarrier ensures the displayed counters never claim work that has
    // not crossed the fenced domain checkpoint yet.
    await commitBarrier
    await input.progress(createScanningProgress(result, attemptedThisAttempt, options))
  }

  let cursor = 0
  await progressSnapshot({ force: true })
  const reportingTimer = setInterval(() => {
    const operation = progressSnapshot()
    reportingOperations.add(operation)
    void operation
      .catch((error) => {
        reportingError ??= error
      })
      .finally(() => reportingOperations.delete(operation))
  }, 1_000)
  reportingTimer.unref()

  try {
    while (true) {
      throwIfMaintenanceAborted(input.signal)
      if (reportingError) throw reportingError
      const batch = await input.database.image.findMany({
        where: { ...pendingWhere, id: { gt: cursor } },
        orderBy: { id: 'asc' },
        take: ANIMATION_SCAN_BATCH_SIZE,
        select: { id: true, path: true }
      })
      if (batch.length === 0) break
      cursor = batch.at(-1)!.id
      await processDetectionBatch({
        batch,
        concurrency,
        signal: input.signal,
        slowItemThresholdMs,
        detect: async (image, signal) => {
          const absolutePath = await resolveExistingPathWithinRoot(canonicalRoot, image.path, signal)
          return detect(absolutePath, image.path, signal)
        },
        onActiveChange: (delta) => {
          activeProbes += delta
        },
        onSlowItem: () =>
          progressSnapshot({
            force: true,
            level: 'WARN',
            data: {
              level: 'WARN',
              code: 'SLOW_ANIMATION_PROBE',
              thresholdSeconds: slowItemThresholdMs / 1_000
            }
          }),
        commit: async (outcomes) => {
          const nextAttemptedThisAttempt = attemptedThisAttempt + outcomes.length
          const operation = (async () => {
            const nextResult = await commitDetectionOutcomes(input, commitProgress, outcomes, result, (durableResult) =>
              createScanningProgress(durableResult, nextAttemptedThisAttempt)
            )
            attemptedThisAttempt = nextAttemptedThisAttempt
            Object.assign(result, nextResult)
          })()
          commitBarrier = operation
          await operation
        }
      })
    }
  } finally {
    clearInterval(reportingTimer)
    await Promise.allSettled([...reportingOperations])
    await sharpProbePool?.close()
    if (input.signal.aborted) {
      activeProbes = 0
      await progressSnapshot({ force: true }).catch(() => undefined)
    }
  }

  if (reportingError) throw reportingError
  throwIfMaintenanceAborted(input.signal)
  // A restart reconstructs totals from pending rows and the last durable
  // aggregate; only this final checkpoint can advertise COMPLETED. Replaying
  // an already-committed micro-batch is prevented by the pending-state CAS.
  result.remainingPending = await input.database.image.count({ where: pendingWhere })
  result.failed = result.remainingPending
  result.failedSamples.sort((left, right) => left.id - right.id)
  const completedAt = now()
  recordRateSample(samples, totalItems, completedAt.getTime())
  await input.progress({
    percentage: 100,
    stage: 'COMPLETED',
    message: `动画识别完成：动图 ${result.animated} 个，静态 ${result.static} 个，失败 ${result.failed} 个`,
    progressData: createProgressData({
      stage: 'COMPLETED',
      initialized,
      total: totalItems,
      result,
      attempted: totalItems,
      failed: result.failed,
      activeProbes: 0,
      concurrency,
      samples,
      now: completedAt
    }),
    persistenceMode: 'REALTIME',
    forcePersistence: true
  })
  return result
}

interface DetectionOutcome {
  image: { id: number; path: string }
  animated?: boolean
  failure?: { code: WebpAnimationFailureCode; summary: string }
}

async function processDetectionBatch(input: {
  batch: Array<{ id: number; path: string }>
  concurrency: number
  signal: AbortSignal
  slowItemThresholdMs: number
  detect(image: { id: number; path: string }, signal: AbortSignal): Promise<boolean>
  onActiveChange(delta: number): void
  onSlowItem(): Promise<void>
  commit(outcomes: DetectionOutcome[]): Promise<void>
}): Promise<void> {
  let nextIndex = 0
  let buffer: DetectionOutcome[] = []
  let flushError: unknown
  let flushTail = Promise.resolve()
  const batchController = new AbortController()
  const slowOperations = new Set<Promise<void>>()
  const abortBatch = () => batchController.abort(input.signal.reason)
  if (input.signal.aborted) abortBatch()
  else input.signal.addEventListener('abort', abortBatch, { once: true })
  const flush = () => {
    if (buffer.length === 0) return flushTail
    const outcomes = buffer
    buffer = []
    const operation = flushTail.then(() => input.commit(outcomes))
    flushTail = operation.catch((error) => {
      flushError ??= error
      batchController.abort(error)
    })
    return operation
  }
  const timer = setInterval(() => {
    void flush()
  }, ANIMATION_SCAN_RESULT_FLUSH_MS)
  timer.unref()

  const worker = async () => {
    while (true) {
      throwIfMaintenanceAborted(batchController.signal)
      if (flushError) throw flushError
      const image = input.batch[nextIndex]
      nextIndex += 1
      if (!image) return
      input.onActiveChange(1)
      const slowTimer = setTimeout(() => {
        if (batchController.signal.aborted) return
        const operation = input.onSlowItem()
        slowOperations.add(operation)
        void operation
          .catch((error) => {
            flushError ??= error
            batchController.abort(error)
          })
          .finally(() => slowOperations.delete(operation))
      }, input.slowItemThresholdMs)
      slowTimer.unref()
      try {
        buffer.push({ image, animated: await input.detect(image, batchController.signal) })
      } catch (error) {
        if (batchController.signal.aborted) throw abortReason(batchController.signal, error)
        buffer.push({ image, failure: classifyAnimationFailure(error) })
      } finally {
        clearTimeout(slowTimer)
        input.onActiveChange(-1)
      }
      if (buffer.length >= ANIMATION_SCAN_BATCH_SIZE) await flush()
    }
  }

  try {
    const workers = Array.from({ length: Math.min(input.concurrency, input.batch.length) }, () => worker())
    const settled = await Promise.allSettled(workers)
    await Promise.allSettled([...slowOperations])
    if (input.signal.aborted) throw abortReason(input.signal)
    if (flushError) throw flushError
    const workerFailure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (workerFailure) throw workerFailure.reason
    await flush()
    await flushTail
    if (flushError) throw flushError
  } finally {
    clearInterval(timer)
    input.signal.removeEventListener('abort', abortBatch)
  }
}

async function commitDetectionOutcomes(
  input: MaintenanceOperationInput,
  commitProgress: RunMaintenanceProgressMutation,
  outcomes: DetectionOutcome[],
  result: WebpAnimationScanResult,
  createUpdate: (result: WebpAnimationScanResult) => MaintenanceProgress & { progressData: AnimationScanProgressData }
): Promise<WebpAnimationScanResult> {
  throwIfMaintenanceAborted(input.signal)
  const animatedIds = outcomes.filter((outcome) => outcome.animated === true).map(({ image }) => image.id)
  const staticIds = outcomes.filter((outcome) => outcome.animated === false).map(({ image }) => image.id)
  return commitProgress(async (transaction) => {
    let committedAnimated = 0
    let committedStatic = 0
    if (animatedIds.length > 0) {
      committedAnimated = (
        await transaction.image.updateMany({
          where: { id: { in: animatedIds }, webpAnimationStatus: ANIMATION_STATUS.pending },
          data: { webpAnimationStatus: ANIMATION_STATUS.animated, mediaType: 'ANIMATION' }
        })
      ).count
    }
    if (staticIds.length > 0) {
      committedStatic = (
        await transaction.image.updateMany({
          where: { id: { in: staticIds }, webpAnimationStatus: ANIMATION_STATUS.pending },
          data: { webpAnimationStatus: ANIMATION_STATUS.static, mediaType: 'IMAGE' }
        })
      ).count
    }
    if (committedAnimated !== animatedIds.length || committedStatic !== staticIds.length) {
      throw new Error('Animation scan result lost its pending database state')
    }
    const nextResult: WebpAnimationScanResult = {
      ...result,
      animated: result.animated + committedAnimated,
      static: result.static + committedStatic,
      processed: result.processed + committedAnimated + committedStatic,
      failed: result.failed + outcomes.filter((outcome) => outcome.failure).length,
      failedSamples: [...result.failedSamples]
    }
    for (const outcome of outcomes) {
      if (!outcome.failure || nextResult.failedSamples.length >= FAILED_SAMPLE_LIMIT) continue
      nextResult.failedSamples.push({
        id: outcome.image.id,
        path: safeMediaReference(outcome.image.path, outcome.image.id),
        errorCode: outcome.failure.code,
        error: outcome.failure.summary
      })
    }
    return { result: nextResult, update: createUpdate(nextResult) }
  })
}

function createProgressData(input: {
  stage: AnimationScanProgressData['stage']
  initialized: number
  total: number
  result: WebpAnimationScanResult
  attempted?: number
  failed?: number
  activeProbes: number
  concurrency: number
  samples: Array<{ attempted: number; at: number }>
  now: Date
}): AnimationScanProgressData {
  const attempted = input.attempted ?? input.result.processed + input.result.failed
  const failed = input.failed ?? input.result.failed
  const rate = rollingRate(input.samples)
  const advancingSamples = input.samples.filter(
    (sample, index) => index > 0 && sample.attempted > input.samples[index - 1]!.attempted
  )
  const sampleSpan = input.samples.length > 1 ? input.samples.at(-1)!.at - input.samples[0]!.at : 0
  const etaSeconds =
    input.stage === 'SCANNING' && rate > 0 && sampleSpan >= 10_000 && advancingSamples.length >= 3
      ? Math.ceil(Math.max(0, input.total - attempted) / rate)
      : null
  return {
    version: 1,
    kind: 'animation-scan',
    stage: input.stage,
    initializedItems: input.initialized,
    totalItems: input.total,
    attemptedItems: attempted,
    succeededItems: input.result.processed,
    failedItems: failed,
    animatedItems: input.result.animated,
    staticItems: input.result.static,
    remainingItems:
      input.stage === 'COMPLETED' ? input.result.remainingPending : Math.max(0, input.total - input.result.processed),
    activeProbes: input.activeProbes,
    concurrencyLimit: input.concurrency,
    itemsPerSecond: rate,
    etaSeconds,
    sampledAt: input.now.toISOString()
  }
}

function scanProgressPercentage(attempted: number, total: number) {
  return total === 0 ? 99 : Math.min(99, 5 + Math.floor((attempted / total) * 94))
}

function checkpointProgressPercentage(checkpoint: AnimationScanProgressData): number {
  if (checkpoint.stage === 'COMPLETED') return 100
  if (checkpoint.stage === 'SCANNING') {
    return scanProgressPercentage(checkpoint.attemptedItems, checkpoint.totalItems)
  }
  if (checkpoint.totalItems === 0) return 0
  return Math.min(4, 1 + Math.floor((checkpoint.initializedItems / checkpoint.totalItems) * 3))
}

function recordRateSample(samples: Array<{ attempted: number; at: number }>, attempted: number, at: number) {
  const previous = samples.at(-1)
  if (!previous || previous.at !== at || previous.attempted !== attempted) samples.push({ attempted, at })
  const cutoff = at - 30_000
  while (samples.length > 1 && samples[0]!.at < cutoff) samples.shift()
}

function rollingRate(samples: Array<{ attempted: number; at: number }>): number {
  if (samples.length < 2) return 0
  const first = samples[0]!
  const last = samples.at(-1)!
  const elapsedSeconds = (last.at - first.at) / 1_000
  if (elapsedSeconds <= 0) return 0
  return Math.max(0, (last.attempted - first.attempted) / elapsedSeconds)
}

function assertAnimationScanConcurrency(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < ANIMATION_SCAN_CONCURRENCY_MIN ||
    value > ANIMATION_SCAN_CONCURRENCY_MAX
  ) {
    throw new Error(
      `Animation scan concurrency must be between ${ANIMATION_SCAN_CONCURRENCY_MIN} and ${ANIMATION_SCAN_CONCURRENCY_MAX}`
    )
  }
  return value
}

async function initializePendingAnimationImages(
  input: MaintenanceOperationInput,
  commitProgress: RunMaintenanceProgressMutation,
  createUpdate: (initialized: number) => MaintenanceProgress & { progressData: AnimationScanProgressData }
): Promise<number> {
  let initialized = 0
  let cursor = 0
  while (true) {
    throwIfMaintenanceAborted(input.signal)
    const candidates = await input.database.image.findMany({
      where: { webpAnimationStatus: null, OR: PATH_FILTERS, id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: ANIMATION_INITIALIZE_BATCH_SIZE,
      select: { id: true }
    })
    if (candidates.length === 0) break
    cursor = candidates.at(-1)!.id
    const committed = await commitProgress(async (transaction) => {
      const update = await transaction.image.updateMany({
        where: { id: { in: candidates.map(({ id }) => id) }, webpAnimationStatus: null },
        data: { webpAnimationStatus: ANIMATION_STATUS.pending }
      })
      const nextInitialized = initialized + update.count
      return { result: update.count, update: createUpdate(nextInitialized) }
    })
    initialized += committed
  }
  return initialized
}

async function resolveCanonicalScanRoot(scanRoot: string): Promise<string> {
  try {
    return await fs.realpath(scanRoot)
  } catch {
    throw new WebpAnimationScanConfigurationError()
  }
}

export async function detectAnimatedImage(
  absolutePath: string,
  mediaPath = absolutePath,
  signal?: AbortSignal
): Promise<boolean> {
  const probeSignal = signal ?? new AbortController().signal
  const pool = new IsolatedSharpAnimationProbePool({ size: 1 })
  try {
    return await detectAnimatedWithPool(pool, absolutePath, mediaPath, probeSignal)
  } finally {
    await pool.close()
  }
}

async function detectAnimatedWithPool(
  pool: IsolatedSharpAnimationProbePool,
  absolutePath: string,
  mediaPath: string,
  signal: AbortSignal
): Promise<boolean> {
  throwIfMaintenanceAborted(signal)
  const extension = path.extname(mediaPath).toLowerCase()
  if (extension === '.png' || extension === '.apng') return detectAnimatedPng(absolutePath, signal)
  if (extension === '.webp' || extension === '.gif') {
    const animated = await pool.detect(absolutePath, signal)
    throwIfMaintenanceAborted(signal)
    return animated
  }
  throw new Error(`Unsupported animation probe format: ${extension || '<none>'}`)
}

async function detectAnimatedPng(absolutePath: string, signal?: AbortSignal): Promise<boolean> {
  if (signal) throwIfMaintenanceAborted(signal)
  const file = await fs.open(absolutePath, 'r')
  try {
    const fileSize = (await file.stat()).size
    if (signal) throwIfMaintenanceAborted(signal)
    const signature = Buffer.alloc(PNG_SIGNATURE.length)
    const signatureRead = await file.read(signature, 0, signature.length, 0)
    if (signal) throwIfMaintenanceAborted(signal)
    if (signatureRead.bytesRead !== signature.length || !signature.equals(PNG_SIGNATURE)) {
      throw new Error('Invalid PNG signature')
    }
    let position = PNG_SIGNATURE.length
    const chunkHeader = Buffer.alloc(8)
    while (position + 12 <= fileSize) {
      if (signal) throwIfMaintenanceAborted(signal)
      const headerRead = await file.read(chunkHeader, 0, chunkHeader.length, position)
      if (headerRead.bytesRead !== chunkHeader.length) throw new Error('Invalid PNG chunk header')
      const chunkLength = chunkHeader.readUInt32BE(0)
      const chunkType = chunkHeader.toString('ascii', 4, 8)
      if (position + chunkLength + 12 > fileSize) throw new Error('PNG chunk exceeds file length')
      if (chunkType === 'acTL') {
        if (chunkLength !== APNG_CONTROL_DATA_LENGTH) throw new Error(`Invalid acTL chunk length: ${chunkLength}`)
        const controlDataAndCrc = Buffer.alloc(APNG_CONTROL_DATA_LENGTH + 4)
        const controlRead = await file.read(controlDataAndCrc, 0, controlDataAndCrc.length, position + 8)
        if (signal) throwIfMaintenanceAborted(signal)
        if (controlRead.bytesRead !== controlDataAndCrc.length) throw new Error('Invalid acTL chunk data')
        const controlData = controlDataAndCrc.subarray(0, APNG_CONTROL_DATA_LENGTH)
        const storedCrc = controlDataAndCrc.readUInt32BE(APNG_CONTROL_DATA_LENGTH)
        const calculatedCrc = pngCrc32(Buffer.concat([chunkHeader.subarray(4, 8), controlData]))
        if (storedCrc !== calculatedCrc) throw new Error('Invalid acTL chunk CRC')
        const frameCount = controlData.readUInt32BE(0)
        if (frameCount === 0) throw new Error('Invalid acTL num_frames: 0')
        return frameCount > 1
      }
      if (chunkType === 'IDAT' || chunkType === 'IEND') return false
      position += chunkLength + 12
    }
    throw new Error('PNG ended before IDAT or IEND')
  } finally {
    await file.close()
  }
}

async function resolveExistingPathWithinRoot(
  canonicalRoot: string,
  relativePath: string,
  signal: AbortSignal
): Promise<string> {
  throwIfMaintenanceAborted(signal)
  const candidate = path.resolve(canonicalRoot, relativePath.replace(/^[/\\]+/, ''))
  assertWithinRoot(canonicalRoot, candidate)
  const canonicalCandidate = await fs.realpath(candidate)
  throwIfMaintenanceAborted(signal)
  assertWithinRoot(canonicalRoot, canonicalCandidate)
  const stat = await fs.stat(canonicalCandidate)
  throwIfMaintenanceAborted(signal)
  if (!stat.isFile()) throw new Error('Animation probe path is not a file')
  return canonicalCandidate
}

function abortReason(signal: AbortSignal, fallback?: unknown): Error {
  if (signal.reason instanceof Error) return signal.reason
  if (fallback instanceof Error) return fallback
  return new Error('Animation scan was interrupted')
}

function assertWithinRoot(root: string, candidate: string): void {
  const relative = path.relative(root, candidate)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return
  throw new Error('Animation probe path is outside the configured scan root')
}

function safeMediaReference(mediaPath: string, imageId: number): string {
  const source = mediaPath.replace(/\\/g, '/')
  const normalized = source.replace(/^\/+/, '')
  if (source.startsWith('//') || /^[a-z]:\//i.test(source) || normalized.split('/').includes('..')) {
    return `image:${imageId}`
  }
  return normalized.slice(0, 240) || `image:${imageId}`
}

function classifyAnimationFailure(error: unknown): { code: WebpAnimationFailureCode; summary: string } {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : null
  const message = error instanceof Error ? error.message : ''
  if (message.includes('outside the configured scan root')) {
    return { code: 'PATH_OUTSIDE_SCAN_ROOT', summary: 'Media path is outside the configured scan root' }
  }
  if (code === 'ENOENT') return { code: 'MEDIA_FILE_NOT_FOUND', summary: 'Media file was not found' }
  if (code === 'EACCES' || code === 'EPERM') {
    return { code: 'MEDIA_FILE_UNREADABLE', summary: 'Media file could not be read' }
  }
  if (/Invalid PNG|PNG chunk|acTL|unsupported animation probe format/i.test(message)) {
    return { code: 'INVALID_ANIMATION_MEDIA', summary: 'Media file is not a valid supported animation image' }
  }
  return { code: 'ANIMATION_PROBE_FAILED', summary: 'Animation detection failed' }
}

function pngCrc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}
