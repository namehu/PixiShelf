import type { ExecutionContext } from '@pixishelf/job-runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  processProbe: vi.fn(),
  resolveSource: vi.fn(),
  generatePoster: vi.fn()
}))

vi.mock('../media-process.js', () => ({ probeVideoMetadata: mocks.processProbe }))
vi.mock('../paths.js', () => ({ resolveVideoSource: mocks.resolveSource }))
vi.mock('../poster.js', () => ({ generatePendingVideoPoster: mocks.generatePoster }))

import type { VideoMediaProbePayload } from '../executors.js'
import { executeVideoMediaProbe } from '../probe.js'
import { VideoChapterAudioProbeError } from '../types.js'

describe('video media probe workflow', () => {
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
    mocks.generatePoster.mockImplementation(async (_context, _dependencies, payload) => ({
      kind: 'generated',
      imageId: payload.imageId,
      posterPath: `${payload.imageId}.webp`
    }))
  })

  it('probes videos and drains more than 100 pending posters in the same job', async () => {
    const posters = Array.from({ length: 105 }, (_, index) => posterRow(index + 1))
    const fixture = probeFixture({
      probeRows: [probeRow()],
      posterPages: chunk(posters, 20),
      posterTotal: posters.length
    })
    const context = fixture.context({ mode: 'INCREMENTAL', force: false })

    const outcome = await executeVideoMediaProbe(context, fixture.dependencies)

    expect(mocks.generatePoster).toHaveBeenCalledTimes(105)
    expect(context.enqueueChild).not.toHaveBeenCalled()
    expect(fixture.posterQueries()).toHaveLength(7)
    expect(fixture.posterQueries()[0]).toMatchObject({
      where: {
        probeStatus: 'COMPLETED',
        manualPosterTimestamp: null,
        posterStatus: { in: ['PENDING', 'FAILED', 'GENERATING'] }
      },
      orderBy: { imageId: 'asc' },
      take: 20
    })
    expect(outcome).toMatchObject({
      kind: 'completed',
      result: {
        probe: { total: 1, processed: 1, failed: 0, remaining: 0 },
        poster: { total: 105, processed: 105, generated: 105, failed: 0, remaining: 0 }
      }
    })
  })

  it('never mixes completed-poster integrity checks into the pending poster workflow', async () => {
    const fixture = probeFixture({ probeRows: [], posterPages: [], posterTotal: 0 })

    await executeVideoMediaProbe(fixture.context({ mode: 'INCREMENTAL', force: false }), fixture.dependencies)

    expect(fixture.posterQueries()).toHaveLength(1)
    const query = fixture.posterQueries()[0]
    expect(query.where.posterStatus.in).not.toContain('COMPLETED')
    expect(query.orderBy).toEqual({ imageId: 'asc' })
    expect(JSON.stringify(query)).not.toContain('posterBacklogCheckedAt')
  })

  it('records one poster failure and continues with later videos', async () => {
    const fixture = probeFixture({
      probeRows: [],
      posterPages: [[posterRow(1), posterRow(2), posterRow(3)]],
      posterTotal: 3
    })
    mocks.generatePoster.mockImplementation(async (_context, _dependencies, payload) =>
      payload.imageId === 2
        ? { kind: 'failed', imageId: 2, errorCode: 'EXTERNAL_PROCESS_FAILED', message: 'ffmpeg failed' }
        : { kind: 'generated', imageId: payload.imageId, posterPath: `${payload.imageId}.webp` }
    )

    const outcome = await executeVideoMediaProbe(
      fixture.context({ mode: 'INCREMENTAL', force: false }),
      fixture.dependencies
    )

    expect(mocks.generatePoster).toHaveBeenCalledTimes(3)
    expect(outcome).toMatchObject({
      kind: 'completed',
      result: {
        poster: { total: 3, processed: 3, generated: 2, failed: 1, remaining: 0 },
        failedSamples: [{ stage: 'POSTER', imageId: 2, error: 'ffmpeg failed' }]
      }
    })
  })

  it('scopes a forced single-image reprobe and poster generation to the same image', async () => {
    const fixture = probeFixture({
      image: { id: 7, path: '/videos/7.mp4', mediaType: 'VIDEO' },
      probeRows: [probeRow(7)],
      posterPages: [[posterRow(7)]],
      posterTotal: 1
    })
    const context = fixture.context({ mode: 'INCREMENTAL', force: true, imageId: 7 })

    const outcome = await executeVideoMediaProbe(context, fixture.dependencies)

    expect(fixture.imageFindMany).not.toHaveBeenCalled()
    expect(fixture.metadataUpsert).toHaveBeenCalledWith({
      where: { imageId: 7 },
      create: { imageId: 7, probeStatus: 'PENDING', posterStatus: 'PENDING' },
      update: { probeStatus: 'PENDING', probeError: null }
    })
    expect(fixture.posterQueries()[0]).toMatchObject({ where: { imageId: 7 }, take: 1 })
    expect(mocks.generatePoster).toHaveBeenCalledWith(context, fixture.dependencies, {
      imageId: 7,
      relativePath: 'videos/7.mp4'
    })
    expect(outcome).toMatchObject({
      kind: 'completed',
      result: { probe: { processed: 1 }, poster: { generated: 1 } }
    })
  })

  it('retries a failed targeted probe but skips a permanently missing target', async () => {
    const failing = probeFixture({
      image: { id: 7, path: '/videos/7.mp4', mediaType: 'VIDEO' },
      probeRows: [probeRow(7)],
      posterPages: [],
      posterTotal: 0
    })
    mocks.processProbe.mockRejectedValueOnce(new Error('ffprobe failed'))

    await expect(
      executeVideoMediaProbe(failing.context({ mode: 'INCREMENTAL', force: true, imageId: 7 }), failing.dependencies)
    ).resolves.toMatchObject({ kind: 'retry', error: 'ffprobe failed' })
    expect(mocks.generatePoster).not.toHaveBeenCalled()

    const missing = probeFixture({ probeRows: [], posterPages: [], posterTotal: 0 })
    await expect(
      executeVideoMediaProbe(missing.context({ mode: 'INCREMENTAL', force: true, imageId: 999 }), missing.dependencies)
    ).resolves.toEqual({ kind: 'skipped', reason: 'PRECONDITION_NOT_MET', message: 'Video image was not found' })
  })

  it('rechecks only existing hasAudio=true rows and skips poster processing', async () => {
    const fixture = probeFixture({ probeRows: [probeRow(8)], posterPages: [], posterTotal: 0 })
    const context = fixture.context({ mode: 'RECHECK_HAS_AUDIO', force: true })

    const outcome = await executeVideoMediaProbe(context, fixture.dependencies)

    const probeQuery = fixture.metadataFindMany.mock.calls.find(([query]) => !query.where.posterStatus)?.[0]
    expect(probeQuery.where).toMatchObject({
      hasAudio: true,
      OR: [
        { probeStatus: { in: ['PENDING', 'PROBING', 'FAILED'] } },
        {
          probeStatus: 'COMPLETED',
          OR: [{ probeUpdatedAt: null }, { probeUpdatedAt: { lt: new Date('2026-08-30T00:00:00.000Z') } }]
        }
      ]
    })
    expect(fixture.posterQueries()).toHaveLength(0)
    expect(mocks.generatePoster).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({
      kind: 'completed',
      result: { mode: 'RECHECK_HAS_AUDIO', probe: { processed: 1 }, poster: { processed: 0 } }
    })
  })

  it('persists a current-hash chapter audio failure without changing preview status', async () => {
    const fixture = probeFixture({ probeRows: [probeRow(9)], posterPages: [], posterTotal: 0 })
    mocks.processProbe.mockRejectedValueOnce(
      new VideoChapterAudioProbeError('decoder failed', {
        chaptersHash: 'current-hash',
        chapters: [
          { chapterOrder: 0, chapterIndex: 1, chapterStart: 0 },
          { chapterOrder: 1, chapterIndex: 2, chapterStart: 5 }
        ]
      })
    )

    const outcome = await executeVideoMediaProbe(
      fixture.context({ mode: 'INCREMENTAL', force: false }),
      fixture.dependencies
    )

    expect(fixture.chapterPreviewUpsert).toHaveBeenCalledTimes(2)
    expect(fixture.chapterPreviewUpsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'PENDING',
          hasAudibleAudio: null,
          audioChaptersHash: 'current-hash',
          audioProbeError: 'decoder failed'
        }),
        update: {
          hasAudibleAudio: null,
          audioChaptersHash: 'current-hash',
          audioProbeError: 'decoder failed'
        }
      })
    )
    expect(outcome).toMatchObject({
      kind: 'completed',
      result: { probe: { processed: 0, failed: 1 }, poster: { processed: 0 } }
    })
  })
})

function probeRow(imageId = 1) {
  return { imageId, image: { path: `/videos/${imageId}.mp4` } }
}

function posterRow(imageId: number) {
  return { imageId, image: { path: `/videos/${imageId}.mp4` } }
}

function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = []
  for (let index = 0; index < items.length; index += size) pages.push(items.slice(index, index + size))
  return pages
}

function probeFixture(options: {
  image?: { id: number; path: string; mediaType: string }
  probeRows: unknown[]
  posterPages: unknown[][]
  posterTotal: number
}) {
  const imageFindMany = vi.fn().mockResolvedValue([])
  const imageFindUnique = vi.fn().mockResolvedValue(options.image ?? null)
  let probeCountCalls = 0
  const metadataCount = vi.fn().mockImplementation((query) => {
    if (query.where.posterStatus) {
      return query.where.posterStatus.in.includes('FAILED') ? options.posterTotal : 0
    }
    probeCountCalls += 1
    return probeCountCalls === 1 ? options.probeRows.length : 0
  })
  let probePageRead = false
  const posterPages = [...options.posterPages]
  const metadataFindMany = vi.fn().mockImplementation((query) => {
    if (query.where.posterStatus !== undefined) return posterPages.shift() ?? []
    if (probePageRead) return []
    probePageRead = true
    return options.probeRows
  })
  const metadataUpsert = vi.fn().mockResolvedValue(undefined)
  const metadataUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
  const chapterPreviewUpsert = vi.fn().mockResolvedValue(undefined)
  const transaction = {
    image: { updateMany: vi.fn() },
    mediaVideoMetadata: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: metadataUpdateMany,
      upsert: metadataUpsert
    },
    mediaChapterPreview: { upsert: chapterPreviewUpsert }
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
    metadataUpsert,
    metadataFindMany,
    chapterPreviewUpsert,
    posterQueries: () =>
      metadataFindMany.mock.calls.map(([query]) => query).filter((query) => query.where?.posterStatus),
    context(payload: VideoMediaProbePayload) {
      return {
        job: {
          id: 'probe-job',
          executionToken: '00000000-0000-4000-8000-000000000001',
          attempt: 1,
          maxAttempts: 3,
          createdAt: new Date('2026-08-30T00:00:00.000Z')
        },
        payload,
        signal: new AbortController().signal,
        progress: vi.fn().mockResolvedValue(undefined),
        enqueueChild: vi.fn(),
        mutateInTransaction: vi.fn((operation) => operation(transaction)),
        finalizeInTransaction: vi.fn(),
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      } as unknown as ExecutionContext<VideoMediaProbePayload, { id: string; created: boolean }>
    }
  }
}
