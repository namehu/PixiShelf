import { beforeEach, describe, expect, it, vi } from 'vitest'

const { resolveSourceFile, resolveKeyframePath, stat } = vi.hoisted(() => ({
  resolveSourceFile: vi.fn(),
  resolveKeyframePath: vi.fn(),
  stat: vi.fn()
}))

vi.mock('../paths.js', () => ({ resolveSourceFile, resolveKeyframePath }))
vi.mock('node:fs/promises', () => ({ stat }))

import { discoverVideoKeyframes } from '../discovery.js'

const payload = {
  trigger: 'manual' as const,
  force: false,
  previewOnly: false,
  imageIds: [1, 2],
  filter: {
    minDuration: null,
    maxDuration: null,
    includePaths: [],
    excludePaths: [],
    statuses: ['MISSING', 'STALE', 'FAILED'] as Array<'MISSING' | 'STALE' | 'FAILED'>
  }
}

describe('video keyframe discovery domain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveSourceFile.mockResolvedValue({ stat: { size: 100, mtimeMs: 200 } })
    resolveKeyframePath.mockImplementation((_root: string, path: string) => `/keyframes/${path}`)
    stat.mockResolvedValue({ isFile: () => true })
  })

  it('uses stable parent-and-image child keys so a repeated attempt reuses children', async () => {
    const images = [
      { id: 1, path: 'videos/1.mp4', videoMetadata: { duration: 30 }, keyframeSets: [] },
      { id: 2, path: 'videos/2.mp4', videoMetadata: { duration: 40 }, keyframeSets: [] }
    ]
    const database = {
      image: { findMany: vi.fn().mockResolvedValue(images) },
      systemJob: { groupBy: vi.fn().mockResolvedValue([]) }
    }
    const keys = new Set<string>()
    const requests: Array<{ idempotencyKey: string; payload: unknown }> = []
    const enqueueChild = vi.fn(async (request: { idempotencyKey: string; payload: unknown }) => {
      requests.push(request)
      const created = !keys.has(request.idempotencyKey)
      keys.add(request.idempotencyKey)
      return { id: request.idempotencyKey, created }
    })
    const run = () =>
      discoverVideoKeyframes({
        jobId: 'discovery-1',
        payload,
        database: database as never,
        config: { scanRoot: '/scan', keyframeStorageRoot: '/keyframes', ffmpegThreads: 2 },
        signal: new AbortController().signal,
        progress: vi.fn().mockResolvedValue(undefined),
        enqueueChild
      })

    const first = await run()
    expect(first).toMatchObject({ matched: 2, enqueued: 2, reused: 0 })
    expect(first).not.toHaveProperty('previewOnly')
    await expect(run()).resolves.toMatchObject({ matched: 2, enqueued: 0, reused: 2 })
    expect(requests.map((request) => request.idempotencyKey)).toEqual([
      'keyframe:discovery-1:image:1:v1',
      'keyframe:discovery-1:image:2:v1',
      'keyframe:discovery-1:image:1:v1',
      'keyframe:discovery-1:image:2:v1'
    ])
    expect(requests[0]?.payload).toEqual({
      imageId: 1,
      relativePath: 'videos/1.mp4',
      mode: 'MANUAL_INCREMENTAL'
    })
    expect(database.systemJob.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['targetImageId'],
        where: expect.objectContaining({ targetImageId: { in: [1, 2] } })
      })
    )
  })

  it('returns bounded, fully described preview candidates without enqueueing children', async () => {
    const previewFilter = {
      minDuration: null,
      maxDuration: null,
      includePaths: ['videos'],
      excludePaths: [],
      statuses: ['MISSING', 'STALE', 'FAILED'] as Array<'MISSING' | 'STALE' | 'FAILED'>
    }
    const images = [
      { id: 1, path: 'videos/missing.mp4', videoMetadata: { duration: 30 }, keyframeSets: [] },
      {
        id: 2,
        path: 'videos/current.mp4',
        videoMetadata: { duration: 40 },
        keyframeSets: [
          {
            sourceSize: 100n,
            sourceMtimeMs: 200n,
            publishedCount: 1,
            frames: [{ path: '2/frame.webp' }]
          }
        ]
      },
      { id: 3, path: 'videos/failed.mp4', videoMetadata: { duration: null }, keyframeSets: [] }
    ]
    const database = {
      image: { findMany: vi.fn().mockResolvedValue(images) },
      systemJob: { groupBy: vi.fn().mockResolvedValue([{ targetImageId: 3 }]) }
    }
    const enqueueChild = vi.fn()

    const result = await discoverVideoKeyframes({
      jobId: 'preview-1',
      payload: { ...payload, force: true, previewOnly: true, imageIds: [1, 2, 3], filter: previewFilter },
      database: database as never,
      config: { scanRoot: '/scan', keyframeStorageRoot: '/keyframes', ffmpegThreads: 2 },
      signal: new AbortController().signal,
      progress: vi.fn().mockResolvedValue(undefined),
      enqueueChild
    })

    expect(result).toMatchObject({
      previewOnly: true,
      previewTruncated: false,
      force: true,
      filter: previewFilter,
      matched: 3,
      candidates: [
        { imageId: 1, path: 'videos/missing.mp4', duration: 30, status: 'MISSING', publishedCount: 0 },
        { imageId: 2, path: 'videos/current.mp4', duration: 40, status: 'CURRENT', publishedCount: 1 },
        { imageId: 3, path: 'videos/failed.mp4', duration: null, status: 'FAILED', publishedCount: 0 }
      ]
    })
    expect(enqueueChild).not.toHaveBeenCalled()
  })

  it('caps persisted preview candidates at 1000 while preserving the total match count', async () => {
    const images = Array.from({ length: 1_001 }, (_, index) => ({
      id: index + 1,
      path: `videos/${index + 1}.mp4`,
      videoMetadata: { duration: 30 },
      keyframeSets: []
    }))
    const findMany = vi.fn(({ where }: { where: { id: { gt: number } } }) =>
      Promise.resolve(images.slice(where.id.gt, where.id.gt + 200))
    )
    const result = await discoverVideoKeyframes({
      jobId: 'preview-large',
      payload: { ...payload, previewOnly: true, imageIds: undefined },
      database: {
        image: { findMany },
        systemJob: { groupBy: vi.fn().mockResolvedValue([]) }
      } as never,
      config: { scanRoot: '/scan', keyframeStorageRoot: '/keyframes', ffmpegThreads: 2 },
      signal: new AbortController().signal,
      progress: vi.fn().mockResolvedValue(undefined),
      enqueueChild: vi.fn()
    })

    expect(result).toMatchObject({ previewOnly: true, previewTruncated: true, matched: 1_001 })
    expect('candidates' in result ? result.candidates : []).toHaveLength(1_000)
  })

  it('stops before database or child work when cancellation is already requested', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    const findMany = vi.fn()
    await expect(
      discoverVideoKeyframes({
        jobId: 'discovery-1',
        payload,
        database: { image: { findMany }, systemJob: { groupBy: vi.fn() } } as never,
        config: { scanRoot: '/scan', keyframeStorageRoot: '/keyframes', ffmpegThreads: 2 },
        signal: controller.signal,
        progress: vi.fn().mockResolvedValue(undefined),
        enqueueChild: vi.fn()
      })
    ).rejects.toThrow('cancelled')
    expect(findMany).not.toHaveBeenCalled()
  })

  it('propagates queue failures instead of misclassifying them as inaccessible media', async () => {
    const database = {
      image: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 1, path: 'videos/1.mp4', videoMetadata: { duration: 30 }, keyframeSets: [] }])
      },
      systemJob: { groupBy: vi.fn().mockResolvedValue([]) }
    }
    await expect(
      discoverVideoKeyframes({
        jobId: 'discovery-1',
        payload: { ...payload, imageIds: [1] },
        database: database as never,
        config: { scanRoot: '/scan', keyframeStorageRoot: '/keyframes', ffmpegThreads: 2 },
        signal: new AbortController().signal,
        progress: vi.fn().mockResolvedValue(undefined),
        enqueueChild: vi.fn().mockRejectedValue(new Error('queue unavailable'))
      })
    ).rejects.toThrow('queue unavailable')
  })
})
