import type { ExecutionContext } from '@pixishelf/job-runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ processProbe: vi.fn(), resolveSource: vi.fn(), inspect: vi.fn() }))
vi.mock('../media-process.js', () => ({ probeVideoMetadata: mocks.processProbe }))
vi.mock('../paths.js', () => ({ resolveVideoSource: mocks.resolveSource, inspectGcCandidate: mocks.inspect }))

import type { VideoMediaProbePayload } from '../executors.js'
import { executeVideoMediaProbe } from '../probe.js'

const UPDATED_AT = new Date('2026-08-14T01:02:03.000Z')

describe('video media probe executor policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveSource.mockResolvedValue({ sourcePath: '/scan/videos/1.mp4', stat: { size: 1, mtimeMs: 1 } })
    mocks.processProbe.mockResolvedValue({
      hasAudio: false,
      audioCodec: null,
      audioChannels: null,
      videoCodec: 'h264',
      duration: 10,
      fps: 30
    })
    mocks.inspect.mockResolvedValue({ outputPath: '/posters/1.webp', exists: true })
  })

  it('excludes FAILED probes and materializes only one bounded oldest-first poster page', async () => {
    const fixture = probeFixture({ probeRows: [probeRow()], posterRows: [posterRow()] })
    const context = fixture.context({ force: false, enqueueMissingPosters: true })
    const outcome = await executeVideoMediaProbe(context, fixture.dependencies)

    expect(fixture.metadataFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ probeStatus: { in: ['PENDING', 'PROBING'] } }) })
    )
    expect(fixture.posterQueries()).toEqual([
      expect.objectContaining({
        take: 100,
        orderBy: [{ posterBacklogCheckedAt: { sort: 'asc', nulls: 'first' } }, { imageId: 'asc' }]
      })
    ])
    expect(context.enqueueChild).toHaveBeenCalledWith({
      type: 'VIDEO_POSTER_GENERATION',
      payload: { imageId: 1, relativePath: 'videos/1.mp4' },
      idempotencyKey: expect.stringMatching(/^video-poster:1:[a-f0-9]{64}$/)
    })
    expect(outcome).toMatchObject({
      kind: 'completed',
      result: { processed: 1, failed: 0, posterChildrenEnqueued: 1, posterBacklogScanned: 1 }
    })
  })

  it('retries the parent when a force run cannot durably enqueue its poster backlog', async () => {
    const fixture = probeFixture({ probeRows: [probeRow()], posterRows: [posterRow()] })
    const context = fixture.context({ force: true, enqueueMissingPosters: true })
    vi.mocked(context.enqueueChild).mockRejectedValue(new Error('queue unavailable'))
    const outcome = await executeVideoMediaProbe(context, fixture.dependencies)

    expect(fixture.metadataFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ probeStatus: { in: ['PENDING', 'PROBING', 'FAILED'] } })
      })
    )
    expect(outcome).toMatchObject({
      kind: 'retry',
      errorCode: 'INTERNAL_ERROR',
      error: 'Failed to durably enqueue 1 video poster jobs'
    })
  })

  it('keeps poster child idempotency stable for parent retries and isolates different parents', async () => {
    const longStatePath = `${'nested/'.repeat(40)}poster.webp`
    const firstFixture = probeFixture({
      probeRows: [],
      posterRows: [posterRow({ posterPath: longStatePath })]
    })
    const retryFixture = probeFixture({
      probeRows: [],
      posterRows: [posterRow({ posterPath: longStatePath })]
    })
    const otherParentFixture = probeFixture({
      probeRows: [],
      posterRows: [posterRow({ posterPath: longStatePath })]
    })
    const firstContext = firstFixture.context({ force: false, enqueueMissingPosters: true }, 'probe-parent-a')
    const retryContext = retryFixture.context({ force: false, enqueueMissingPosters: true }, 'probe-parent-a')
    const otherParentContext = otherParentFixture.context(
      { force: false, enqueueMissingPosters: true },
      'probe-parent-b'
    )

    await executeVideoMediaProbe(firstContext, firstFixture.dependencies)
    await executeVideoMediaProbe(retryContext, retryFixture.dependencies)
    await executeVideoMediaProbe(otherParentContext, otherParentFixture.dependencies)

    const firstKey = vi.mocked(firstContext.enqueueChild).mock.calls[0]?.[0].idempotencyKey
    const retryKey = vi.mocked(retryContext.enqueueChild).mock.calls[0]?.[0].idempotencyKey
    const otherParentKey = vi.mocked(otherParentContext.enqueueChild).mock.calls[0]?.[0].idempotencyKey
    expect(firstKey).toBe(retryKey)
    expect(firstKey).not.toBe(otherParentKey)
    expect(firstKey?.length).toBeLessThanOrEqual(180)
  })

  it('repairs a completed poster row whose file is absent without scanning beyond the bounded page', async () => {
    const fixture = probeFixture({
      probeRows: [],
      posterRows: [posterRow({ posterStatus: 'COMPLETED', posterPath: null })]
    })
    const context = fixture.context({ force: false, enqueueMissingPosters: true })
    const outcome = await executeVideoMediaProbe(context, fixture.dependencies)

    expect(context.enqueueChild).toHaveBeenCalledTimes(1)
    expect(mocks.inspect).not.toHaveBeenCalled()
    expect(fixture.posterQueries()).toHaveLength(1)
    expect(outcome).toMatchObject({
      kind: 'completed',
      result: { processed: 0, posterFilesMissing: 1, posterChildrenEnqueued: 1 }
    })
  })

  it('does not regenerate a completed poster whose file still exists', async () => {
    const fixture = probeFixture({
      probeRows: [],
      posterRows: [posterRow({ posterStatus: 'COMPLETED', posterPath: '1.webp' })]
    })
    const context = fixture.context({ force: false, enqueueMissingPosters: true })
    const outcome = await executeVideoMediaProbe(context, fixture.dependencies)

    expect(mocks.inspect).toHaveBeenCalledTimes(1)
    expect(context.enqueueChild).not.toHaveBeenCalled()
    expect(fixture.metadataUpdateMany).toHaveBeenCalledWith({
      where: { imageId: { in: [1] } },
      data: { posterBacklogCheckedAt: expect.any(Date) }
    })
    expect(outcome).toMatchObject({ kind: 'completed', result: { posterFilesMissing: 0 } })
  })

  it('checkpoints a healthy first page so a missing poster after item 100 is reached on the next run', async () => {
    const healthy = Array.from({ length: 100 }, (_, index) =>
      posterRow({
        imageId: index + 1,
        posterStatus: 'COMPLETED',
        posterPath: `${index + 1}.webp`,
        image: { path: `/videos/${index + 1}.mp4` }
      })
    )
    const fixture = probeFixture({
      probeRows: [],
      posterRows: [],
      posterPages: [
        healthy,
        [
          posterRow({
            imageId: 101,
            posterStatus: 'COMPLETED',
            posterPath: null,
            image: { path: '/videos/101.mp4' }
          })
        ]
      ]
    })

    const first = await executeVideoMediaProbe(
      fixture.context({ force: false, enqueueMissingPosters: true }),
      fixture.dependencies
    )
    const secondContext = fixture.context({ force: false, enqueueMissingPosters: true })
    const second = await executeVideoMediaProbe(secondContext, fixture.dependencies)

    expect(first).toMatchObject({ kind: 'completed', result: { posterBacklogScanned: 100, posterFilesMissing: 0 } })
    expect(fixture.metadataUpdateMany).toHaveBeenCalledWith({
      where: { imageId: { in: Array.from({ length: 100 }, (_, index) => index + 1) } },
      data: { posterBacklogCheckedAt: expect.any(Date) }
    })
    expect(secondContext.enqueueChild).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { imageId: 101, relativePath: 'videos/101.mp4' } })
    )
    expect(second).toMatchObject({
      kind: 'completed',
      result: { posterBacklogScanned: 1, posterFilesMissing: 1, posterChildrenEnqueued: 1 }
    })
    expect(fixture.posterQueries()).toHaveLength(2)
  })

  it('advances a 100-row poison page, reaches item 101 next run, and later retries the poison rows', async () => {
    const poison = Array.from({ length: 100 }, (_, index) =>
      posterRow({ imageId: index + 1, image: { path: `/videos/${index + 1}.mp4` } })
    )
    const fixture = probeFixture({
      probeRows: [],
      posterRows: [],
      posterPages: [poison, [posterRow({ imageId: 101, image: { path: '/videos/101.mp4' } })], poison]
    })
    const firstContext = fixture.context({ force: false, enqueueMissingPosters: true })
    vi.mocked(firstContext.enqueueChild).mockRejectedValue(new Error('queue unavailable'))

    const first = await executeVideoMediaProbe(firstContext, fixture.dependencies)
    const secondContext = fixture.context({ force: false, enqueueMissingPosters: true })
    const second = await executeVideoMediaProbe(secondContext, fixture.dependencies)
    const thirdContext = fixture.context({ force: false, enqueueMissingPosters: true })
    vi.mocked(thirdContext.enqueueChild).mockRejectedValue(new Error('queue still unavailable'))
    const third = await executeVideoMediaProbe(thirdContext, fixture.dependencies)

    expect(first).toMatchObject({ kind: 'retry', error: 'Failed to durably enqueue 100 video poster jobs' })
    expect(fixture.metadataUpdateMany).toHaveBeenCalledWith({
      where: { imageId: { in: Array.from({ length: 100 }, (_, index) => index + 1) } },
      data: { posterBacklogCheckedAt: expect.any(Date) }
    })
    expect(secondContext.enqueueChild).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { imageId: 101, relativePath: 'videos/101.mp4' } })
    )
    expect(second).toMatchObject({ kind: 'completed', result: { posterBacklogScanned: 1 } })
    expect(thirdContext.enqueueChild).toHaveBeenCalledTimes(100)
    expect(third).toMatchObject({ kind: 'retry', error: 'Failed to durably enqueue 100 video poster jobs' })
  })

  it('durably scopes a forced single-image reprobe and its poster follow-up', async () => {
    const fixture = probeFixture({
      image: { id: 7, path: '/videos/7.mp4', mediaType: 'VIDEO' },
      probeRows: [probeRow({ imageId: 7, image: { path: '/videos/7.mp4' } })],
      posterRows: [posterRow({ imageId: 7, image: { path: '/videos/7.mp4' } })]
    })
    const context = fixture.context({ force: true, enqueueMissingPosters: true, imageId: 7 })
    const outcome = await executeVideoMediaProbe(context, fixture.dependencies)

    expect(fixture.imageFindMany).not.toHaveBeenCalled()
    expect(fixture.metadataUpsert).toHaveBeenCalledWith({
      where: { imageId: 7 },
      create: { imageId: 7, probeStatus: 'PENDING', posterStatus: 'PENDING' },
      update: { probeStatus: 'PENDING', probeError: null }
    })
    expect(fixture.posterQueries()[0]).toMatchObject({ where: { imageId: 7 }, take: 1 })
    expect(context.enqueueChild).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { imageId: 7, relativePath: 'videos/7.mp4' } })
    )
    expect(outcome).toMatchObject({ kind: 'completed', result: { processed: 1 } })
  })

  it('retries a failed targeted probe but does not retry a permanently missing target', async () => {
    const failing = probeFixture({
      image: { id: 7, path: '/videos/7.mp4', mediaType: 'VIDEO' },
      probeRows: [probeRow({ imageId: 7, image: { path: '/videos/7.mp4' } })],
      posterRows: []
    })
    mocks.processProbe.mockRejectedValueOnce(new Error('ffprobe failed'))

    await expect(
      executeVideoMediaProbe(
        failing.context({ force: true, enqueueMissingPosters: true, imageId: 7 }),
        failing.dependencies
      )
    ).resolves.toMatchObject({ kind: 'retry', error: 'ffprobe failed' })

    const missing = probeFixture({ probeRows: [], posterRows: [] })
    await expect(
      executeVideoMediaProbe(
        missing.context({ force: true, enqueueMissingPosters: true, imageId: 999 }),
        missing.dependencies
      )
    ).resolves.toEqual({ kind: 'skipped', reason: 'PRECONDITION_NOT_MET', message: 'Video image was not found' })
  })
})

function probeRow(overrides: Record<string, unknown> = {}) {
  return {
    imageId: 1,
    posterStatus: 'PENDING',
    posterPath: null,
    image: { path: '/videos/1.mp4' },
    ...overrides
  }
}

function posterRow(overrides: Record<string, unknown> = {}) {
  return {
    imageId: 1,
    posterStatus: 'PENDING',
    posterPath: null,
    posterUpdatedAt: UPDATED_AT,
    image: { path: '/videos/1.mp4' },
    ...overrides
  }
}

function probeFixture(options: {
  image?: { id: number; path: string; mediaType: string }
  probeRows: unknown[]
  posterRows: unknown[]
  posterPages?: unknown[][]
}) {
  const imageFindMany = vi.fn().mockResolvedValue([])
  const imageFindUnique = vi.fn().mockResolvedValue(options.image ?? null)
  const metadataCount = vi.fn().mockResolvedValue(0)
  let probePageRead = false
  const posterPages = [...(options.posterPages ?? [options.posterRows])]
  const metadataFindMany = vi.fn().mockImplementation((query) => {
    if (query.where.posterStatus !== undefined) return posterPages.shift() ?? []
    if (probePageRead) return []
    probePageRead = true
    return options.probeRows
  })
  const metadataUpsert = vi.fn().mockResolvedValue(undefined)
  const metadataUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
  const transaction = {
    image: { updateMany: vi.fn() },
    mediaVideoMetadata: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: metadataUpdateMany,
      upsert: metadataUpsert
    }
  }
  const dependencies = {
    database: {
      image: { findMany: imageFindMany, findUnique: imageFindUnique },
      mediaVideoMetadata: { count: metadataCount, findMany: metadataFindMany },
      derivedMediaGcEntry: {}
    },
    config: { scanRoot: '/scan', posterStorageRoot: '/posters', chapterPreviewStorageRoot: '/chapters' }
  } as never
  return {
    dependencies,
    imageFindMany,
    metadataFindMany,
    metadataUpdateMany,
    metadataUpsert,
    posterQueries: () =>
      metadataFindMany.mock.calls
        .map(([query]) => query)
        .filter((query) => query.where?.posterStatus !== undefined),
    context(payload: VideoMediaProbePayload, jobId = 'probe-job') {
      return {
        job: {
          id: jobId,
          executionToken: '00000000-0000-4000-8000-000000000001',
          attempt: 1,
          maxAttempts: 3
        },
        payload,
        signal: new AbortController().signal,
        progress: vi.fn().mockResolvedValue(undefined),
        enqueueChild: vi.fn().mockResolvedValue({ id: 'poster-job', created: true }),
        mutateInTransaction: vi.fn((operation) => operation(transaction)),
        finalizeInTransaction: vi.fn(),
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      } as unknown as ExecutionContext<VideoMediaProbePayload, { id: string; created: boolean }>
    }
  }
}
