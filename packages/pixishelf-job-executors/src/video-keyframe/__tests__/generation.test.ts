import { beforeEach, describe, expect, it, vi } from 'vitest'

const { resolveSourceFile, resolveKeyframePath, probeVideoDuration, extractVideoFrame, isValidWebp, stat, rm } =
  vi.hoisted(() => ({
    resolveSourceFile: vi.fn(),
    resolveKeyframePath: vi.fn(),
    probeVideoDuration: vi.fn(),
    extractVideoFrame: vi.fn(),
    isValidWebp: vi.fn(),
    stat: vi.fn(),
    rm: vi.fn()
  }))

vi.mock('../paths.js', () => ({ resolveSourceFile, resolveKeyframePath }))
vi.mock('../media-process.js', () => ({ probeVideoDuration, extractVideoFrame, isValidWebp }))
vi.mock('node:fs/promises', () => ({ stat, rm }))

import { generateVideoKeyframes } from '../generation.js'

const payload = { imageId: 1, relativePath: 'videos/1.mp4', mode: 'MANUAL_INCREMENTAL' as const }

describe('video keyframe generation domain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveSourceFile.mockResolvedValue({ sourcePath: '/scan/videos/1.mp4', stat: { size: 100, mtimeMs: 200 } })
    resolveKeyframePath.mockImplementation((_root: string, relativePath: string) => `/keyframes/${relativePath}`)
    probeVideoDuration.mockResolvedValue(10)
    isValidWebp.mockResolvedValue(true)
    stat.mockResolvedValue({ size: 100, mtimeMs: 200 })
    rm.mockResolvedValue(undefined)
  })

  it('does not execute a checkpoint callback after a stale fence rejects the mutator', async () => {
    const staleFence = new Error('stale execution fence')
    const create = vi.fn()
    const mutate = vi.fn().mockRejectedValue(staleFence)
    const database = {
      image: { findUnique: vi.fn().mockResolvedValue({ id: 1, path: 'videos/1.mp4', mediaType: 'VIDEO' }) },
      mediaVideoKeyframeSet: { findUnique: vi.fn().mockResolvedValue(null), create },
      mediaVideoKeyframe: { findMany: vi.fn(), count: vi.fn() }
    }

    await expect(
      generateVideoKeyframes({
        jobId: 'job-1',
        payload,
        database: database as never,
        mutate,
        config: { scanRoot: '/scan', keyframeStorageRoot: '/keyframes', ffmpegThreads: 2 },
        signal: new AbortController().signal,
        progress: vi.fn().mockResolvedValue(undefined)
      })
    ).rejects.toBe(staleFence)
    expect(mutate).toHaveBeenCalledOnce()
    expect(create).not.toHaveBeenCalled()
  })

  it('surfaces an all-candidate extraction failure as retryable process failure', async () => {
    const frame = { id: 'frame-1', candidateIndex: 0, captureTime: 1, status: 'PENDING', path: null }
    const set = {
      id: 'set-1',
      status: 'STAGING',
      sourceSize: BigInt(100),
      sourceMtimeMs: BigInt(200),
      policyVersion: 1
    }
    const frameUpdate = vi.fn(async ({ data }: { data: { status?: string } }) => {
      if (data.status) frame.status = data.status
      return frame
    })
    const database = {
      image: { findUnique: vi.fn().mockResolvedValue({ id: 1, path: 'videos/1.mp4', mediaType: 'VIDEO' }) },
      mediaVideoKeyframeSet: { findUnique: vi.fn().mockResolvedValue(set) },
      mediaVideoKeyframe: {
        findMany: vi.fn(async ({ where }: { where: { status?: string } }) =>
          where.status === 'COMPLETED' ? [] : [frame]
        ),
        count: vi.fn().mockResolvedValue(1)
      }
    }
    const transaction = {
      mediaVideoKeyframe: { updateMany: vi.fn(), update: frameUpdate },
      mediaVideoKeyframeSet: { update: vi.fn() }
    }
    extractVideoFrame.mockRejectedValue(new Error('ffmpeg failed'))

    await expect(
      generateVideoKeyframes({
        jobId: 'job-1',
        payload,
        database: database as never,
        mutate: (operation) => operation(transaction as never),
        config: { scanRoot: '/scan', keyframeStorageRoot: '/keyframes', ffmpegThreads: 2 },
        signal: new AbortController().signal,
        progress: vi.fn().mockResolvedValue(undefined)
      })
    ).rejects.toMatchObject({ code: 'EXTERNAL_PROCESS_FAILED', message: 'All video keyframe candidates failed' })
    expect(frameUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
    )
  })
})
