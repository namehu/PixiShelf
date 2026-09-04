import * as fs from 'node:fs/promises'
import path from 'node:path'
import type { AnimationScanProgressData } from '@pixishelf/job-contracts'
import {
  IsolatedSharpAnimationProbePool,
  SHARP_ANIMATION_PROBE_TIMEOUT_SECONDS
} from './sharp-animation-probe-pool.ts'
import type { MaintenanceOperationInput } from './types.ts'
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
  let initialized = 0
  await input.progress({
    percentage: 0,
    stage: 'INITIALIZING',
    message: '正在统计动画识别候选图片',
    progressData: createProgressData({
      stage: 'INITIALIZING',
      initialized,
      total: 0,
      result: emptyResult(),
      activeProbes: 0,
      concurrency,
      samples: [],
      now: now()
    }),
    persistenceMode: 'REALTIME',
    forcePersistence: true
  })
  const initializable = await input.database.image.count({
    where: { webpAnimationStatus: null, OR: PATH_FILTERS }
  })
  await input.progress({
    percentage: 1,
    stage: 'INITIALIZING',
    message: initializable === 0 ? '动画识别初始化完成' : `正在初始化 ${initializable} 个候选图片`,
    progressData: createProgressData({
      stage: 'INITIALIZING',
      initialized,
      total: initializable,
      result: emptyResult(),
      activeProbes: 0,
      concurrency,
      samples: [],
      now: now()
    }),
    persistenceMode: 'REALTIME',
    forcePersistence: true
  })
  initialized = await initializePendingAnimationImages(input, async (count) => {
    initialized = count
    await input.progress({
      percentage: initializable === 0 ? 4 : Math.min(4, 1 + Math.floor((initialized / initializable) * 3)),
      stage: 'INITIALIZING',
      message: `已初始化 ${initialized} / ${initializable} 个候选图片`,
      progressData: createProgressData({
        stage: 'INITIALIZING',
        initialized,
        total: initializable,
        result: emptyResult(),
        activeProbes: 0,
        concurrency,
        samples: [],
        now: now()
      }),
      persistenceMode: 'REALTIME'
    })
  })

  throwIfMaintenanceAborted(input.signal)
  const pendingWhere = { webpAnimationStatus: ANIMATION_STATUS.pending, OR: PATH_FILTERS }
  const totalPending = await input.database.image.count({ where: pendingWhere })
  const result: WebpAnimationScanResult = {
    initialized,
    processed: 0,
    animated: 0,
    static: 0,
    failed: 0,
    remainingPending: totalPending,
    failedSamples: []
  }
  const samples: Array<{ attempted: number; at: number }> = []
  let activeProbes = 0
  let reportingError: unknown
  const reportingOperations = new Set<Promise<void>>()

  const progressSnapshot = async (
    options: {
      force?: boolean
      level?: 'INFO' | 'WARN' | 'ERROR'
      data?: Record<string, unknown>
    } = {}
  ) => {
    const attempted = result.processed + result.failed
    const sampledAt = now()
    recordRateSample(samples, attempted, sampledAt.getTime())
    await input.progress({
      percentage: totalPending === 0 ? 100 : Math.min(99, 5 + Math.floor((attempted / totalPending) * 94)),
      stage: 'SCANNING',
      message:
        totalPending === 0
          ? '没有待识别动画图片'
          : `已尝试 ${attempted} / ${totalPending} 个，活动探测 ${activeProbes} 个，失败 ${result.failed} 个`,
      progressData: createProgressData({
        stage: 'SCANNING',
        initialized,
        total: totalPending,
        result,
        activeProbes,
        concurrency,
        samples,
        now: sampledAt
      }),
      persistenceMode: 'REALTIME',
      ...(options.force === undefined ? {} : { forcePersistence: options.force }),
      ...(options.level ? { level: options.level } : {}),
      ...(options.data ? { data: options.data } : {})
    })
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
          await commitDetectionOutcomes(input, outcomes, result)
          await progressSnapshot()
        }
      })
    }
  } finally {
    clearInterval(reportingTimer)
    await Promise.allSettled([...reportingOperations])
    await sharpProbePool?.close()
  }

  if (reportingError) throw reportingError
  throwIfMaintenanceAborted(input.signal)
  result.remainingPending = await input.database.image.count({ where: pendingWhere })
  result.failedSamples.sort((left, right) => left.id - right.id)
  const completedAt = now()
  recordRateSample(samples, result.processed + result.failed, completedAt.getTime())
  await input.progress({
    percentage: 100,
    stage: 'COMPLETED',
    message: `动画识别完成：动图 ${result.animated} 个，静态 ${result.static} 个，失败 ${result.failed} 个`,
    progressData: createProgressData({
      stage: 'COMPLETED',
      initialized,
      total: totalPending,
      result,
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
  outcomes: DetectionOutcome[],
  result: WebpAnimationScanResult
): Promise<void> {
  throwIfMaintenanceAborted(input.signal)
  const animatedIds = outcomes.filter((outcome) => outcome.animated === true).map(({ image }) => image.id)
  const staticIds = outcomes.filter((outcome) => outcome.animated === false).map(({ image }) => image.id)
  let committedAnimated = 0
  let committedStatic = 0
  if (animatedIds.length > 0 || staticIds.length > 0) {
    const committed = await input.mutate(async (transaction) => {
      let animated = 0
      let staticImages = 0
      if (animatedIds.length > 0) {
        animated = (
          await transaction.image.updateMany({
            where: { id: { in: animatedIds }, webpAnimationStatus: ANIMATION_STATUS.pending },
            data: { webpAnimationStatus: ANIMATION_STATUS.animated, mediaType: 'ANIMATION' }
          })
        ).count
      }
      if (staticIds.length > 0) {
        staticImages = (
          await transaction.image.updateMany({
            where: { id: { in: staticIds }, webpAnimationStatus: ANIMATION_STATUS.pending },
            data: { webpAnimationStatus: ANIMATION_STATUS.static, mediaType: 'IMAGE' }
          })
        ).count
      }
      if (animated !== animatedIds.length || staticImages !== staticIds.length) {
        throw new Error('Animation scan result lost its pending database state')
      }
      return { animated, staticImages }
    })
    committedAnimated = committed.animated
    committedStatic = committed.staticImages
  }
  result.animated += committedAnimated
  result.static += committedStatic
  result.processed += committedAnimated + committedStatic
  for (const outcome of outcomes) {
    if (!outcome.failure) continue
    result.failed += 1
    if (result.failedSamples.length >= FAILED_SAMPLE_LIMIT) continue
    result.failedSamples.push({
      id: outcome.image.id,
      path: safeMediaReference(outcome.image.path, outcome.image.id),
      errorCode: outcome.failure.code,
      error: outcome.failure.summary
    })
  }
}

function emptyResult(): WebpAnimationScanResult {
  return { initialized: 0, processed: 0, animated: 0, static: 0, failed: 0, remainingPending: 0, failedSamples: [] }
}

function createProgressData(input: {
  stage: AnimationScanProgressData['stage']
  initialized: number
  total: number
  result: WebpAnimationScanResult
  activeProbes: number
  concurrency: number
  samples: Array<{ attempted: number; at: number }>
  now: Date
}): AnimationScanProgressData {
  const attempted = input.result.processed + input.result.failed
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
    failedItems: input.result.failed,
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
  onBatch: (initialized: number) => Promise<void>
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
    const update = await input.mutate((transaction) =>
      transaction.image.updateMany({
        where: { id: { in: candidates.map(({ id }) => id) }, webpAnimationStatus: null },
        data: { webpAnimationStatus: ANIMATION_STATUS.pending }
      })
    )
    initialized += update.count
    await onBatch(initialized)
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
