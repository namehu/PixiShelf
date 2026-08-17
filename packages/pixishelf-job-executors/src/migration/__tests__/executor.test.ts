import { createHash } from 'node:crypto'
import path from 'node:path'
import type {
  EnqueuedChildJob,
  ExecutionContext,
  FencedExecutionTransaction,
  QueueSqlExecutor
} from '@pixishelf/job-runtime'
import { describe, expect, it, vi } from 'vitest'
import { executeMigration } from '../executor.js'
import type {
  CreateMigrationPlanInput,
  MigrationArtworkPlan,
  MigrationArtworkSnapshot,
  MigrationDatabasePort,
  MigrationFileCheckpoint,
  MigrationItemCheckpoint,
  MigrationPayloadV1,
  MigrationRuntimeConfig,
  MigrationSelection,
  MigrationSelectionPageInput,
  MigrationSelectionRow,
  MigrationSummary
} from '../types.js'
import { MigrationActionRequiredError } from '../types.js'
import { MemoryMigrationFileSystem } from './memory-file-system.js'

describe('migration executor', () => {
  it('uses bounded strict keyset pages, freezes QUERY selection, and processes artworks one at a time', async () => {
    const selection: MigrationSelection = {
      mode: 'QUERY',
      filters: {
        search: 'landscape',
        startDate: '2026-01-01',
        endDate: '2026-08-01',
        mediaTypes: ['.jpg'],
        exactMatch: false
      },
      upperArtworkId: 105
    }
    const rows = Array.from({ length: 105 }, (_, index) => ({ id: index + 1, deletedAt: null }))
    const fixture = executorFixture({ selection, pages: [rows.slice(0, 100), rows.slice(100), []] })
    let inFlight = 0
    let maxInFlight = 0
    fixture.database.loadArtwork = vi.fn(async (artworkId) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight -= 1
      return canonicalArtwork(artworkId)
    })

    await expect(executeMigration(fixture.context, fixture.dependencies)).resolves.toEqual({
      kind: 'transactionally-finalized'
    })

    expect(fixture.selectPage.mock.calls.map(([input]) => input)).toEqual([
      { selection, afterArtworkId: 0, take: 100 },
      { selection, afterArtworkId: 100, take: 100 },
      { selection, afterArtworkId: 105, take: 100 }
    ])
    expect(maxInFlight).toBe(1)
    expect(fixture.database.createOrLoadPlan).toHaveBeenCalledTimes(105)
  })

  it('fenced-validates every canonical Image before marking an all-canonical plan skipped', async () => {
    const fixture = executorFixture({
      selection: { mode: 'ARTWORK_IDS', artworkIds: [1] },
      pages: [[{ id: 1, deletedAt: null }], []],
      artwork: canonicalArtwork(1)
    })

    await executeMigration(fixture.context, fixture.dependencies)

    expect(fixture.database.publishArtwork).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        terminalStatus: 'SKIPPED',
        plannedImageIds: [10],
        files: [
          expect.objectContaining({
            imageId: 10,
            sourceStoredPath: '/artist/1/1_p0.jpg',
            targetStoredPath: '/artist/1/1_p0.jpg'
          })
        ]
      })
    )
  })

  it('persists ACTION_REQUIRED against the canonical plan when its fenced validation detects drift', async () => {
    const fixture = executorFixture({
      selection: { mode: 'ARTWORK_IDS', artworkIds: [1] },
      pages: [[{ id: 1, deletedAt: null }]],
      artwork: canonicalArtwork(1)
    })
    fixture.database.publishArtwork = vi
      .fn()
      .mockRejectedValue(new MigrationActionRequiredError('DATABASE_PATH_CONFLICT', 'concurrent path drift'))

    await executeMigration(fixture.context, fixture.dependencies)

    expect(fixture.database.checkpointItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ itemId: 'item-1', status: 'ACTION_REQUIRED' })
    )
    expect(fixture.scope.pause).toHaveBeenCalledWith(expect.objectContaining({ reason: 'ACTION_REQUIRED' }))
  })

  it('freezes referenced chapters and metadata sidecars into the durable migration plan', async () => {
    const fixture = executorFixture({
      selection: { mode: 'ARTWORK_IDS', artworkIds: [1] },
      pages: [[{ id: 1, deletedAt: null }], []],
      artwork: {
        ...sourceArtwork(1),
        metaSource: 'source/123_meta.json',
        storagePath: 'source',
        images: [
          {
            id: 11,
            path: '/source/123_p0.jpg',
            chaptersPath: '/source/123_p0.chapters.json'
          }
        ]
      }
    })
    fixture.fileSystem.addFile(path.resolve('/scan/source/123_p0.chapters.json'), 'chapters')
    fixture.fileSystem.addFile(path.resolve('/scan/source/123_meta.json'), 'metadata')

    await executeMigration(fixture.context, fixture.dependencies)

    const planInput = vi.mocked(fixture.database.createOrLoadPlan).mock.calls[0]![1]
    expect(planInput.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ imageId: 11, sourceStoredPath: '/source/123_p0.jpg' }),
        expect.objectContaining({ imageId: null, sourceStoredPath: '/source/123_p0.chapters.json' }),
        expect.objectContaining({ imageId: null, sourceStoredPath: 'source/123_meta.json' })
      ])
    )
  })

  it('stops an id-looping selection adapter instead of processing the same page forever', async () => {
    const selection: MigrationSelection = { mode: 'ARTWORK_IDS', artworkIds: [1] }
    const fixture = executorFixture({ selection, pages: [[{ id: 1, deletedAt: null }], [{ id: 1, deletedAt: null }]] })
    fixture.context.job.attempt = fixture.context.job.maxAttempts

    await expect(executeMigration(fixture.context, fixture.dependencies)).resolves.toEqual({
      kind: 'transactionally-finalized'
    })

    expect(fixture.selectPage).toHaveBeenCalledTimes(2)
    expect(fixture.scope.fail).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'INTERNAL_ERROR' }))
    expect(fixture.context.logger.error).toHaveBeenCalledWith(
      'migration.execution_failed',
      expect.objectContaining({ message: expect.stringContaining('strict increasing keyset') }),
      expect.anything()
    )
  })

  it('forwards FAILED_FROM_JOB selection unchanged to the equivalence port', async () => {
    const selection: MigrationSelection = { mode: 'FAILED_FROM_JOB', sourceJobId: 'old-migration' }
    const fixture = executorFixture({ selection, pages: [[]] })

    await executeMigration(fixture.context, fixture.dependencies)

    expect(fixture.database.selection.count).toHaveBeenCalledWith(selection)
    expect(fixture.selectPage).toHaveBeenCalledWith({ selection, afterArtworkId: 0, take: 100 })
  })

  it('hard-limits terminal failure samples even if a persistence adapter over-returns', async () => {
    const fixture = executorFixture({ selection: { mode: 'ARTWORK_IDS', artworkIds: [1] }, pages: [[]] })
    vi.mocked(fixture.database.summarize).mockResolvedValue({
      total: 100,
      processed: 100,
      completed: 0,
      skipped: 0,
      failed: 100,
      actionRequired: 0,
      cancelled: 0,
      failedSamples: Array.from({ length: 100 }, (_, artworkId) => ({
        artworkId,
        externalId: null,
        code: 'FAILED',
        message: `C:\\private\\apiKey=secret-${artworkId}-${'界'.repeat(1_000)}`
      }))
    })

    await executeMigration(fixture.context, fixture.dependencies)

    expect(fixture.scope.complete).toHaveBeenCalledWith(
      expect.objectContaining({ result: expect.objectContaining({ failedSamples: expect.any(Array) }) })
    )
    const completed = vi.mocked(fixture.scope.complete).mock.calls[0]![0] as { result: MigrationSummary }
    expect(completed.result.failedSamples).toHaveLength(20)
    expect(completed.result.failedSamples[0]!.message).not.toContain('private')
    expect(Buffer.byteLength(completed.result.failedSamples[0]!.message, 'utf8')).toBeLessThanOrEqual(512)
  })

  it('publishes files before the image path CAS and removes the exact source only after DB publication', async () => {
    const events: string[] = []
    const fixture = executorFixture({
      selection: { mode: 'ARTWORK_IDS', artworkIds: [1] },
      pages: [[{ id: 1, deletedAt: null }], []],
      artwork: sourceArtwork(1),
      fileEvents: events
    })
    fixture.database.publishArtwork = vi.fn(async (_transaction, input) => {
      events.push('database-published')
      fixture.applyDatabasePublication(input)
    })

    await executeMigration(fixture.context, fixture.dependencies)

    const targetCopy = events.findIndex((event) => event.includes(`${path.sep}artist${path.sep}123${path.sep}`))
    const databasePublish = events.indexOf('database-published')
    const sourceDelete = events.findIndex(
      (event) => event.startsWith('unlink:') && event.endsWith(`${path.sep}source${path.sep}123_p0.jpg`)
    )
    expect(targetCopy).toBeGreaterThanOrEqual(0)
    expect(databasePublish).toBeGreaterThan(targetCopy)
    expect(sourceDelete).toBeGreaterThan(databasePublish)
    expect(fixture.scope.complete).toHaveBeenCalledOnce()
  })

  it('keeps the source for copy mode when cleanupSource is disabled while still verifying publication', async () => {
    const fixture = executorFixture({
      selection: { mode: 'ARTWORK_IDS', artworkIds: [1] },
      pages: [[{ id: 1, deletedAt: null }], []],
      artwork: sourceArtwork(1)
    })
    fixture.context.payload.safety = { transferMode: 'copy', verifyAfterCopy: false, cleanupSource: false }

    await executeMigration(fixture.context, fixture.dependencies)

    expect(fixture.fileSystem.has(path.resolve('/scan/source/123_p0.jpg'))).toBe(true)
    expect(fixture.fileSystem.has(path.resolve('/scan/artist/123/123_p0.jpg'))).toBe(true)
    expect(fixture.database.publishArtwork).toHaveBeenCalledOnce()
  })

  it('resumes from the DB_PUBLISHED cleanup phase without copying or publishing again', async () => {
    const fixture = executorFixture({
      selection: { mode: 'ARTWORK_IDS', artworkIds: [1] },
      pages: [[{ id: 1, deletedAt: null }], []],
      artwork: sourceArtwork(1)
    })
    const hash = createHash('sha256').update('source-content').digest('hex')
    const plan = fixture.seedPlan({ phase: 'CLEANING_SOURCE', status: 'RUNNING', sourceHash: hash })
    fixture.fileSystem.addDirectory(path.resolve('/scan/.pixishelf-migration-staging'))
    fixture.fileSystem.addDirectory(path.dirname(path.resolve('/scan', plan.files[0]!.stagedRelativePath)))
    fixture.fileSystem.addFile(path.resolve('/scan', plan.files[0]!.stagedRelativePath), 'source-content', 7)
    fixture.fileSystem.addDirectory(path.resolve('/scan/artist'))
    fixture.fileSystem.addDirectory(path.resolve('/scan/artist/123'))
    fixture.fileSystem.addFile(path.resolve('/scan/artist/123/123_p0.jpg'), 'source-content')

    await executeMigration(fixture.context, fixture.dependencies)

    expect(fixture.database.publishArtwork).not.toHaveBeenCalled()
    expect(fixture.fileSystem.copyCount).toBe(0)
    expect(fixture.fileSystem.has(path.resolve('/scan/source/123_p0.jpg'))).toBe(false)
    expect(fixture.database.checkpointItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ itemId: plan.id, status: 'COMPLETED', phase: 'FINALIZING' })
    )
  })

  it('treats slash-format variants as the same file by canonical relative path', async () => {
    const fixture = executorFixture({
      selection: { mode: 'ARTWORK_IDS', artworkIds: [1] },
      pages: [[{ id: 1, deletedAt: null }], []],
      artwork: canonicalArtwork(1)
    })
    const plan = fixture.seedPlan({ phase: 'CLEANING_SOURCE', status: 'RUNNING' })
    plan.files[0]!.sourceStoredPath = 'artist\\123\\123_p0.jpg'
    plan.files[0]!.targetStoredPath = '/artist/123/123_p0.jpg'
    plan.files[0]!.sourceRelativePath = 'artist/123/123_p0.jpg'
    plan.files[0]!.targetRelativePath = 'artist/123/123_p0.jpg'

    await executeMigration(fixture.context, fixture.dependencies)

    expect(fixture.fileSystem.copyCount).toBe(0)
    expect(fixture.scope.pause).not.toHaveBeenCalled()
    expect(fixture.database.publishArtwork).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ terminalStatus: 'SKIPPED' })
    )
  })

  it.each([
    ['PAUSING', 'pause', 'PAUSED'],
    ['CANCELLING', 'cancel', 'CANCELLED'],
    ['RUNNING', 'release', 'RETRY_WAIT']
  ] as const)('persists %s interruption before the queue %s intent', async (executionStatus, intent, itemStatus) => {
    const fixture = executorFixture({
      selection: { mode: 'ARTWORK_IDS', artworkIds: [1] },
      pages: [[{ id: 1, deletedAt: null }]],
      artwork: sourceArtwork(1),
      executionStatus
    })
    fixture.seedPlan({ phase: 'STAGING_FILES', status: 'RUNNING' })
    vi.mocked(fixture.database.checkpointItem).mockImplementation(async (_transaction, input) => {
      if (input.status === 'RUNNING' && input.phase === 'STAGING_FILES') {
        fixture.controller.abort(new Error('interrupted'))
      }
    })

    await executeMigration(fixture.context, fixture.dependencies)

    if (executionStatus === 'CANCELLING') {
      expect(fixture.database.closeItemAndFiles).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: itemStatus, phase: 'STAGING_FILES' })
      )
    } else {
      expect(fixture.database.checkpointItem).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: itemStatus, phase: 'STAGING_FILES' })
      )
    }
    expect(fixture.scope[intent]).toHaveBeenCalledOnce()
    expect(fixture.fileSystem.copyCount).toBe(0)
  })

  it('atomically records ACTION_REQUIRED when canonical target content conflicts', async () => {
    const fixture = executorFixture({
      selection: { mode: 'ARTWORK_IDS', artworkIds: [1] },
      pages: [[{ id: 1, deletedAt: null }]],
      artwork: sourceArtwork(1)
    })
    fixture.fileSystem.addDirectory(path.resolve('/scan/artist'))
    fixture.fileSystem.addDirectory(path.resolve('/scan/artist/123'))
    fixture.fileSystem.addFile(path.resolve('/scan/artist/123/123_p0.jpg'), 'conflict')

    await executeMigration(fixture.context, fixture.dependencies)

    expect(fixture.database.checkpointItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'ACTION_REQUIRED', errorCode: 'TARGET_CONFLICT' })
    )
    expect(fixture.database.checkpointFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'ACTION_REQUIRED', errorCode: 'TARGET_CONFLICT' })
    )
    expect(fixture.scope.pause).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'ACTION_REQUIRED',
        data: expect.objectContaining({ errorCode: 'TARGET_CONFLICT' })
      })
    )
    expect(fixture.database.publishArtwork).not.toHaveBeenCalled()
  })

  it('does not touch files when the first fenced planning checkpoint is stale', async () => {
    const fixture = executorFixture({
      selection: { mode: 'ARTWORK_IDS', artworkIds: [1] },
      pages: [[{ id: 1, deletedAt: null }]],
      artwork: sourceArtwork(1)
    })
    fixture.context.mutateInTransaction = vi.fn().mockRejectedValue(new Error('stale execution fence'))
    fixture.context.job.attempt = fixture.context.job.maxAttempts

    await executeMigration(fixture.context, fixture.dependencies)

    expect(fixture.fileSystem.copyCount).toBe(0)
    expect(fixture.database.createOrLoadPlan).not.toHaveBeenCalled()
    expect(fixture.scope.fail).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'INTERNAL_ERROR' }))
    expect(fixture.context.logger.error).toHaveBeenCalledWith(
      'migration.execution_failed',
      expect.objectContaining({ message: 'stale execution fence' }),
      expect.anything()
    )
  })

  it('discovers bounded externalId-owned sidecars without confusing 123 with 1234', async () => {
    const fixture = executorFixture({
      selection: { mode: 'ARTWORK_IDS', artworkIds: [1] },
      pages: [[{ id: 1, deletedAt: null }], []],
      artwork: sourceArtwork(1)
    })
    fixture.fileSystem.addFile(path.resolve('/scan/source/123_meta.json'), 'metadata')
    fixture.fileSystem.addFile(path.resolve('/scan/source/1234_meta.json'), 'other artwork')

    await executeMigration(fixture.context, fixture.dependencies)

    const planInput = vi.mocked(fixture.database.createOrLoadPlan).mock.calls[0]![1]
    expect(planInput.files.map((file) => [file.imageId, file.sourceRelativePath])).toEqual([
      [11, 'source/123_p0.jpg'],
      [null, 'source/123_meta.json']
    ])
    expect(fixture.fileSystem.has(path.resolve('/scan/artist/123/123_meta.json'))).toBe(true)
    expect(fixture.fileSystem.has(path.resolve('/scan/source/1234_meta.json'))).toBe(true)
  })

  it('pauses instead of truncating an over-limit sidecar directory or artwork plan', async () => {
    const fixture = executorFixture({
      selection: { mode: 'ARTWORK_IDS', artworkIds: [1] },
      pages: [[{ id: 1, deletedAt: null }]],
      artwork: sourceArtwork(1)
    })
    fixture.dependencies.config.maxDirectoryEntries = 1
    fixture.fileSystem.addFile(path.resolve('/scan/source/123_meta.json'), 'metadata')

    await executeMigration(fixture.context, fixture.dependencies)

    expect(fixture.database.createOrLoadPlan).not.toHaveBeenCalled()
    expect(fixture.database.recordUnplannableItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'ACTION_REQUIRED', errorCode: 'CANDIDATE_LIMIT_EXCEEDED' })
    )
    expect(fixture.scope.pause).toHaveBeenCalledWith(expect.objectContaining({ reason: 'ACTION_REQUIRED' }))
  })

  it('rejects case-fold target collisions before any file copy', async () => {
    const fixture = executorFixture({
      selection: { mode: 'ARTWORK_IDS', artworkIds: [1] },
      pages: [[{ id: 1, deletedAt: null }]],
      artwork: {
        ...sourceArtwork(1),
        images: [
          { id: 11, path: '/source/123_p0.jpg', chaptersPath: null },
          { id: 12, path: '/source/123_P0.JPG', chaptersPath: null }
        ]
      }
    })
    fixture.fileSystem.addFile(path.resolve('/scan/source/123_P0.JPG'), 'other')

    await executeMigration(fixture.context, fixture.dependencies)

    expect(fixture.fileSystem.copyCount).toBe(0)
    expect(fixture.database.recordUnplannableItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'ACTION_REQUIRED', errorCode: 'TARGET_CONFLICT' })
    )
  })

  it('atomically closes non-completed file checkpoints on permanent failure', async () => {
    const fixture = executorFixture({
      selection: { mode: 'ARTWORK_IDS', artworkIds: [1] },
      pages: [[{ id: 1, deletedAt: null }], []],
      artwork: sourceArtwork(1)
    })
    fixture.fileSystem.addSymlink(path.resolve('/scan/source/123_p0.jpg'), path.resolve('/outside/123_p0.jpg'))

    await executeMigration(fixture.context, fixture.dependencies)

    expect(fixture.database.closeItemAndFiles).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'FAILED', errorCode: 'PATH_OUTSIDE_ALLOWED_ROOT' })
    )
    const plan = vi.mocked(fixture.database.createOrLoadPlan).mock.results[0]?.value
    await expect(plan).resolves.toEqual(expect.objectContaining({ status: 'FAILED' }))
  })

  it.each(['STAGING_FILES', 'VERIFYING_FILES', 'PUBLISHING_DATABASE'] as const)(
    'recovers idempotently from a crash checkpointed in %s',
    async (phase) => {
      const fixture = executorFixture({
        selection: { mode: 'ARTWORK_IDS', artworkIds: [1] },
        pages: [[{ id: 1, deletedAt: null }], []],
        artwork: sourceArtwork(1)
      })
      fixture.seedPlan({ phase, status: 'RUNNING' })

      await executeMigration(fixture.context, fixture.dependencies)

      expect(fixture.scope.complete).toHaveBeenCalledOnce()
      expect(fixture.database.checkpointItem).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'COMPLETED', phase: 'FINALIZING' })
      )
    }
  )

  it('recovers after cleanup completed but before the final item checkpoint', async () => {
    const fixture = executorFixture({
      selection: { mode: 'ARTWORK_IDS', artworkIds: [1] },
      pages: [[{ id: 1, deletedAt: null }], []],
      artwork: sourceArtwork(1)
    })
    const hash = createHash('sha256').update('source-content').digest('hex')
    fixture.seedPlan({ phase: 'FINALIZING', status: 'RUNNING', sourceHash: hash })
    fixture.fileSystem.addDirectory(path.resolve('/scan/artist'))
    fixture.fileSystem.addDirectory(path.resolve('/scan/artist/123'))
    fixture.fileSystem.addFile(path.resolve('/scan/artist/123/123_p0.jpg'), 'source-content')
    await fixture.fileSystem.unlink(path.resolve('/scan/source/123_p0.jpg'))

    await executeMigration(fixture.context, fixture.dependencies)

    expect(fixture.database.publishArtwork).not.toHaveBeenCalled()
    expect(fixture.database.checkpointItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'COMPLETED', phase: 'FINALIZING' })
    )
  })

  it('rejects too many image rows before enumerating or creating a partial plan', async () => {
    const fixture = executorFixture({
      selection: { mode: 'ARTWORK_IDS', artworkIds: [1] },
      pages: [[{ id: 1, deletedAt: null }]],
      artwork: {
        ...sourceArtwork(1),
        images: [
          { id: 11, path: '/source/123_p0.jpg', chaptersPath: null },
          { id: 12, path: '/source/123_p1.jpg', chaptersPath: null }
        ]
      }
    })
    fixture.dependencies.config.maxArtworkFiles = 1
    const listDirectory = vi.spyOn(fixture.fileSystem, 'listDirectoryBounded')

    await executeMigration(fixture.context, fixture.dependencies)

    expect(fixture.database.loadArtwork).toHaveBeenCalledWith(1, 2)
    expect(listDirectory).not.toHaveBeenCalled()
    expect(fixture.database.createOrLoadPlan).not.toHaveBeenCalled()
    expect(fixture.database.recordUnplannableItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'ACTION_REQUIRED', errorCode: 'CANDIDATE_LIMIT_EXCEEDED' })
    )
  })
})

function executorFixture(options: {
  selection: MigrationSelection
  pages: MigrationSelectionRow[][]
  artwork?: MigrationArtworkSnapshot
  executionStatus?: 'RUNNING' | 'PAUSING' | 'CANCELLING'
  fileEvents?: string[]
}) {
  const fileSystem = new MemoryMigrationFileSystem()
  fileSystem.addDirectory(path.resolve('/scan'))
  fileSystem.addDirectory(path.resolve('/scan/source'))
  fileSystem.addFile(path.resolve('/scan/source/123_p0.jpg'), 'source-content', 7)
  if (options.fileEvents) {
    const originalCopy = fileSystem.copyFileExclusive.bind(fileSystem)
    fileSystem.copyFileExclusive = async (source, target) => {
      await originalCopy(source, target)
      options.fileEvents!.push(`copy:${target}`)
    }
    const originalUnlink = fileSystem.unlink.bind(fileSystem)
    fileSystem.unlink = async (target) => {
      await originalUnlink(target)
      options.fileEvents!.push(`unlink:${target}`)
    }
  }

  const plans = new Map<number, MigrationArtworkPlan>()
  const pages = [...options.pages]
  const selectPage = vi.fn(async (input: MigrationSelectionPageInput) => {
    void input
    return pages.shift() ?? []
  })
  const checkpointItem = vi.fn(async (_transaction, input: MigrationItemCheckpoint) => {
    const plan = [...plans.values()].find((candidate) => candidate.id === input.itemId)
    if (plan) {
      plan.status = input.status
      plan.phase = input.phase
      plan.attempt = input.attempt
    }
  })
  const checkpointFile = vi.fn(async (_transaction, input: MigrationFileCheckpoint) => {
    const file = [...plans.values()].flatMap((plan) => plan.files).find((candidate) => candidate.id === input.fileId)
    if (file) {
      file.status = input.status
      file.attempt = input.attempt
      if (input.sourceSize !== undefined) file.sourceSize = input.sourceSize
      if (input.sourceMtimeMs !== undefined) file.sourceMtimeMs = input.sourceMtimeMs
      if (input.sourceSha256 !== undefined) file.sourceSha256 = input.sourceSha256
      if (input.stagedSha256 !== undefined) file.stagedSha256 = input.stagedSha256
    }
  })
  const createOrLoadPlan = vi.fn(async (_transaction, input: CreateMigrationPlanInput) => {
    const existing = plans.get(input.artworkId)
    if (existing) return existing
    const plan: MigrationArtworkPlan = {
      id: `item-${input.artworkId}`,
      systemJobId: input.systemJobId,
      artworkId: input.artworkId,
      selectionOrdinal: input.selectionOrdinal,
      status: 'PENDING',
      phase: 'DISCOVERING',
      attempt: input.attempt,
      sourceDirectory: input.sourceDirectory,
      targetDirectory: input.targetDirectory,
      files: input.files.map((file) => ({
        ...file,
        id: `file-${input.artworkId}-${file.ordinal}`,
        status: 'PENDING',
        attempt: input.attempt,
        sourceSize: null,
        sourceMtimeMs: null,
        sourceSha256: null,
        stagedSha256: null
      }))
    }
    plans.set(input.artworkId, plan)
    return plan
  })
  const applyDatabasePublication = (input: Parameters<MigrationDatabasePort['publishArtwork']>[1]) => {
    const plan = [...plans.values()].find((candidate) => candidate.id === input.itemId)
    if (!plan) throw new Error('plan missing')
    plan.status = input.terminalStatus === 'SKIPPED' ? 'SKIPPED' : 'RUNNING'
    plan.phase = input.terminalStatus === 'SKIPPED' ? 'FINALIZING' : 'CLEANING_SOURCE'
    for (const file of plan.files) {
      file.status = input.terminalStatus === 'SKIPPED' ? 'COMPLETED' : 'SOURCE_CLEANUP_PENDING'
    }
  }
  const database: MigrationDatabasePort = {
    selection: {
      count: vi.fn().mockResolvedValue(options.pages.flat().length),
      precheck: vi.fn().mockResolvedValue({
        total: options.pages.flat().length,
        eligible: options.pages.flat().length,
        missingArtist: 0,
        missingExternalId: 0,
        missingImages: 0
      }),
      selectPage
    },
    loadArtwork: vi.fn().mockImplementation(async (id) => options.artwork ?? canonicalArtwork(id)),
    loadPlan: vi.fn().mockImplementation(async (_jobId, artworkId) => plans.get(artworkId) ?? null),
    recordUnplannableItem: vi.fn(async (_transaction, input) => {
      const item: MigrationArtworkPlan = {
        id: `item-${input.artworkId}`,
        systemJobId: input.systemJobId,
        artworkId: input.artworkId,
        selectionOrdinal: input.selectionOrdinal,
        status: input.status,
        phase: 'DISCOVERING',
        attempt: input.attempt,
        sourceDirectory: null,
        targetDirectory: null,
        files: []
      }
      plans.set(input.artworkId, item)
      return item
    }),
    createOrLoadPlan,
    checkpointItem,
    checkpointFile,
    closeItemAndFiles: vi.fn(async (_transaction, input) => {
      const plan = [...plans.values()].find((candidate) => candidate.id === input.itemId)
      if (!plan) return
      plan.status = input.status
      plan.phase = input.phase
      for (const file of plan.files) {
        if (file.status !== 'COMPLETED') file.status = 'FAILED'
      }
    }),
    publishArtwork: vi.fn(async (_transaction, input) => applyDatabasePublication(input)),
    summarize: vi.fn(async () => summarize(plans))
  }

  const scope = {
    transaction: {} as QueueSqlExecutor,
    executionStatus: options.executionStatus ?? 'RUNNING',
    controlStatus: 'CONTINUE',
    complete: vi.fn(),
    fail: vi.fn(),
    retry: vi.fn(),
    skip: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    release: vi.fn()
  } satisfies FencedExecutionTransaction
  const controller = new AbortController()
  const payload: MigrationPayloadV1 = {
    selection: options.selection,
    safety: { transferMode: 'move', verifyAfterCopy: true, cleanupSource: true }
  }
  const context = {
    job: {
      id: 'migration-job',
      attempt: 1,
      maxAttempts: 3,
      executionToken: '00000000-0000-4000-8000-000000000001'
    },
    payload,
    signal: controller.signal,
    progress: vi.fn(),
    enqueueChild: vi.fn(),
    mutateInTransaction: vi.fn((operation) => operation(scope.transaction)),
    finalizeInTransaction: vi.fn(async (operation) => {
      await operation(scope)
      return { kind: 'transactionally-finalized' as const }
    }),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  } as unknown as ExecutionContext<MigrationPayloadV1, EnqueuedChildJob>
  const config: MigrationRuntimeConfig = { scanRoot: path.resolve('/scan') }

  return {
    fileSystem,
    database,
    selectPage,
    scope,
    controller,
    context,
    dependencies: { database, fileSystem, config },
    applyDatabasePublication,
    seedPlan(input: {
      phase: MigrationArtworkPlan['phase']
      status: MigrationArtworkPlan['status']
      sourceHash?: string
    }) {
      const plan: MigrationArtworkPlan = {
        id: 'item-1',
        systemJobId: 'migration-job',
        artworkId: 1,
        selectionOrdinal: 1,
        status: input.status,
        phase: input.phase,
        attempt: 1,
        sourceDirectory: 'source',
        targetDirectory: 'artist/123',
        files: [
          {
            id: 'file-1-0',
            ordinal: 0,
            imageId: 11,
            sourceStoredPath: '/source/123_p0.jpg',
            sourceRelativePath: 'source/123_p0.jpg',
            targetStoredPath: '/artist/123/123_p0.jpg',
            targetRelativePath: 'artist/123/123_p0.jpg',
            stagedRelativePath: '.pixishelf-migration-staging/seed/attempt-1/artwork-1/0-123_p0.jpg',
            status: input.phase === 'CLEANING_SOURCE' ? 'SOURCE_CLEANUP_PENDING' : 'PENDING',
            attempt: 1,
            sourceSize: input.sourceHash ? 'source-content'.length : null,
            sourceMtimeMs: input.sourceHash ? 7 : null,
            sourceSha256: input.sourceHash ?? null,
            stagedSha256: input.sourceHash ?? null
          }
        ]
      }
      plans.set(1, plan)
      return plan
    }
  }
}

function canonicalArtwork(id: number): MigrationArtworkSnapshot {
  return {
    id,
    deletedAt: null,
    externalId: String(id),
    artistUserId: 'artist',
    metaSource: null,
    storagePath: null,
    images: [{ id: id * 10, path: `/artist/${id}/${id}_p0.jpg`, chaptersPath: null }]
  }
}

function sourceArtwork(id: number): MigrationArtworkSnapshot {
  return {
    id,
    deletedAt: null,
    externalId: '123',
    artistUserId: 'artist',
    metaSource: null,
    storagePath: null,
    images: [{ id: 11, path: '/source/123_p0.jpg', chaptersPath: null }]
  }
}

function summarize(plans: Map<number, MigrationArtworkPlan>): MigrationSummary {
  const values = [...plans.values()]
  return {
    total: values.length,
    processed: values.filter((item) => ['COMPLETED', 'SKIPPED', 'FAILED', 'ACTION_REQUIRED'].includes(item.status))
      .length,
    completed: values.filter((item) => item.status === 'COMPLETED').length,
    skipped: values.filter((item) => item.status === 'SKIPPED').length,
    failed: values.filter((item) => item.status === 'FAILED').length,
    actionRequired: values.filter((item) => item.status === 'ACTION_REQUIRED').length,
    cancelled: values.filter((item) => item.status === 'CANCELLED').length,
    failedSamples: []
  }
}
