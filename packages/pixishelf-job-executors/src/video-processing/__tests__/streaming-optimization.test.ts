import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildStreamingRemuxArgs, prepareVideoStreamingOptimization } from '../streaming-optimization.js'
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
  it('excludes the detected native MP4 chapter data track before remapping chapters', () => {
    const args = buildStreamingRemuxArgs('source.mp4', 'temporary.mp4', {
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'h264' },
        { index: 1, codec_type: 'audio', codec_name: 'aac' },
        { index: 2, codec_type: 'data', codec_name: 'bin_data', codec_tag_string: 'gpmd', nb_frames: '2' },
        { index: 3, codec_type: 'data', codec_name: 'bin_data', codec_tag_string: 'text', nb_frames: '2' }
      ],
      chapters: [{ id: 0 }, { id: 1 }]
    })

    expect(args).toEqual(
      expect.arrayContaining(['-map', '0', '-map', '-0:3', '-map_metadata', '0', '-map_chapters', '0'])
    )
    expect(args).not.toContain('-0:2')
  })

  it('does not exclude text data streams when there are no matching chapters', () => {
    const args = buildStreamingRemuxArgs('source.mp4', 'temporary.mp4', {
      streams: [{ index: 3, codec_type: 'data', codec_name: 'bin_data', codec_tag_string: 'text', nb_frames: '2' }],
      chapters: []
    })

    expect(args).not.toContain('-0:3')
  })

  it('does not remove any data stream when chapter-track detection is ambiguous', () => {
    const args = buildStreamingRemuxArgs('source.mp4', 'temporary.mp4', {
      streams: [
        { index: 2, codec_type: 'data', codec_name: 'bin_data', codec_tag_string: 'text', nb_frames: '2' },
        { index: 3, codec_type: 'data', codec_name: 'bin_data', codec_tag_string: 'text', nb_frames: '2' }
      ],
      chapters: [{ id: 0 }, { id: 1 }]
    })

    expect(args).not.toContain('-0:2')
    expect(args).not.toContain('-0:3')
  })

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

  it('accepts container-derived frame counts, indexes, and video codec tags changing after remux', async () => {
    const root = await createVideoRoot()
    const runner = createFingerprintRunner(
      {
        streams: [
          { index: 4, codec_type: 'video', codec_name: 'h264', codec_tag_string: 'avc1', width: 1920, height: 1080 }
        ],
        format: { duration: '10' }
      },
      {
        streams: [
          {
            index: 0,
            codec_type: 'video',
            codec_name: 'h264',
            codec_tag_string: 'avc3',
            nb_frames: '000250',
            width: 1920,
            height: 1080
          }
        ],
        format: { duration: '10' }
      }
    )

    const prepared = await prepare(root, { runner })

    await prepared.discard()
  })

  it('accepts a recreated native chapter data track moving behind preserved media streams', async () => {
    const root = await createVideoRoot()
    const chapters = [{ id: 0, start_time: '0.000000', end_time: '10.000000', tags: { title: 'Chapter 1' } }]
    const runner = createFingerprintRunner(
      {
        streams: [
          { index: 0, codec_type: 'video', codec_name: 'h264', codec_tag_string: 'avc1', width: 1920, height: 1080 },
          { index: 1, codec_type: 'data', codec_name: 'bin_data', codec_tag_string: 'text', nb_frames: '1' },
          { index: 2, codec_type: 'audio', codec_name: 'aac', codec_tag_string: 'mp4a', channels: 2 }
        ],
        chapters,
        format: { duration: '10' }
      },
      {
        streams: [
          { index: 0, codec_type: 'video', codec_name: 'h264', codec_tag_string: 'avc1', width: 1920, height: 1080 },
          { index: 1, codec_type: 'audio', codec_name: 'aac', codec_tag_string: 'mp4a', channels: 2 },
          { index: 2, codec_type: 'data', codec_name: 'bin_data', codec_tag_string: 'text', nb_frames: '1' }
        ],
        chapters,
        format: { duration: '10' }
      }
    )

    const prepared = await prepare(root, { runner })

    await prepared.discard()
  })

  it('reports a known frame-count change as an actionable permanent mismatch', async () => {
    const root = await createVideoRoot()
    const runner = createFingerprintRunner(
      {
        streams: [{ codec_type: 'video', codec_name: 'h264', nb_frames: '49', width: 1920, height: 1080 }],
        format: { duration: '10' }
      },
      {
        streams: [{ codec_type: 'video', codec_name: 'h264', nb_frames: '50', width: 1920, height: 1080 }],
        format: { duration: '10' }
      }
    )

    await expect(prepare(root, { runner })).rejects.toMatchObject({
      name: 'VideoProcessingPermanentError',
      code: 'OUTPUT_MISMATCH',
      message: 'Optimized media streams differ from the source (stream 0 nb_frames: source="49", optimized="50")'
    })
  })

  it('probes stream identity and chapters and rejects chapter loss after remux', async () => {
    const root = await createVideoRoot()
    const sourceFingerprint = JSON.stringify({
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'h264', codec_tag_string: 'avc1', width: 1920, height: 1080 },
        { index: 1, codec_type: 'data', codec_name: 'bin_data', codec_tag_string: 'text', nb_frames: '1' }
      ],
      chapters: [{ id: 0, start_time: '0.000000', end_time: '10.000000', tags: { title: 'Chapter 1' } }],
      format: { duration: '10' }
    })
    const optimizedFingerprint = JSON.stringify({
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'h264', codec_tag_string: 'avc1', width: 1920, height: 1080 },
        { index: 1, codec_type: 'data', codec_name: 'bin_data', codec_tag_string: 'text', nb_frames: '1' }
      ],
      chapters: [],
      format: { duration: '10' }
    })
    let probeCount = 0
    const runner: VideoProcessRunner = async (request) => {
      if (request.command === 'ffprobe') {
        expect(request.args).toContain(
          'format=duration:stream=index,codec_type,codec_name,codec_tag_string,nb_frames,width,height,channels:chapter'
        )
        return { stdout: probeCount++ === 0 ? sourceFingerprint : optimizedFingerprint, stderr: '' }
      }
      expect(request.args).toEqual(expect.arrayContaining(['-map', '0', '-map', '-0:1', '-map_chapters', '0']))
      await fs.copyFile(request.args[request.args.indexOf('-i') + 1]!, request.args.at(-1)!)
      return { stdout: '', stderr: '' }
    }

    await expect(prepare(root, { runner })).rejects.toThrow('chapters differ from the source')
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

function createFingerprintRunner(sourceFingerprint: object, optimizedFingerprint: object): VideoProcessRunner {
  let probeCount = 0
  return async (request) => {
    if (request.command === 'ffprobe') {
      return {
        stdout: JSON.stringify(probeCount++ === 0 ? sourceFingerprint : optimizedFingerprint),
        stderr: ''
      }
    }
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
