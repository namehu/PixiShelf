import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareVideoStreamingOptimization } from '../streaming-optimization.js'
import type { VideoProcessingDatabase, VideoProcessingTransaction, VideoProcessRunner } from '../types.js'

const roots: string[] = []
const fingerprint = JSON.stringify({
  streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 }],
  format: { duration: '10' }
})

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('streaming optimization central executor core', () => {
  it('rejects a path traversal before invoking FFmpeg', async () => {
    const root = await createVideoRoot()
    const runner = vi.fn()
    await expect(prepare(root, { relativePath: '../escape.mp4', imagePath: '../escape.mp4', runner })).rejects.toThrow(
      'relative'
    )
    expect(runner).not.toHaveBeenCalled()
  })

  it('observes cancellation before starting a process', async () => {
    const root = await createVideoRoot()
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    const runner = vi.fn()
    await expect(prepare(root, { signal: controller.signal, runner })).rejects.toThrow('cancelled')
    expect(runner).not.toHaveBeenCalled()
  })

  it('rejects when the source changes during remux', async () => {
    const root = await createVideoRoot()
    const runner = createRunner(async (source, output) => {
      await fs.copyFile(source, output)
      await fs.appendFile(source, '-changed')
    })
    await expect(prepare(root, { runner })).rejects.toThrow('changed during streaming optimization')
  })

  it('restores the original file when database publication fails', async () => {
    const root = await createVideoRoot()
    const prepared = await prepare(root, { runner: createRunner() })
    const transaction = createTransaction()
    vi.mocked(transaction.image.update).mockRejectedValueOnce(new Error('database unavailable'))

    await expect(prepared.publish(transaction)).rejects.toThrow('database unavailable')
    await expect(fs.readFile(root.source, 'utf8')).resolves.toBe('original-video')
  })

  it('can roll back a published swap when the fenced terminal commit fails', async () => {
    const root = await createVideoRoot()
    const prepared = await prepare(root, {
      runner: createRunner(async (_source, output) => fs.writeFile(output, 'optimized-video'))
    })
    await prepared.publish(createTransaction())
    expect(await fs.readFile(root.source, 'utf8')).toBe('optimized-video')

    await prepared.rollback()
    expect(await fs.readFile(root.source, 'utf8')).toBe('original-video')
  })

  it('treats a missing expected publication backup as a recovery failure', async () => {
    const root = await createVideoRoot()
    const prepared = await prepare(root, {
      runner: createRunner(async (_source, output) => fs.writeFile(output, 'optimized-video'))
    })
    await prepared.publish(createTransaction())
    await fs.rm(`${root.source}.pixishelf-remux-stream-job-a2.backup.mp4`)

    await expect(prepared.rollback()).rejects.toMatchObject({ name: 'VideoProcessingRecoveryError' })
  })

  it('reports monotonically increasing progress even when FFmpeg timestamps regress', async () => {
    const root = await createVideoRoot()
    const percentages: number[] = []
    const runner: VideoProcessRunner = async (request) => {
      if (request.command === 'ffprobe') return { stdout: fingerprint, stderr: '' }
      await fs.copyFile(request.args[request.args.indexOf('-i') + 1]!, request.args.at(-1)!)
      request.onStdout?.('out_time=00:00:08.000\n')
      request.onStdout?.('out_time=00:00:02.000\n')
      return { stdout: '', stderr: '' }
    }

    const prepared = await prepare(root, {
      runner,
      progress: async ({ percentage }) => {
        percentages.push(percentage)
      }
    })

    expect(percentages).toEqual([...percentages].sort((left, right) => left - right))
    expect(percentages.some((percentage) => percentage > 15 && percentage < 82)).toBe(true)
    await prepared.discard()
  })

  it('recovers a prior-attempt backup without scanning when the source is missing', async () => {
    const root = await createVideoRoot()
    await fs.rm(root.source)
    await fs.writeFile(`${root.source}.pixishelf-remux-stream-job-a1.backup.mp4`, 'recovered-original-video')

    const prepared = await prepare(root, { runner: createRunner() })

    expect(prepared.result.originalSize).toBe(Buffer.byteLength('recovered-original-video'))
    expect(await fs.readFile(root.source, 'utf8')).toBe('recovered-original-video')
    await prepared.discard()
  })

  it('requires manual recovery when both the source and prior-attempt backup are missing', async () => {
    const root = await createVideoRoot()
    await fs.rm(root.source)

    await expect(prepare(root, { runner: createRunner() })).rejects.toMatchObject({
      name: 'VideoProcessingRecoveryError'
    })
  })
})

async function prepare(
  root: Awaited<ReturnType<typeof createVideoRoot>>,
  options: {
    relativePath?: string
    imagePath?: string
    signal?: AbortSignal
    runner?: VideoProcessRunner | ReturnType<typeof vi.fn>
    progress?: (update: { percentage: number }) => Promise<void>
  }
) {
  const imagePath = options.imagePath ?? 'video.mp4'
  const database = {
    image: { findUnique: vi.fn().mockResolvedValue({ id: 7, path: imagePath, mediaType: 'VIDEO' }) }
  } as unknown as VideoProcessingDatabase
  const transaction = createTransaction()
  return prepareVideoStreamingOptimization({
    jobId: 'stream-job',
    attempt: 2,
    imageId: 7,
    relativePath: options.relativePath ?? imagePath,
    database,
    config: { scanRoot: root.scan, chapterPreviewRoot: root.previews, ffmpegThreads: 1 },
    processRunner: (options.runner ?? createRunner()) as VideoProcessRunner,
    signal: options.signal ?? new AbortController().signal,
    progress: options.progress ?? vi.fn(),
    mutate: (operation) => operation(transaction),
    now: () => new Date('2026-08-14T00:00:00.000Z')
  })
}

function createRunner(remux?: (source: string, output: string) => Promise<unknown>): VideoProcessRunner {
  return async (request) => {
    if (request.command === 'ffprobe') return { stdout: fingerprint, stderr: '' }
    const source = request.args[request.args.indexOf('-i') + 1]!
    const output = request.args.at(-1)!
    await (remux ? remux(source, output) : fs.copyFile(source, output))
    return { stdout: '', stderr: '' }
  }
}

function createTransaction() {
  return {
    image: { update: vi.fn().mockResolvedValue({}) },
    derivedMediaGcEntry: { upsert: vi.fn().mockResolvedValue({}) }
  } as unknown as VideoProcessingTransaction
}

async function createVideoRoot() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-stream-'))
  roots.push(base)
  const scan = path.join(base, 'scan')
  const previews = path.join(base, 'previews')
  await Promise.all([fs.mkdir(scan), fs.mkdir(previews)])
  const source = path.join(scan, 'video.mp4')
  await fs.writeFile(source, 'original-video')
  return { scan, previews, source }
}
