import { JobExecutionFenceError, type EnqueuedChildJob, type ExecutionContext } from '@pixishelf/job-runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DerivedMediaGcPayload } from '../executors.js'

const mocks = vi.hoisted(() => ({
  files: new Set<string>(),
  inspect: vi.fn(),
  rm: vi.fn(),
  rename: vi.fn(),
  lstat: vi.fn(),
  mkdir: vi.fn(),
  opendir: vi.fn()
}))
vi.mock('../paths.js', () => ({ inspectGcCandidate: mocks.inspect }))
vi.mock('node:fs/promises', () => ({
  rm: mocks.rm,
  rename: mocks.rename,
  lstat: mocks.lstat,
  mkdir: mocks.mkdir,
  opendir: mocks.opendir
}))

import { executeDerivedMediaGc } from '../gc.js'

describe('derived media GC executor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.files.clear()
    mocks.inspect.mockImplementation((root: string, relativePath: string) => {
      const outputPath = `${root}/${relativePath}`.replaceAll('\\', '/')
      return Promise.resolve({ outputPath, exists: mocks.files.has(outputPath) })
    })
    mocks.lstat.mockImplementation((filePath: string) => {
      if (!mocks.files.has(filePath)) return Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }))
      return Promise.resolve({ isSymbolicLink: () => false, isFile: () => true })
    })
    mocks.rename.mockImplementation((source: string, target: string) => {
      if (!mocks.files.delete(source)) return Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }))
      mocks.files.add(target)
      return Promise.resolve()
    })
    mocks.rm.mockImplementation((filePath: string) => {
      mocks.files.delete(filePath)
      return Promise.resolve()
    })
    mocks.mkdir.mockResolvedValue(undefined)
  })

  it('locks and rechecks a live poster reference before touching its file', async () => {
    mocks.files.add('/posters/old.webp')
    const fixture = gcFixture({ references: [true] })
    const outcome = await executeDerivedMediaGc(fixture.context, fixture.dependencies)

    expect(outcome).toMatchObject({ kind: 'completed', result: { referenced: 1, deleted: 0 } })
    expect(fixture.queryRaw).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock($1, $2)::text', expect.any(Number), 1)
    expect(mocks.rename).not.toHaveBeenCalled()
    expect(mocks.rm).not.toHaveBeenCalled()
  })

  it('bounds explicit reconciliation and never deletes during dry-run', async () => {
    const directory = createDirectory(
      Array.from({ length: 600 }, (_, index) => ({ name: `${index + 1}-poster.webp`, isFile: () => true }))
    )
    mocks.opendir.mockResolvedValue(directory)
    const fixture = gcFixture({ entries: [], payload: { dryRun: true, reconcile: true } })
    fixture.metadataFindMany.mockResolvedValue([])

    const outcome = await executeDerivedMediaGc(fixture.context, fixture.dependencies)

    expect(outcome).toMatchObject({
      kind: 'completed',
      result: {
        dryRun: true,
        reconciliationScanned: 500,
        reconciliationCandidates: 500,
        untrackedCandidates: 500
      }
    })
    expect(directory.read).toHaveBeenCalledTimes(500)
    expect(mocks.mkdir).not.toHaveBeenCalled()
    expect(mocks.rm).not.toHaveBeenCalled()
  })

  it('caps inspected dirents even when non-candidates, symlinks, and temporary files come first', async () => {
    const ignored = Array.from({ length: 10_000 }, (_, index) => {
      if (index % 4 === 0) return { name: `${index}.webp`, isFile: () => false }
      if (index % 4 === 1) return { name: `${index}.txt`, isFile: () => true }
      if (index % 4 === 2) return { name: `${index}.tmp.webp`, isFile: () => true }
      return { name: `${index}.directory`, isFile: () => false }
    })
    const directory = createDirectory([...ignored, { name: 'too-late.webp', isFile: () => true }])
    mocks.opendir.mockResolvedValue(directory)
    const fixture = gcFixture({ entries: [], payload: { dryRun: true, reconcile: true } })

    const outcome = await executeDerivedMediaGc(fixture.context, fixture.dependencies)

    expect(outcome).toMatchObject({
      kind: 'completed',
      result: {
        reconciliationScanned: 500,
        reconciliationCandidates: 0,
        untrackedCandidates: 0
      }
    })
    expect(directory.read).toHaveBeenCalledTimes(500)
    expect(fixture.metadataFindMany).not.toHaveBeenCalled()
    expect(mocks.mkdir).not.toHaveBeenCalled()
    expect(mocks.rm).not.toHaveBeenCalled()
  })

  it('reports files that reappear after terminal GC history as drift', async () => {
    const directory = createDirectory([
      { name: 'pending.webp', isFile: () => true },
      { name: 'retryable-failed.webp', isFile: () => true },
      { name: 'exhausted-failed.webp', isFile: () => true },
      { name: 'deleted-again.webp', isFile: () => true },
      { name: 'reference-gone.webp', isFile: () => true }
    ])
    mocks.opendir.mockResolvedValue(directory)
    const fixture = gcFixture({
      entries: [],
      payload: { dryRun: true, reconcile: true },
      trackedEntries: [
        { relativePath: 'pending.webp', status: 'PENDING', attempt: 0, maxAttempts: 3 },
        { relativePath: 'retryable-failed.webp', status: 'FAILED', attempt: 2, maxAttempts: 3 },
        { relativePath: 'exhausted-failed.webp', status: 'FAILED', attempt: 3, maxAttempts: 3 },
        { relativePath: 'deleted-again.webp', status: 'DELETED' },
        { relativePath: 'reference-gone.webp', status: 'SKIPPED_REFERENCED' }
      ]
    })

    const outcome = await executeDerivedMediaGc(fixture.context, fixture.dependencies)

    expect(outcome).toMatchObject({
      kind: 'completed',
      result: {
        reconciliationScanned: 5,
        reconciliationCandidates: 5,
        untrackedCandidates: 3
      }
    })
    expect(fixture.gcFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { status: { in: ['PENDING', 'PROCESSING'] } },
            { status: 'FAILED', attempt: { lt: 'maxAttempts-field-reference' } }
          ]
        })
      })
    )
  })

  it('treats a missing reconciliation root as an empty read-only scan', async () => {
    mocks.opendir.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    const fixture = gcFixture({ entries: [], payload: { dryRun: true, reconcile: true } })

    const outcome = await executeDerivedMediaGc(fixture.context, fixture.dependencies)

    expect(outcome).toMatchObject({
      kind: 'completed',
      result: { reconciliationScanned: 0, untrackedCandidates: 0 }
    })
    expect(mocks.mkdir).not.toHaveBeenCalled()
    expect(mocks.rename).not.toHaveBeenCalled()
    expect(mocks.rm).not.toHaveBeenCalled()
  })

  it('uses the chapter preview root and preserves a currently referenced preview', async () => {
    mocks.files.add('/chapters/1/hash/0.webp')
    const fixture = gcFixture({
      references: [true],
      entry: {
        mediaKind: 'VIDEO_CHAPTER_PREVIEW',
        relativePath: '1/hash/0.webp',
        referenceType: 'MEDIA_CHAPTER_PREVIEW',
        referenceId: 'preview-1'
      }
    })

    const outcome = await executeDerivedMediaGc(fixture.context, fixture.dependencies)

    expect(outcome).toMatchObject({ kind: 'completed', result: { referenced: 1, deleted: 0 } })
    expect(fixture.chapterFindFirst).toHaveBeenCalledWith({
      where: { previewPath: '1/hash/0.webp' },
      select: { id: true }
    })
    expect(fixture.queryRaw).not.toHaveBeenCalled()
    expect(mocks.rename).not.toHaveBeenCalled()
  })

  it('quarantines and deletes a strictly named streaming artifact before the fenced terminal update', async () => {
    const relativePath = 'folder/video.mp4.pixishelf-remux-job-123-a2.tmp.mp4'
    const outputPath = `/scan/${relativePath}`
    const quarantinePath = `${outputPath}.pixishelf-gc-gc-1.pending-delete`
    mocks.files.add(outputPath)
    const fixture = gcFixture({
      references: [false, false, false],
      entry: { mediaKind: 'VIDEO_STREAMING_ARTIFACT', relativePath, referenceType: 'IMAGE', referenceId: '7' }
    })

    const outcome = await executeDerivedMediaGc(fixture.context, fixture.dependencies)

    expect(outcome).toMatchObject({ kind: 'completed', result: { deleted: 1, failed: 0 } })
    expect(mocks.rename).toHaveBeenCalledWith(outputPath, quarantinePath)
    expect(mocks.rm).toHaveBeenCalledWith(quarantinePath, { force: true })
    expect(fixture.gcUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DELETED' }) })
    )
  })

  it('lets a reference that appears after staging win and restores the staged file', async () => {
    mocks.files.add('/posters/old.webp')
    const fixture = gcFixture({ references: [false, true] })

    const outcome = await executeDerivedMediaGc(fixture.context, fixture.dependencies)

    expect(outcome).toMatchObject({ kind: 'completed', result: { referenced: 1, deleted: 0 } })
    expect(mocks.files.has('/posters/old.webp')).toBe(true)
    expect(mocks.files.has('/posters/old.webp.pixishelf-gc-gc-1.pending-delete')).toBe(false)
    expect(fixture.gcUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SKIPPED_REFERENCED' }) })
    )
  })

  it('restores the staged file and returns the entry to PENDING when cancellation wins', async () => {
    mocks.files.add('/posters/old.webp')
    const controller = new AbortController()
    const fixture = gcFixture({ references: [false], controller, executionStatus: 'CANCELLING' })
    fixture.abortAfterMutation(2)

    const outcome = await executeDerivedMediaGc(fixture.context, fixture.dependencies)

    expect(outcome).toEqual({ kind: 'transactionally-finalized' })
    expect(mocks.files.has('/posters/old.webp')).toBe(true)
    expect(fixture.scope.cancel).toHaveBeenCalledWith('派生媒体 GC 已取消')
    expect(fixture.gcUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PENDING', error: null } })
    )
  })

  it('loads the full 1000-id contract boundary in bounded chunks instead of silently truncating', async () => {
    const ids = Array.from({ length: 1_000 }, (_, index) => `gc-${index + 1}`)
    const fixture = gcFixture({
      payload: { entryIds: ids, dryRun: true, reconcile: false },
      explicitEntries: true,
      references: Array.from({ length: ids.length }, () => true)
    })

    const outcome = await executeDerivedMediaGc(fixture.context, fixture.dependencies)

    expect(outcome).toMatchObject({ kind: 'completed', result: { selected: 1_000, referenced: 1_000 } })
    expect(fixture.loadQueries().map((query) => query.take)).toEqual(Array.from({ length: 10 }, () => 100))
    expect(fixture.loadQueries().flatMap((query) => query.where.id.in)).toEqual(ids)
  })

  it('rejects an unexpected streaming filename without touching the filesystem', async () => {
    const fixture = gcFixture({
      entry: {
        mediaKind: 'VIDEO_STREAMING_ARTIFACT',
        relativePath: 'folder/unrelated.mp4',
        referenceType: 'IMAGE',
        referenceId: '7'
      }
    })

    const outcome = await executeDerivedMediaGc(fixture.context, fixture.dependencies)

    expect(outcome).toMatchObject({ kind: 'completed', result: { deleted: 0, failed: 1 } })
    expect(mocks.inspect).not.toHaveBeenCalled()
    expect(mocks.rename).not.toHaveBeenCalled()
    expect(fixture.gcUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', error: 'Invalid streaming artifact filename' })
      })
    )
  })

  it('propagates stale-fence failures without mutating entry terminal state', async () => {
    const fixture = gcFixture({})
    vi.mocked(fixture.context.mutateInTransaction).mockRejectedValueOnce(new JobExecutionFenceError('gc-job'))

    await expect(executeDerivedMediaGc(fixture.context, fixture.dependencies)).rejects.toBeInstanceOf(
      JobExecutionFenceError
    )
    expect(fixture.gcUpdateMany).not.toHaveBeenCalled()
  })
})

type EntryOverrides = Partial<{
  id: string
  mediaKind: string
  relativePath: string
  referenceType: string
  referenceId: string
  status: 'PENDING' | 'PROCESSING' | 'DELETED' | 'FAILED' | 'SKIPPED_REFERENCED'
  attempt: number
  maxAttempts: number
}>

function gcFixture(options: {
  entries?: unknown[]
  entry?: EntryOverrides
  payload?: DerivedMediaGcPayload
  references?: boolean[]
  explicitEntries?: boolean
  controller?: AbortController
  executionStatus?: 'RUNNING' | 'PAUSING' | 'CANCELLING'
  trackedEntries?: Array<{
    relativePath: string
    status: 'PENDING' | 'PROCESSING' | 'DELETED' | 'FAILED' | 'SKIPPED_REFERENCED'
    attempt?: number
    maxAttempts?: number
  }>
}) {
  const baseEntry = {
    id: 'gc-1',
    mediaKind: 'VIDEO_POSTER',
    relativePath: 'old.webp',
    referenceType: 'MEDIA_VIDEO_METADATA_POSTER',
    referenceId: '1',
    status: 'PENDING' as const,
    attempt: 0,
    maxAttempts: 3,
    ...options.entry
  }
  const references = [...(options.references ?? [false, false, false])]
  const nextReference = vi.fn(() => Promise.resolve(references.shift() ?? false))
  const gcFindMany = vi.fn().mockImplementation((query) => {
    if (query.where.mediaKind) {
      return (options.trackedEntries ?? [])
        .filter(
          (entry) =>
            entry.status === 'PENDING' ||
            entry.status === 'PROCESSING' ||
            (entry.status === 'FAILED' && (entry.attempt ?? 0) < (entry.maxAttempts ?? 3))
        )
        .map(({ relativePath }) => ({ relativePath }))
    }
    if (options.explicitEntries) {
      return query.where.id.in.map((id: string) => ({ ...baseEntry, id, referenceId: id.replace('gc-', '') }))
    }
    return options.entries ?? [baseEntry]
  })
  const metadataFindMany = vi.fn().mockResolvedValue([])
  const queryRaw = vi.fn().mockResolvedValue([])
  const gcUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
  const gcFindFirst = vi.fn().mockResolvedValue({ id: baseEntry.id })
  const posterFindFirst = vi.fn(() => nextReference().then((value) => (value ? { imageId: 1 } : null)))
  const chapterFindFirst = vi.fn(() => nextReference().then((value) => (value ? { id: 'preview-live' } : null)))
  const imageFindFirst = vi.fn(() => nextReference().then((value) => (value ? { id: 7 } : null)))
  const transaction = {
    $queryRawUnsafe: queryRaw,
    derivedMediaGcEntry: { updateMany: gcUpdateMany, findFirst: gcFindFirst },
    mediaVideoMetadata: { findFirst: posterFindFirst },
    mediaChapterPreview: { findFirst: chapterFindFirst },
    image: { findFirst: imageFindFirst }
  }
  const controller = options.controller ?? new AbortController()
  let mutationCount = 0
  let abortMutation: number | null = null
  const scope = {
    transaction,
    executionStatus: options.executionStatus ?? 'RUNNING',
    controlStatus:
      options.executionStatus === 'PAUSING'
        ? 'PAUSE_REQUESTED'
        : options.executionStatus === 'CANCELLING'
          ? 'CANCEL_REQUESTED'
          : 'CONTINUE',
    complete: vi.fn(),
    fail: vi.fn(),
    retry: vi.fn(),
    skip: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    release: vi.fn()
  }
  const context = {
    job: { id: 'gc-job', attempt: 1, maxAttempts: 3 },
    payload: options.payload ?? { dryRun: false, reconcile: false },
    signal: controller.signal,
    progress: vi.fn().mockResolvedValue(undefined),
    mutateInTransaction: vi.fn(async (operation) => {
      mutationCount += 1
      const result = await operation(transaction)
      if (abortMutation === mutationCount) controller.abort(new Error('cancelled'))
      return result
    }),
    finalizeInTransaction: vi.fn(async (operation) => {
      await operation(scope)
      return { kind: 'transactionally-finalized' as const }
    }),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  } as unknown as ExecutionContext<DerivedMediaGcPayload, EnqueuedChildJob>
  const database = {
    derivedMediaGcEntry: {
      findMany: gcFindMany,
      fields: { maxAttempts: 'maxAttempts-field-reference' }
    },
    mediaVideoMetadata: { findFirst: posterFindFirst, findMany: metadataFindMany },
    mediaChapterPreview: { findFirst: chapterFindFirst },
    image: { findFirst: imageFindFirst }
  }
  return {
    context,
    scope,
    queryRaw,
    gcFindMany,
    gcUpdateMany,
    chapterFindFirst,
    metadataFindMany,
    abortAfterMutation(count: number) {
      abortMutation = count
    },
    loadQueries: () => gcFindMany.mock.calls.map(([query]) => query).filter((query) => !query.where.mediaKind),
    dependencies: {
      database,
      config: { scanRoot: '/scan', posterStorageRoot: '/posters', chapterPreviewStorageRoot: '/chapters' },
      now: () => new Date('2026-08-14T00:00:00.000Z')
    } as never
  }
}

function createDirectory(entries: Array<{ name: string; isFile: () => boolean }>) {
  let index = 0
  return {
    read: vi.fn(async () => entries[index++] ?? null),
    close: vi.fn().mockResolvedValue(undefined)
  }
}
