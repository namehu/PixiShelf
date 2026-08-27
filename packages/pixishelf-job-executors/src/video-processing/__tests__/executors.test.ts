import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  EnqueuedChildJob,
  ExecutionContext,
  FencedExecutionTransaction,
  QueueSqlExecutor
} from '@pixishelf/job-runtime'
import { JobExecutionFenceError } from '@pixishelf/job-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVideoProcessingExecutorRegistrations } from '../executors.js'
import type { VideoProcessingDatabase, VideoProcessingTransaction, VideoProcessRunner } from '../types.js'

const executorMocks = vi.hoisted(() => ({
  generateChapterPreviews: vi.fn()
}))

vi.mock('../chapter-preview.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chapter-preview.js')>()),
  generateVideoChapterPreviews: executorMocks.generateChapterPreviews
}))

const roots: string[] = []
const fingerprint = JSON.stringify({
  streams: [{ codec_type: 'video', codec_name: 'h264', width: 640, height: 360 }],
  format: { duration: '4' }
})

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('video processing executor registrations', () => {
  it('registers both versioned central capabilities', () => {
    const registrations = createVideoProcessingExecutorRegistrations({
      database: {} as VideoProcessingDatabase,
      config: { scanRoot: '/scan', chapterPreviewRoot: '/previews', ffmpegThreads: 1 }
    })
    expect(registrations.map(({ jobType, definitionVersion }) => ({ jobType, definitionVersion }))).toEqual([
      { jobType: 'VIDEO_CHAPTER_PREVIEW_GENERATION', definitionVersion: 1 },
      { jobType: 'VIDEO_STREAMING_OPTIMIZATION', definitionVersion: 1 }
    ])
  })

  it('rejects an unbounded chapter page size at registration', () => {
    expect(() =>
      createVideoProcessingExecutorRegistrations({
        database: {} as VideoProcessingDatabase,
        config: { scanRoot: '/scan', chapterPreviewRoot: '/previews', ffmpegThreads: 1, chapterPageSize: 201 }
      })
    ).toThrow('chapterPageSize must be an integer between 1 and 200')
  })

  it('publishes the remux and terminal result inside one fenced finalization callback', async () => {
    const harness = await createHarness('RUNNING')

    await expect(harness.execute()).resolves.toEqual({ kind: 'transactionally-finalized' })
    expect(harness.mutateInTransaction).toHaveBeenCalledTimes(1)
    expect(harness.finalizeInTransaction).toHaveBeenCalledTimes(1)
    expect(harness.transaction.image.update).toHaveBeenCalled()
    expect(harness.transaction.derivedMediaGcEntry.upsert).toHaveBeenCalledTimes(2)
    expect(harness.controls.complete).toHaveBeenCalledWith(expect.objectContaining({ message: '视频流优化完成' }))
  })

  it('honours PAUSING before publication and leaves the source untouched', async () => {
    const harness = await createHarness('PAUSING')
    await expect(harness.execute()).resolves.toEqual({ kind: 'transactionally-finalized' })
    expect(harness.controls.pause).toHaveBeenCalledWith(expect.objectContaining({ reason: 'USER_REQUESTED' }))
    expect(harness.transaction.image.update).not.toHaveBeenCalled()
    expect(await fs.readFile(harness.sourcePath, 'utf8')).toBe('original')
  })

  it('honours CANCELLING before publication and leaves the source untouched', async () => {
    const harness = await createHarness('CANCELLING')
    await expect(harness.execute()).resolves.toEqual({ kind: 'transactionally-finalized' })
    expect(harness.controls.cancel).toHaveBeenCalled()
    expect(harness.transaction.image.update).not.toHaveBeenCalled()
    expect(await fs.readFile(harness.sourcePath, 'utf8')).toBe('original')
  })

  it('releases an aborted execution without running FFmpeg or publishing', async () => {
    const controller = new AbortController()
    controller.abort(new Error('worker shutdown'))
    const harness = await createHarness('RUNNING', { signal: controller.signal })
    await expect(harness.execute()).resolves.toEqual({ kind: 'transactionally-finalized' })
    expect(harness.controls.release).toHaveBeenCalled()
    expect(harness.processRunner).not.toHaveBeenCalled()
    expect(harness.transaction.image.update).not.toHaveBeenCalled()
  })

  it('restores the source when the final lease recheck rejects the transaction', async () => {
    const harness = await createHarness('RUNNING', { rejectFinalRecheck: true })
    await expect(harness.execute()).rejects.toBeInstanceOf(JobExecutionFenceError)
    expect(harness.controls.complete).toHaveBeenCalled()
    expect(harness.finalizeInTransaction).toHaveBeenCalledOnce()
    expect(await fs.readFile(harness.sourcePath, 'utf8')).toBe('original')
  })

  it('does not attempt a false second finalization after rollback also fails', async () => {
    const harness = await createHarness('RUNNING', { failRestore: true })
    await expect(harness.execute()).rejects.toMatchObject({ name: 'VideoProcessingRecoveryError' })
    expect(harness.controls.pause).not.toHaveBeenCalled()
    expect(harness.finalizeInTransaction).toHaveBeenCalledOnce()
    expect(harness.logger.error).toHaveBeenCalledWith(
      'video.streaming_recovery_failed_after_domain_finalization',
      expect.objectContaining({ name: 'VideoProcessingRecoveryError' }),
      expect.objectContaining({ action: 'leave_for_lease_recovery' })
    )
  })

  it('uses its one finalization to pause ACTION_REQUIRED when recovery fails before domain publication', async () => {
    const harness = await createHarness('RUNNING', { missingSource: true })
    await expect(harness.execute()).resolves.toEqual({ kind: 'transactionally-finalized' })
    expect(harness.controls.pause).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'ACTION_REQUIRED', data: { errorCode: 'FILESYSTEM_RECOVERY_FAILED' } })
    )
    expect(harness.finalizeInTransaction).toHaveBeenCalledOnce()
  })

  it('fails a deterministic streaming output mismatch without scheduling a retry', async () => {
    let probeCount = 0
    const sourceFingerprint = JSON.stringify({
      streams: [{ codec_type: 'video', codec_name: 'h264', nb_read_packets: '49', width: 640, height: 360 }],
      format: { duration: '4' }
    })
    const optimizedFingerprint = JSON.stringify({
      streams: [{ codec_type: 'video', codec_name: 'h264', nb_read_packets: '50', width: 640, height: 360 }],
      format: { duration: '4' }
    })
    const processRunner: VideoProcessRunner = async (request) => {
      if (request.command === 'ffprobe') {
        return { stdout: probeCount++ === 0 ? sourceFingerprint : optimizedFingerprint, stderr: '' }
      }
      await fs.copyFile(request.args[request.args.indexOf('-i') + 1]!, request.args.at(-1)!)
      return { stdout: '', stderr: '' }
    }
    const harness = await createHarness('RUNNING', { processRunner })

    await expect(harness.execute()).resolves.toMatchObject({
      kind: 'failed',
      errorCode: 'PRECONDITION_FAILED',
      error: expect.stringContaining('stream 0 nb_read_packets')
    })
    expect(harness.finalizeInTransaction).not.toHaveBeenCalled()
  })

  it('does not settle a chapter job twice when final fence failure races worker abort', async () => {
    executorMocks.generateChapterPreviews.mockResolvedValueOnce({ generated: 1, failed: 0 })
    const controller = new AbortController()
    const controls = createControls()
    const transaction = createTransaction()
    let finalizerCalls = 0
    const finalizeInTransaction = vi.fn(async (operation) => {
      finalizerCalls += 1
      if (finalizerCalls > 1) throw new Error('second finalization is forbidden')
      await operation({
        transaction,
        executionStatus: 'RUNNING',
        ...controls
      } as unknown as FencedExecutionTransaction<VideoProcessingTransaction & QueueSqlExecutor>)
      controller.abort(new Error('worker shutdown'))
      throw new JobExecutionFenceError('chapter-job')
    })
    const registration = createVideoProcessingExecutorRegistrations({
      database: {} as VideoProcessingDatabase,
      config: { scanRoot: '/scan', chapterPreviewRoot: '/previews', ffmpegThreads: 1 }
    }).find(({ jobType }) => jobType === 'VIDEO_CHAPTER_PREVIEW_GENERATION')!
    const context = {
      job: {
        id: 'chapter-job',
        type: 'VIDEO_CHAPTER_PREVIEW_GENERATION',
        definitionVersion: 1,
        attempt: 1,
        maxAttempts: 3,
        executionToken: 'token'
      },
      payload: { mode: 'FULL' },
      signal: controller.signal,
      progress: vi.fn(),
      enqueueChild: vi.fn(),
      mutateInTransaction: vi.fn(),
      finalizeInTransaction,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    } as unknown as ExecutionContext<unknown, EnqueuedChildJob>

    await expect(registration.execute(context)).rejects.toBeInstanceOf(JobExecutionFenceError)
    expect(finalizeInTransaction).toHaveBeenCalledOnce()
    expect(controls.complete).toHaveBeenCalledOnce()
    expect(controls.release).not.toHaveBeenCalled()
    expect(controls.cancel).not.toHaveBeenCalled()
  })
})

async function createHarness(
  executionStatus: 'RUNNING' | 'PAUSING' | 'CANCELLING',
  options: {
    signal?: AbortSignal
    rejectFinalRecheck?: boolean
    failRestore?: boolean
    missingSource?: boolean
    processRunner?: VideoProcessRunner
  } = {}
) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-stream-executor-'))
  roots.push(base)
  const scan = path.join(base, 'scan')
  const previews = path.join(base, 'previews')
  await Promise.all([fs.mkdir(scan), fs.mkdir(previews)])
  const sourcePath = path.join(scan, 'video.mp4')
  await fs.writeFile(sourcePath, 'original')
  if (options.missingSource) await fs.rm(sourcePath)
  const transaction = createTransaction()
  if (options.failRestore) {
    const imageUpdate = transaction.image.update as unknown as ReturnType<typeof vi.fn>
    imageUpdate.mockImplementation(async () => {
      const backupPath = `${sourcePath}.pixishelf-remux-stream-job-a1.backup.mp4`
      await fs.rm(backupPath, { force: true })
      await fs.symlink(sourcePath, backupPath, 'file')
      throw new Error('database publication failed')
    })
  }
  const database = {
    image: { findUnique: vi.fn().mockResolvedValue({ id: 7, path: 'video.mp4', mediaType: 'VIDEO' }) }
  } as unknown as VideoProcessingDatabase
  const processRunner = vi.fn(options.processRunner ?? runner())
  const registration = createVideoProcessingExecutorRegistrations({
    database,
    config: { scanRoot: scan, chapterPreviewRoot: previews, ffmpegThreads: 1 },
    processRunner
  }).find(({ jobType }) => jobType === 'VIDEO_STREAMING_OPTIMIZATION')!
  const controls = createControls()
  const mutateInTransaction = vi.fn(async (operation) => operation(transaction))
  let finalizerCalls = 0
  const finalizeInTransaction = vi.fn(async (operation) => {
    finalizerCalls += 1
    if (finalizerCalls > 1) throw new Error('second finalization is forbidden')
    await operation({
      transaction,
      executionStatus,
      ...controls
    } as unknown as FencedExecutionTransaction<VideoProcessingTransaction & QueueSqlExecutor>)
    if (options.rejectFinalRecheck) throw new JobExecutionFenceError('stream-job')
    return { kind: 'transactionally-finalized' as const }
  })
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const context = {
    job: {
      id: 'stream-job',
      type: 'VIDEO_STREAMING_OPTIMIZATION',
      definitionVersion: 1,
      attempt: 1,
      maxAttempts: 3,
      executionToken: 'token'
    },
    payload: { imageId: 7, relativePath: 'video.mp4', mode: 'REMUX_FASTSTART' },
    signal: options.signal ?? new AbortController().signal,
    progress: vi.fn(),
    enqueueChild: vi.fn(),
    mutateInTransaction,
    finalizeInTransaction,
    logger
  } as unknown as ExecutionContext<unknown, EnqueuedChildJob>
  return {
    sourcePath,
    transaction,
    controls,
    processRunner,
    logger,
    mutateInTransaction,
    finalizeInTransaction,
    execute: () => registration.execute(context)
  }
}

function createControls() {
  return {
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn().mockResolvedValue(undefined),
    skip: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined)
  }
}

function runner(): VideoProcessRunner {
  return async (request) => {
    if (request.command === 'ffprobe') return { stdout: fingerprint, stderr: '' }
    const source = request.args[request.args.indexOf('-i') + 1]!
    const output = request.args.at(-1)!
    await fs.copyFile(source, output)
    return { stdout: '', stderr: '' }
  }
}

function createTransaction() {
  return {
    image: { update: vi.fn().mockResolvedValue({}) },
    derivedMediaGcEntry: { upsert: vi.fn().mockResolvedValue({}) }
  } as unknown as VideoProcessingTransaction
}
