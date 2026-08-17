import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  EnqueuedChildJob,
  ExecutionContext,
  FencedExecutionTransaction,
  QueueSqlExecutor
} from '@pixishelf/job-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executePendingReplace } from '../executor.js'
import { createNodePendingReplaceFileSystem } from '../file-system.js'
import { createManifestFingerprint } from '../snapshot.js'
import type {
  PendingReplaceBatchCounters,
  PendingReplaceDatabasePort,
  PendingReplaceItemSnapshot,
  PendingReplacePayloadV1
} from '../types.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('pending replacement executor', () => {
  it('runs BATCH through fenced checkpoints and preserves old and new copies', async () => {
    const fixture = await replacementFixture()
    const { context, scope } = executionContext(fixture.payload)
    await executePendingReplace(context, fixture.dependencies)

    expect(await readFile(path.join(fixture.root, 'artworks', '123_p0.jpg'), 'utf8')).toBe('new-content')
    expect(await readFile(path.join(fixture.root, 'replace-backups', 'batch-1', 'item-1', '123_p0.jpg'), 'utf8')).toBe(
      'old-content'
    )
    expect(
      JSON.parse(
        await readFile(
          path.join(fixture.root, 'completed-replaces', 'batch-1', 'item-1', 'replace-manifest.json'),
          'utf8'
        )
      )
    ).toMatchObject({
      version: 1,
      itemId: 'item-1'
    })
    expect(fixture.database.publishReplacement).toHaveBeenCalledTimes(1)
    expect(context.logger.warn).not.toHaveBeenCalled()
    expect(fixture.statuses).toEqual(
      expect.arrayContaining(['STAGING', 'BACKING_UP', 'SWAPPING', 'COMMITTING', 'SUCCESS'])
    )
    expect(scope.complete).toHaveBeenCalledTimes(1)
  })

  it('rolls back both filesystem versions when database publication fails', async () => {
    const fixture = await replacementFixture()
    fixture.database.publishReplacement = vi.fn().mockRejectedValue(new Error('database response failed'))
    const { context, scope } = executionContext(fixture.payload)
    await executePendingReplace(context, fixture.dependencies)

    expect(await readFile(path.join(fixture.root, 'artworks', '123_p0.jpg'), 'utf8')).toBe('old-content')
    expect(await readFile(path.join(fixture.root, 'pending-replaces', 'source__ext-123', 'incoming.jpg'), 'utf8')).toBe(
      'new-content'
    )
    expect(fixture.statuses.at(-1)).toBe('FAILED')
    expect(scope.complete).toHaveBeenCalledTimes(1)
  })

  it('rejects a selected item whose eligibility changed after enqueue', async () => {
    const fixture = await replacementFixture()
    fixture.item.included = false
    const { context, scope } = executionContext(fixture.payload)
    await executePendingReplace(context, fixture.dependencies)

    expect(fixture.database.publishReplacement).not.toHaveBeenCalled()
    expect(scope.fail).toHaveBeenCalledWith(expect.objectContaining({ error: 'INVALID_OPERATION' }))
  })

  it.each(['STAGING', 'BACKING_UP', 'SWAPPING', 'COMMITTING', 'ARCHIVING'] as const)(
    'recovers a replacement interrupted in %s',
    async (phase) => {
      const fixture = await replacementFixture()
      await arrangeReplacementPhase(fixture, phase)
      fixture.item.status = phase
      const run = executionContext(fixture.payload)
      await executePendingReplace(run.context, fixture.dependencies)
      expect(await readFile(path.join(fixture.root, 'artworks', '123_p0.jpg'), 'utf8')).toBe('new-content')
      expect(
        await readFile(path.join(fixture.root, 'replace-backups', 'batch-1', 'item-1', '123_p0.jpg'), 'utf8')
      ).toBe('old-content')
      expect(fixture.statuses.at(-1)).toBe('SUCCESS')
      expect(run.scope.complete).toHaveBeenCalledTimes(1)
    }
  )

  it('resumes ROLLING_BACK by restoring old target and pending source before queue completion', async () => {
    const fixture = await replacementFixture()
    await arrangeReplacementPhase(fixture, 'COMMITTING')
    fixture.item.status = 'ROLLING_BACK'
    const run = executionContext(fixture.payload)
    await executePendingReplace(run.context, fixture.dependencies)
    expect(await readFile(path.join(fixture.root, 'artworks', '123_p0.jpg'), 'utf8')).toBe('old-content')
    expect(await readFile(path.join(fixture.root, 'pending-replaces', 'source__ext-123', 'incoming.jpg'), 'utf8')).toBe(
      'new-content'
    )
    expect(fixture.statuses.at(-1)).toBe('FAILED')
  })

  it('restores a successful item and commits the domain state before the queue terminal', async () => {
    const fixture = await replacementFixture()
    const first = executionContext(fixture.payload)
    await executePendingReplace(first.context, fixture.dependencies)
    fixture.item.status = 'SUCCESS'
    fixture.item.backupDirectory = '/replace-backups/batch-1/item-1'
    fixture.database.loadOperation = vi.fn().mockResolvedValue({
      systemJobId: 'job-1',
      batchId: 'batch-1',
      itemId: 'item-1',
      mode: 'RESTORE'
    })
    const payload: PendingReplacePayloadV1 = { mode: 'RESTORE', batchId: 'batch-1', itemId: 'item-1' }
    const second = executionContext(payload)
    await executePendingReplace(second.context, fixture.dependencies)

    expect(await readFile(path.join(fixture.root, 'artworks', '123_p0.jpg'), 'utf8')).toBe('old-content')
    expect(await readFile(path.join(fixture.root, 'pending-replaces', 'source__ext-123', 'incoming.jpg'), 'utf8')).toBe(
      'new-content'
    )
    expect(fixture.database.publishRestore).toHaveBeenCalledTimes(1)
    expect(fixture.statuses).toEqual(expect.arrayContaining(['RESTORING', 'RESTORE_SWAPPING', 'RESTORED']))
    expect(second.scope.complete).toHaveBeenCalledTimes(1)
  })

  it('accepts the legacy producer backup identity based on externalId', async () => {
    const fixture = await replacementFixture()
    await executePendingReplace(executionContext(fixture.payload).context, fixture.dependencies)
    await rename(
      path.join(fixture.root, 'replace-backups', 'batch-1', 'item-1'),
      path.join(fixture.root, 'replace-backups', 'batch-1', '123')
    )
    fixture.item.status = 'SUCCESS'
    fixture.item.backupDirectory = '/replace-backups/batch-1/123'
    fixture.database.loadOperation = vi.fn().mockResolvedValue({
      systemJobId: 'job-1',
      batchId: 'batch-1',
      itemId: 'item-1',
      mode: 'RESTORE'
    })

    const restore = executionContext({ mode: 'RESTORE', batchId: 'batch-1', itemId: 'item-1' })
    await executePendingReplace(restore.context, fixture.dependencies)

    expect(await readFile(path.join(fixture.root, 'artworks', '123_p0.jpg'), 'utf8')).toBe('old-content')
    expect(fixture.database.publishRestore).toHaveBeenCalledTimes(1)
    expect(restore.scope.complete).toHaveBeenCalledTimes(1)
  })

  it.each(['RESTORE', 'CLEANUP'] as const)(
    'rejects an arbitrary persisted backup before any filesystem mutation in %s',
    async (mode) => {
      const fixture = await replacementFixture()
      await executePendingReplace(executionContext(fixture.payload).context, fixture.dependencies)
      fixture.item.status = 'SUCCESS'
      fixture.item.backupDirectory = '/replace-backups/batch-1/arbitrary'
      fixture.database.loadOperation = vi.fn().mockResolvedValue({
        systemJobId: 'job-1',
        batchId: 'batch-1',
        itemId: mode === 'RESTORE' ? 'item-1' : null,
        mode
      })
      const run = executionContext(
        mode === 'RESTORE' ? { mode, batchId: 'batch-1', itemId: 'item-1' } : { mode, batchId: 'batch-1' }
      )

      await executePendingReplace(run.context, fixture.dependencies)

      expect(await readFile(path.join(fixture.root, 'artworks', '123_p0.jpg'), 'utf8')).toBe('new-content')
      expect(
        await readFile(path.join(fixture.root, 'replace-backups', 'batch-1', 'item-1', '123_p0.jpg'), 'utf8')
      ).toBe('old-content')
      expect(fixture.database.publishRestore).not.toHaveBeenCalled()
      expect(fixture.database.assertMediaSnapshot).not.toHaveBeenCalled()
      expect(run.scope.fail).toHaveBeenCalledWith(expect.objectContaining({ error: 'INVALID_SNAPSHOT' }))
    }
  )

  it('rejects a case-folded backup and target collision before restore filesystem mutation', async () => {
    const fixture = await replacementFixture()
    await executePendingReplace(executionContext(fixture.payload).context, fixture.dependencies)
    fixture.item.status = 'SUCCESS'
    fixture.item.backupDirectory = '/replace-backups/batch-1/item-1'
    fixture.item.targetDirectory = '/REPLACE-BACKUPS/BATCH-1/ITEM-1'
    fixture.database.loadOperation = vi.fn().mockResolvedValue({
      systemJobId: 'job-1',
      batchId: 'batch-1',
      itemId: 'item-1',
      mode: 'RESTORE'
    })
    const restore = executionContext({ mode: 'RESTORE', batchId: 'batch-1', itemId: 'item-1' })

    await executePendingReplace(restore.context, fixture.dependencies)

    expect(await readFile(path.join(fixture.root, 'artworks', '123_p0.jpg'), 'utf8')).toBe('new-content')
    expect(await readFile(path.join(fixture.root, 'replace-backups', 'batch-1', 'item-1', '123_p0.jpg'), 'utf8')).toBe(
      'old-content'
    )
    expect(fixture.database.publishRestore).not.toHaveBeenCalled()
    expect(restore.scope.fail).toHaveBeenCalledWith(expect.objectContaining({ error: 'PATH_OUTSIDE_SCAN_ROOT' }))
  })

  it('rejects a restore destination outside pending-replaces before filesystem mutation', async () => {
    const fixture = await replacementFixture()
    await executePendingReplace(executionContext(fixture.payload).context, fixture.dependencies)
    fixture.item.status = 'SUCCESS'
    fixture.item.backupDirectory = '/replace-backups/batch-1/item-1'
    fixture.item.sourceDirectory = '/completed-replaces/batch-1/item-1'
    fixture.database.loadOperation = vi.fn().mockResolvedValue({
      systemJobId: 'job-1',
      batchId: 'batch-1',
      itemId: 'item-1',
      mode: 'RESTORE'
    })
    const restore = executionContext({ mode: 'RESTORE', batchId: 'batch-1', itemId: 'item-1' })

    await executePendingReplace(restore.context, fixture.dependencies)

    expect(await readFile(path.join(fixture.root, 'artworks', '123_p0.jpg'), 'utf8')).toBe('new-content')
    expect(await readFile(path.join(fixture.root, 'replace-backups', 'batch-1', 'item-1', '123_p0.jpg'), 'utf8')).toBe(
      'old-content'
    )
    expect(fixture.database.publishRestore).not.toHaveBeenCalled()
    expect(restore.scope.fail).toHaveBeenCalledWith(expect.objectContaining({ error: 'INVALID_SNAPSHOT' }))
  })

  it.each(['RESTORING', 'RESTORE_SWAPPING'] as const)('recovers a restore interrupted in %s', async (phase) => {
    const fixture = await replacementFixture()
    await executePendingReplace(executionContext(fixture.payload).context, fixture.dependencies)
    fixture.item.status = phase
    fixture.item.backupDirectory = '/replace-backups/batch-1/item-1'
    await mkdir(path.join(fixture.root, 'pending-replaces', 'source__ext-123'), { recursive: true })
    await import('node:fs/promises').then(({ rename }) =>
      rename(
        path.join(fixture.root, 'artworks', '123_p0.jpg'),
        path.join(fixture.root, 'pending-replaces', 'source__ext-123', 'incoming.jpg')
      )
    )
    fixture.database.loadOperation = vi.fn().mockResolvedValue({
      systemJobId: 'job-1',
      batchId: 'batch-1',
      itemId: 'item-1',
      mode: 'RESTORE'
    })
    const run = executionContext({ mode: 'RESTORE', batchId: 'batch-1', itemId: 'item-1' })
    await executePendingReplace(run.context, fixture.dependencies)
    expect(await readFile(path.join(fixture.root, 'artworks', '123_p0.jpg'), 'utf8')).toBe('old-content')
    expect(fixture.statuses.at(-1)).toBe('RESTORED')
  })

  it('rolls restore back and preserves an unexpected backup entry for manual action', async () => {
    const fixture = await replacementFixture()
    await executePendingReplace(executionContext(fixture.payload).context, fixture.dependencies)
    fixture.item.status = 'SUCCESS'
    fixture.item.backupDirectory = '/replace-backups/batch-1/item-1'
    await writeFile(path.join(fixture.root, 'replace-backups', 'batch-1', 'item-1', 'unexpected.txt'), 'keep-me')
    fixture.database.loadOperation = vi.fn().mockResolvedValue({
      systemJobId: 'job-1',
      batchId: 'batch-1',
      itemId: 'item-1',
      mode: 'RESTORE'
    })
    const restore = executionContext({ mode: 'RESTORE', batchId: 'batch-1', itemId: 'item-1' })
    await executePendingReplace(restore.context, fixture.dependencies)

    expect(await readFile(path.join(fixture.root, 'artworks', '123_p0.jpg'), 'utf8')).toBe('new-content')
    expect(
      await readFile(path.join(fixture.root, 'replace-backups', 'batch-1', 'item-1', 'unexpected.txt'), 'utf8')
    ).toBe('keep-me')
    expect(restore.scope.pause).toHaveBeenCalledWith(expect.objectContaining({ reason: 'ACTION_REQUIRED' }))
  })

  it('cleans only a fingerprint-verified backup after fenced DB reference validation', async () => {
    const fixture = await replacementFixture()
    await executePendingReplace(executionContext(fixture.payload).context, fixture.dependencies)
    fixture.item.status = 'SUCCESS'
    fixture.item.backupDirectory = '/replace-backups/batch-1/item-1'
    fixture.database.loadOperation = vi.fn().mockResolvedValue({
      systemJobId: 'job-1',
      batchId: 'batch-1',
      itemId: null,
      mode: 'CLEANUP'
    })
    const payload: PendingReplacePayloadV1 = { mode: 'CLEANUP', batchId: 'batch-1' }
    const cleanup = executionContext(payload)
    await executePendingReplace(cleanup.context, fixture.dependencies)

    await expect(
      stat(path.join(fixture.root, 'replace-backups', 'batch-1', 'item-1', '123_p0.jpg'))
    ).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect(fixture.database.assertMediaSnapshot).toHaveBeenCalledTimes(1)
    expect(fixture.statuses.at(-1)).toBe('BACKUP_CLEANED')
    expect(cleanup.scope.complete).toHaveBeenCalledTimes(1)
  })

  it('pauses for action and preserves a tampered backup during CLEANUP', async () => {
    const fixture = await replacementFixture()
    await executePendingReplace(executionContext(fixture.payload).context, fixture.dependencies)
    fixture.item.status = 'SUCCESS'
    fixture.item.backupDirectory = '/replace-backups/batch-1/item-1'
    await writeFile(path.join(fixture.root, 'replace-backups', 'batch-1', 'item-1', '123_p0.jpg'), 'tampered-old')
    fixture.database.loadOperation = vi.fn().mockResolvedValue({
      systemJobId: 'job-1',
      batchId: 'batch-1',
      itemId: null,
      mode: 'CLEANUP'
    })
    const cleanup = executionContext({ mode: 'CLEANUP', batchId: 'batch-1' })
    await executePendingReplace(cleanup.context, fixture.dependencies)
    expect(await readFile(path.join(fixture.root, 'replace-backups', 'batch-1', 'item-1', '123_p0.jpg'), 'utf8')).toBe(
      'tampered-old'
    )
    expect(cleanup.scope.pause).toHaveBeenCalledWith(expect.objectContaining({ reason: 'ACTION_REQUIRED' }))
    expect(fixture.database.assertMediaSnapshot).not.toHaveBeenCalled()
  })

  it('resumes CLEANING_BACKUP after the exact backup file was deleted before its DB checkpoint', async () => {
    const fixture = await replacementFixture()
    await executePendingReplace(executionContext(fixture.payload).context, fixture.dependencies)
    fixture.item.status = 'CLEANING_BACKUP'
    fixture.item.backupDirectory = '/replace-backups/batch-1/item-1'
    await unlink(path.join(fixture.root, 'replace-backups', 'batch-1', 'item-1', '123_p0.jpg'))
    fixture.database.loadOperation = vi.fn().mockResolvedValue({
      systemJobId: 'job-1',
      batchId: 'batch-1',
      itemId: null,
      mode: 'CLEANUP'
    })
    const cleanup = executionContext({ mode: 'CLEANUP', batchId: 'batch-1' })
    await executePendingReplace(cleanup.context, fixture.dependencies)
    expect(fixture.statuses.at(-1)).toBe('BACKUP_CLEANED')
    expect(cleanup.scope.complete).toHaveBeenCalledTimes(1)
  })

  it('preserves an unexpected backup entry and pauses cleanup for manual action', async () => {
    const fixture = await replacementFixture()
    await executePendingReplace(executionContext(fixture.payload).context, fixture.dependencies)
    fixture.item.status = 'SUCCESS'
    fixture.item.backupDirectory = '/replace-backups/batch-1/item-1'
    await writeFile(path.join(fixture.root, 'replace-backups', 'batch-1', 'item-1', 'unexpected.txt'), 'keep-me')
    fixture.database.loadOperation = vi.fn().mockResolvedValue({
      systemJobId: 'job-1',
      batchId: 'batch-1',
      itemId: null,
      mode: 'CLEANUP'
    })
    const cleanup = executionContext({ mode: 'CLEANUP', batchId: 'batch-1' })
    await executePendingReplace(cleanup.context, fixture.dependencies)
    expect(
      await readFile(path.join(fixture.root, 'replace-backups', 'batch-1', 'item-1', 'unexpected.txt'), 'utf8')
    ).toBe('keep-me')
    expect(cleanup.scope.pause).toHaveBeenCalledWith(expect.objectContaining({ reason: 'ACTION_REQUIRED' }))
  })

  it('persists DISCOVER items and queue completion in the same finalizer transaction', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-pending-discover-'))
    roots.push(root)
    await mkdir(path.join(root, 'pending-replaces', 'unbound'), { recursive: true })
    await writeFile(path.join(root, 'pending-replaces', 'unbound', 'image.jpg'), 'image')
    const database = baseDatabase()
    database.loadOperation = vi.fn().mockResolvedValue({
      systemJobId: 'job-1',
      batchId: 'batch-1',
      itemId: null,
      mode: 'DISCOVER'
    })
    const payload: PendingReplacePayloadV1 = { mode: 'DISCOVER', batchId: 'batch-1', sourceRoot: 'pending-replaces' }
    const { context, scope } = executionContext(payload)
    await executePendingReplace(context, {
      database,
      fileSystem: createNodePendingReplaceFileSystem(),
      config: { scanRoot: root }
    })

    expect(database.createDiscoveredItems).toHaveBeenCalledWith(
      scope.transaction,
      expect.objectContaining({ batchId: 'batch-1', items: [expect.objectContaining({ status: 'INVALID' })] })
    )
    expect(database.createDiscoveredItems).toHaveBeenCalledBefore(scope.complete)
  })

  it('lets a locked cancel win and atomically synchronizes the batch terminal', async () => {
    const database = baseDatabase()
    database.loadOperation = vi.fn().mockResolvedValue(null)
    const payload: PendingReplacePayloadV1 = { mode: 'CLEANUP', batchId: 'batch-1' }
    const { context, scope } = executionContext(payload, 'CANCELLING')
    await executePendingReplace(context, {
      database,
      fileSystem: createNodePendingReplaceFileSystem(),
      config: { scanRoot: path.resolve('/unused') }
    })
    expect(database.checkpointBatch).toHaveBeenCalledWith(
      scope.transaction,
      expect.objectContaining({ batchId: 'batch-1', status: 'CANCELLED' })
    )
    expect(scope.cancel).toHaveBeenCalledTimes(1)
    expect(scope.fail).not.toHaveBeenCalled()
  })
})

async function replacementFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-pending-executor-'))
  roots.push(root)
  const pending = path.join(root, 'pending-replaces', 'source__ext-123')
  const target = path.join(root, 'artworks')
  await mkdir(pending, { recursive: true })
  await mkdir(target, { recursive: true })
  await writeFile(path.join(pending, 'incoming.jpg'), 'new-content')
  await writeFile(path.join(target, '123_p0.jpg'), 'old-content')
  const newDigest = sha256('new-content')
  const oldDigest = sha256('old-content')
  const manifest = [
    {
      name: 'incoming.jpg',
      size: 11,
      mtimeMs: 1,
      sha256: newDigest,
      kind: 'media' as const,
      targetName: '123_p0.jpg'
    }
  ]
  const item: PendingReplaceItemSnapshot = {
    id: 'item-1',
    batchId: 'batch-1',
    artworkId: 1,
    externalId: '123',
    artworkTitle: 'Artwork',
    artistName: 'Artist',
    sourceDirectory: '/pending-replaces/source__ext-123',
    sourceDirectoryName: 'source__ext-123',
    targetDirectory: '/artworks',
    status: 'READY',
    included: true,
    fingerprint: createManifestFingerprint(manifest),
    sourceManifest: manifest,
    oldMediaSnapshot: [
      {
        sourceName: '123_p0.jpg',
        targetName: '123_p0.jpg',
        path: '/artworks/123_p0.jpg',
        size: 11,
        databaseSize: 11,
        sha256: oldDigest,
        width: 1,
        height: 1,
        order: 0,
        mtimeMs: 1,
        mediaType: 'IMAGE'
      }
    ],
    newMediaSnapshot: [
      {
        sourceName: 'incoming.jpg',
        targetName: '123_p0.jpg',
        path: '/pending-replaces/source__ext-123/incoming.jpg',
        size: 11,
        sha256: newDigest,
        width: 1,
        height: 1,
        order: 0,
        mtimeMs: 1,
        mediaType: 'IMAGE'
      }
    ],
    targetFileSnapshot: [{ name: '123_p0.jpg', size: 11, mtimeMs: 1, sha256: oldDigest }],
    warnings: [],
    backupDirectory: null,
    completedDirectory: null
  }
  const statuses: string[] = []
  const database = baseDatabase()
  database.loadOperation = vi.fn().mockResolvedValue({
    systemJobId: 'job-1',
    batchId: 'batch-1',
    itemId: null,
    mode: 'BATCH'
  })
  database.loadItems = vi.fn().mockImplementation(async () => [item])
  database.checkpointItem = vi.fn(async (_transaction, checkpoint) => {
    statuses.push(checkpoint.status)
    item.status = checkpoint.status
    if (checkpoint.backupDirectory !== undefined) item.backupDirectory = checkpoint.backupDirectory
    if (checkpoint.completedDirectory !== undefined) item.completedDirectory = checkpoint.completedDirectory
  })
  database.publishReplacement = vi.fn(async (_transaction, input) => {
    statuses.push('ARCHIVING')
    item.status = 'ARCHIVING'
    item.backupDirectory = input.backupDirectory
    item.completedDirectory = input.completedDirectory
  })
  database.publishRestore = vi.fn(async () => {
    statuses.push('RESTORE_COMMITTED')
    item.status = 'RESTORE_COMMITTED'
  })
  database.countBatch = vi.fn().mockResolvedValue(counters())
  const payload: PendingReplacePayloadV1 = {
    mode: 'BATCH',
    batchId: 'batch-1',
    itemIds: ['item-1'],
    appendTagIds: []
  }
  return {
    root,
    item,
    statuses,
    payload,
    database,
    dependencies: { database, fileSystem: createNodePendingReplaceFileSystem(), config: { scanRoot: root } }
  }
}

function baseDatabase(): PendingReplaceDatabasePort {
  return {
    loadOperation: vi.fn(),
    loadBatch: vi.fn(),
    loadItems: vi.fn().mockResolvedValue([]),
    findArtworksByExternalIds: vi.fn().mockResolvedValue([]),
    createDiscoveredItems: vi.fn(),
    checkpointBatch: vi.fn(),
    checkpointItem: vi.fn(),
    publishReplacement: vi.fn(),
    publishRestore: vi.fn(),
    assertMediaSnapshot: vi.fn(),
    countBatch: vi.fn().mockResolvedValue(counters())
  }
}

function executionContext(
  payload: PendingReplacePayloadV1,
  executionStatus: 'RUNNING' | 'PAUSING' | 'CANCELLING' = 'RUNNING'
) {
  const scope = {
    transaction: {} as QueueSqlExecutor,
    executionStatus,
    controlStatus:
      executionStatus === 'RUNNING'
        ? 'CONTINUE'
        : executionStatus === 'PAUSING'
          ? 'PAUSE_REQUESTED'
          : 'CANCEL_REQUESTED',
    complete: vi.fn(),
    fail: vi.fn(),
    retry: vi.fn(),
    skip: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    release: vi.fn()
  } satisfies FencedExecutionTransaction
  const context = {
    job: { id: 'job-1', attempt: 1, maxAttempts: 3, executionToken: '00000000-0000-4000-8000-000000000001' },
    payload,
    signal: new AbortController().signal,
    progress: vi.fn(),
    enqueueChild: vi.fn(),
    mutateInTransaction: vi.fn((operation) => operation(scope.transaction)),
    finalizeInTransaction: vi.fn(async (operation) => {
      await operation(scope)
      return { kind: 'transactionally-finalized' as const }
    }),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  } as unknown as ExecutionContext<PendingReplacePayloadV1, EnqueuedChildJob>
  return { context, scope }
}

function counters(): PendingReplaceBatchCounters {
  return {
    totalItems: 1,
    readyItems: 0,
    invalidItems: 0,
    excludedItems: 0,
    succeededItems: 1,
    failedItems: 0,
    restoredItems: 0,
    backupBytes: 11
  }
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

async function arrangeReplacementPhase(
  fixture: Awaited<ReturnType<typeof replacementFixture>>,
  phase: 'STAGING' | 'BACKING_UP' | 'SWAPPING' | 'COMMITTING' | 'ARCHIVING'
) {
  const { rename } = await import('node:fs/promises')
  const work = path.join(fixture.root, '.replace-work', 'batch-1', 'item-1')
  await mkdir(work, { recursive: true })
  await rename(path.join(fixture.root, 'pending-replaces', 'source__ext-123'), path.join(work, 'source'))
  if (phase === 'STAGING') return
  await mkdir(path.join(work, 'normalized'))
  await rename(path.join(work, 'source', 'incoming.jpg'), path.join(work, 'normalized', '123_p0.jpg'))
  if (phase === 'BACKING_UP') return
  await mkdir(path.join(fixture.root, 'replace-backups', 'batch-1', 'item-1'), { recursive: true })
  await rename(
    path.join(fixture.root, 'artworks', '123_p0.jpg'),
    path.join(fixture.root, 'replace-backups', 'batch-1', 'item-1', '123_p0.jpg')
  )
  if (phase === 'SWAPPING') return
  await rename(path.join(work, 'normalized', '123_p0.jpg'), path.join(fixture.root, 'artworks', '123_p0.jpg'))
}
