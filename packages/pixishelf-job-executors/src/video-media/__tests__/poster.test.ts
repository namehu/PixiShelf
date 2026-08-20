import type {
  EnqueuedChildJob,
  ExecutionContext,
  FencedExecutionTransaction,
  QueueSqlExecutor
} from '@pixishelf/job-runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoPosterPayload } from '../executors.js'
import type { VideoMediaTransaction } from '../types.js'

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  resolveSource: vi.fn(),
  resolveOutput: vi.fn(),
  inspect: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn()
}))

vi.mock('../media-process.js', () => ({ generateVideoPoster: mocks.generate }))
vi.mock('../paths.js', () => ({
  resolveVideoSource: mocks.resolveSource,
  resolvePosterOutput: mocks.resolveOutput,
  inspectGcCandidate: mocks.inspect
}))
vi.mock('node:fs/promises', () => ({ rename: mocks.rename, rm: mocks.rm }))

import { executeVideoPoster, generatePendingVideoPoster } from '../poster.js'

describe('video poster executor publication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveSource.mockResolvedValue({
      sourcePath: '/scan/videos/1.mp4',
      stat: { size: 100, mtimeMs: 200 }
    })
    mocks.resolveOutput.mockImplementation((_root: string, relativePath: string) => `/posters/${relativePath}`)
    mocks.generate.mockResolvedValue(undefined)
    mocks.inspect.mockResolvedValue({ outputPath: '/posters/old.webp', exists: false })
    mocks.rename.mockResolvedValue(undefined)
    mocks.rm.mockResolvedValue(undefined)
  })

  it('publishes one image and defers the replaced path by at least one hour', async () => {
    const fixture = posterFixture()
    const outcome = await executeVideoPoster(fixture.context, fixture.dependencies)

    expect(outcome).toEqual({ kind: 'transactionally-finalized' })
    expect(fixture.gcUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          relativePath: 'old.webp',
          reason: 'POSTER_REPLACED',
          notBefore: new Date('2026-08-14T01:00:00.000Z')
        })
      })
    )
    expect(fixture.complete).toHaveBeenCalledOnce()
  })

  it('reuses the same publication path inside a parent probe without finalizing that parent', async () => {
    const fixture = posterFixture()

    const outcome = await generatePendingVideoPoster(fixture.context, fixture.dependencies, fixture.context.payload)

    expect(outcome).toMatchObject({ kind: 'generated', imageId: 1 })
    expect(fixture.finalize).not.toHaveBeenCalled()
    expect(fixture.complete).not.toHaveBeenCalled()
    expect(mocks.generate).toHaveBeenCalledOnce()
    expect(mocks.rename).toHaveBeenCalledOnce()
  })

  it('resets an inline poster checkpoint when the parent probe is cancelled before publication', async () => {
    const fixture = posterFixture()
    mocks.generate.mockImplementation(async () => {
      fixture.controller.abort(new Error('cancelled'))
    })

    await expect(
      generatePendingVideoPoster(fixture.context, fixture.dependencies, fixture.context.payload)
    ).rejects.toThrow('cancelled')

    expect(mocks.rename).not.toHaveBeenCalled()
    expect(fixture.metadataUpdateMany).toHaveBeenCalledWith({
      where: { imageId: 1, posterStatus: 'GENERATING' },
      data: { posterStatus: 'PENDING', posterError: null }
    })
    expect(fixture.finalize).not.toHaveBeenCalled()
  })

  it('pre-registers an attempt-owned output so a commit rollback leaves ordinary GC work', async () => {
    const fixture = posterFixture()
    fixture.finalize.mockImplementation(async (operation) => {
      await operation(fixture.scope)
      throw new Error('commit failed')
    })

    await expect(executeVideoPoster(fixture.context, fixture.dependencies)).rejects.toThrow('commit failed')
    const attemptRegistration = fixture.gcUpsert.mock.calls.find(
      ([input]) => input.create?.reason === 'POSTER_ATTEMPT_OUTPUT'
    )
    const temporaryRegistration = fixture.gcUpsert.mock.calls.find(
      ([input]) => input.create?.reason === 'POSTER_ATTEMPT_TEMPORARY'
    )
    expect(attemptRegistration).toBeDefined()
    expect(temporaryRegistration).toBeDefined()
    expect(mocks.rename).toHaveBeenCalledOnce()
    expect(fixture.finalize).toHaveBeenCalledOnce()
  })

  it('regenerates a COMPLETED row when its referenced file is missing', async () => {
    const fixture = posterFixture('RUNNING', 'COMPLETED')

    await expect(executeVideoPoster(fixture.context, fixture.dependencies)).resolves.toEqual({
      kind: 'transactionally-finalized'
    })
    expect(mocks.inspect).toHaveBeenCalledWith('/posters', 'old.webp')
    expect(mocks.generate).toHaveBeenCalledOnce()
    expect(fixture.metadataUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          imageId: 1,
          OR: expect.arrayContaining([{ posterStatus: 'COMPLETED', posterPath: 'old.webp' }])
        })
      })
    )
  })

  it('atomically marks GENERATING failed when cancellation wins during ffmpeg', async () => {
    const fixture = posterFixture('CANCELLING')
    mocks.generate.mockImplementation(async () => {
      fixture.controller.abort(new Error('cancelled'))
      throw new Error('cancelled')
    })

    await expect(executeVideoPoster(fixture.context, fixture.dependencies)).resolves.toEqual({
      kind: 'transactionally-finalized'
    })
    expect(fixture.metadataUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { imageId: 1, posterStatus: 'GENERATING' },
        data: expect.objectContaining({
          posterStatus: 'FAILED',
          posterUpdatedAt: expect.any(Date),
          posterError: '视频封面生成已取消'
        })
      })
    )
    expect(fixture.cancel).toHaveBeenCalledWith('视频封面生成已取消')
  })
})

function posterFixture(
  executionStatus: 'RUNNING' | 'PAUSING' | 'CANCELLING' = 'RUNNING',
  initialPosterStatus: 'PENDING' | 'COMPLETED' = 'PENDING'
) {
  const controller = new AbortController()
  const metadataUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
  const gcUpsert = vi.fn().mockResolvedValue({})
  const transaction = {
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    mediaVideoMetadata: {
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: metadataUpdateMany,
      findUnique: vi.fn().mockResolvedValue({
        posterStatus: 'GENERATING',
        posterPath: 'old.webp',
        manualPosterTimestamp: null
      })
    },
    derivedMediaGcEntry: {
      upsert: gcUpsert,
      deleteMany: vi.fn().mockResolvedValue({ count: 1 })
    }
  }
  const complete = vi.fn().mockResolvedValue(undefined)
  const cancel = vi.fn().mockResolvedValue(undefined)
  const scope = {
    transaction,
    executionStatus,
    controlStatus:
      executionStatus === 'RUNNING'
        ? 'CONTINUE'
        : executionStatus === 'PAUSING'
          ? 'PAUSE_REQUESTED'
          : 'CANCEL_REQUESTED',
    complete,
    fail: vi.fn(),
    retry: vi.fn(),
    skip: vi.fn(),
    cancel,
    pause: vi.fn(),
    release: vi.fn()
  } as unknown as FencedExecutionTransaction<VideoMediaTransaction & QueueSqlExecutor>
  const finalize = vi.fn(async (operation: (value: typeof scope) => Promise<void>) => {
    await operation(scope)
    return { kind: 'transactionally-finalized' as const }
  })
  const context = {
    job: {
      id: 'poster-job',
      executionToken: '00000000-0000-4000-8000-000000000001',
      attempt: 1,
      maxAttempts: 3
    },
    payload: { imageId: 1, relativePath: 'videos/1.mp4' },
    signal: controller.signal,
    progress: vi.fn().mockResolvedValue(undefined),
    enqueueChild: vi.fn(),
    mutateInTransaction: vi.fn((operation) => operation(transaction)),
    finalizeInTransaction: finalize,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  } as unknown as ExecutionContext<VideoPosterPayload, EnqueuedChildJob>
  return {
    controller,
    context,
    scope,
    finalize,
    complete,
    cancel,
    metadataUpdateMany,
    gcUpsert,
    dependencies: {
      database: {
        image: {
          findUnique: vi.fn().mockResolvedValue({
            id: 1,
            path: '/videos/1.mp4',
            mediaType: 'VIDEO',
            videoMetadata: { posterStatus: initialPosterStatus, posterPath: 'old.webp', manualPosterTimestamp: null }
          })
        }
      },
      config: { scanRoot: '/scan', posterStorageRoot: '/posters', chapterPreviewStorageRoot: '/chapters' },
      now: () => new Date('2026-08-14T00:00:00.000Z')
    } as never
  }
}
