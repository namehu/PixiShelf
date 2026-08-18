import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ArchiveMaintenancePayload } from '@pixishelf/job-contracts'
import {
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type EnqueuedChildJob,
  type ExecutionContext
} from '@pixishelf/job-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createArchiveMaintenanceExecutorRegistrations, executeArchiveMaintenance } from '../maintenance-executor.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('archive maintenance executor', () => {
  it('registers one strict v1 writer-lane maintenance job', () => {
    const registration = createArchiveMaintenanceExecutorRegistrations({
      database: {} as never,
      config: { scanRoot: '/archive' }
    })[0]!
    expect(registration).toMatchObject({
      jobType: 'ARCHIVE_MAINTENANCE',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: 1
    })
    expect(registration.parsePayload?.({ action: 'RESTORE_ARCHIVE', artworkId: 7 })).toEqual({
      action: 'RESTORE_ARCHIVE',
      artworkId: 7
    })
    expect(() => registration.parsePayload?.({ action: 'CLEAN_STAGING', artworkId: 7 })).toThrow()
  })

  it('removes staging and prepared revision paths before atomically clearing cleanup checkpoints', async () => {
    const root = await temporaryRoot()
    await writeFixture(root, '.archive-staging/import-1/file.txt')
    await writeFixture(root, 'sources/test/bucket/42/revisions/import-1/file.txt')
    const transaction = cleanTransaction()
    const context = executionContext({ action: 'CLEAN_STAGING', archiveImportId: 'import-1' }, transaction)

    await expect(
      executeArchiveMaintenance(context, { database: {} as never, config: { scanRoot: root } })
    ).resolves.toEqual(TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME)

    await expect(readFile(path.join(root, '.archive-staging/import-1/file.txt'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(readFile(path.join(root, 'sources/test/bucket/42/revisions/import-1/file.txt'))).rejects.toMatchObject(
      { code: 'ENOENT' }
    )
    expect(transaction.archiveImportItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stagedPath: null, attempts: 0 }) })
    )
    expect(transaction.archiveImport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cleanupRequestedAt: null }) })
    )
    expect(context.__scope.complete).toHaveBeenCalledOnce()
  })

  it.each([
    ['TRASH_ARCHIVE', 'TRASHING', 'TRASHED', 'sources/test/rev-1', '.trash/archive/7/rev-1'],
    ['RESTORE_ARCHIVE', 'RESTORING', 'ACTIVE', '.trash/archive/7/rev-1', 'sources/test/rev-1']
  ] as const)(
    'executes root-confined %s moves and fenced lifecycle finalization',
    async (action, state, finalState, source, target) => {
      const root = await temporaryRoot()
      await writeFixture(root, `${source}/media/file.jpg`)
      const transaction = artworkTransaction(state)
      const context = executionContext({ action, artworkId: 7 }, transaction)

      await expect(
        executeArchiveMaintenance(context, { database: {} as never, config: { scanRoot: root } })
      ).resolves.toEqual(TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME)

      await expect(readFile(path.join(root, target, 'media/file.jpg'), 'utf8')).resolves.toBe('fixture')
      await expect(readFile(path.join(root, source, 'media/file.jpg'))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(transaction.artwork.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ archiveLifecycleState: finalState }) })
      )
      if (action === 'RESTORE_ARCHIVE') {
        expect(transaction.archiveRevision.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({ data: { trashPath: null, trashedAt: null, purgeAfter: null } })
        )
      }
    }
  )

  it('re-enters a partially completed trash move after a crash without moving it twice', async () => {
    const root = await temporaryRoot()
    await writeFixture(root, 'sources/test/rev-1/media/file.jpg')
    const transaction = artworkTransaction('TRASHING')
    const crashed = executionContext({ action: 'TRASH_ARCHIVE', artworkId: 7 }, transaction, true)

    await expect(
      executeArchiveMaintenance(crashed, { database: {} as never, config: { scanRoot: root } })
    ).rejects.toThrow('crash after filesystem mutation')
    await expect(readFile(path.join(root, '.trash/archive/7/rev-1/media/file.jpg'), 'utf8')).resolves.toBe('fixture')

    const retry = executionContext({ action: 'TRASH_ARCHIVE', artworkId: 7 }, transaction)
    await expect(
      executeArchiveMaintenance(retry, { database: {} as never, config: { scanRoot: root } })
    ).resolves.toEqual(TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME)
    expect(retry.__scope.complete).toHaveBeenCalledOnce()
  })

  it('rejects a stale lifecycle before touching files', async () => {
    const root = await temporaryRoot()
    await writeFixture(root, 'sources/test/rev-1/media/file.jpg')
    const transaction = artworkTransaction('ACTIVE')
    const context = executionContext({ action: 'TRASH_ARCHIVE', artworkId: 7 }, transaction)

    await expect(
      executeArchiveMaintenance(context, { database: {} as never, config: { scanRoot: root } })
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    await expect(readFile(path.join(root, 'sources/test/rev-1/media/file.jpg'), 'utf8')).resolves.toBe('fixture')
    expect(context.finalizeInTransaction).not.toHaveBeenCalled()
  })

  it('cooperatively stops before a filesystem mutation when cancellation is already requested', async () => {
    const root = await temporaryRoot()
    await writeFixture(root, 'sources/test/rev-1/media/file.jpg')
    const transaction = artworkTransaction('TRASHING')
    const controller = new AbortController()
    controller.abort({ reason: 'CANCEL_REQUESTED' })
    const context = executionContext({ action: 'TRASH_ARCHIVE', artworkId: 7 }, transaction, false, controller.signal)

    await expect(
      executeArchiveMaintenance(context, { database: {} as never, config: { scanRoot: root } })
    ).rejects.toEqual({ reason: 'CANCEL_REQUESTED' })
    await expect(readFile(path.join(root, 'sources/test/rev-1/media/file.jpg'), 'utf8')).resolves.toBe('fixture')
    expect(context.mutateInTransaction).not.toHaveBeenCalled()
  })

  it('never follows a cleanup path outside the configured root', async () => {
    const root = await temporaryRoot()
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`)
    await writeFile(outside, 'keep')
    temporaryRoots.push(outside)
    const transaction = cleanTransaction({ stagingPath: '../outside.txt' })
    const context = executionContext({ action: 'CLEAN_STAGING', archiveImportId: 'import-1' }, transaction)

    await expect(
      executeArchiveMaintenance(context, { database: {} as never, config: { scanRoot: root } })
    ).rejects.toMatchObject({ code: 'MEDIA_INVALID' })
    await expect(readFile(outside, 'utf8')).resolves.toBe('keep')
  })

  it('never treats the configured storage root as a cleanup target', async () => {
    const root = await temporaryRoot()
    await writeFixture(root, 'keep.txt')
    const transaction = cleanTransaction({ stagingPath: '.' })
    const context = executionContext({ action: 'CLEAN_STAGING', archiveImportId: 'import-1' }, transaction)

    await expect(
      executeArchiveMaintenance(context, { database: {} as never, config: { scanRoot: root } })
    ).rejects.toMatchObject({ code: 'MEDIA_INVALID' })
    await expect(readFile(path.join(root, 'keep.txt'), 'utf8')).resolves.toBe('fixture')
  })

  it('permanently purges due archive trash and its database media rows outside the file transaction', async () => {
    const root = await temporaryRoot()
    await writeFixture(root, '.trash/archive/7/rev-1/media/file.jpg')
    await writeFixture(root, 'sources/test/rev-1/stale.txt')
    const transaction = purgeTransaction()
    const context = executionContext({ action: 'PURGE_ARCHIVE', artworkId: 7 }, transaction)

    await expect(
      executeArchiveMaintenance(context, {
        database: {} as never,
        config: { scanRoot: root },
        now: () => new Date('2026-08-19T00:00:00.000Z')
      })
    ).resolves.toEqual(TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME)

    await expect(readFile(path.join(root, '.trash/archive/7/rev-1/media/file.jpg'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(readFile(path.join(root, 'sources/test/rev-1/stale.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(transaction.image.deleteMany).toHaveBeenCalledWith({ where: { artworkId: 7 } })
    expect(transaction.artwork.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 7, archiveLifecycleState: 'TRASHED' }) })
    )
  })

  it('re-enters purge after a crash between file removal and fenced database deletion', async () => {
    const root = await temporaryRoot()
    await writeFixture(root, '.trash/archive/7/rev-1/media/file.jpg')
    const transaction = purgeTransaction()

    await expect(
      executeArchiveMaintenance(
        executionContext({ action: 'PURGE_ARCHIVE', artworkId: 7 }, transaction, true),
        {
          database: {} as never,
          config: { scanRoot: root },
          now: () => new Date('2026-08-19T00:00:00.000Z')
        }
      )
    ).rejects.toThrow('crash after filesystem mutation')
    await expect(readFile(path.join(root, '.trash/archive/7/rev-1/media/file.jpg'))).rejects.toMatchObject({
      code: 'ENOENT'
    })

    const retry = executionContext({ action: 'PURGE_ARCHIVE', artworkId: 7 }, transaction)
    await expect(
      executeArchiveMaintenance(retry, {
        database: {} as never,
        config: { scanRoot: root },
        now: () => new Date('2026-08-19T00:00:00.000Z')
      })
    ).resolves.toEqual(TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME)
    expect(transaction.artwork.deleteMany).toHaveBeenCalledOnce()
  })

  it('refuses purge traversal and symlink targets outside the archive root', async () => {
    const root = await temporaryRoot()
    const outside = await temporaryRoot()
    await writeFixture(outside, 'keep.txt')
    const traversal = purgeTransaction({ trashPath: '../outside' })
    await expect(
      executeArchiveMaintenance(executionContext({ action: 'PURGE_ARCHIVE', artworkId: 7 }, traversal), {
        database: {} as never,
        config: { scanRoot: root },
        now: () => new Date('2026-08-19T00:00:00.000Z')
      })
    ).rejects.toMatchObject({ code: 'MEDIA_INVALID' })

    await mkdir(path.join(root, '.trash/archive/7'), { recursive: true })
    await symlink(outside, path.join(root, '.trash/archive/7/rev-1'))
    const linked = purgeTransaction()
    await expect(
      executeArchiveMaintenance(executionContext({ action: 'PURGE_ARCHIVE', artworkId: 7 }, linked), {
        database: {} as never,
        config: { scanRoot: root },
        now: () => new Date('2026-08-19T00:00:00.000Z')
      })
    ).rejects.toMatchObject({ code: 'MEDIA_INVALID' })
    await expect(readFile(path.join(outside, 'keep.txt'), 'utf8')).resolves.toBe('fixture')
  })

  it('reconciles expired staging, reuses active lifecycle work, and re-materializes terminal purge work', async () => {
    const transaction = reconcileTransaction()
    const context = executionContext({ action: 'RECONCILE' }, transaction)

    await expect(
      executeArchiveMaintenance(context, {
        database: {} as never,
        config: { scanRoot: '/archive' },
        now: () => new Date('2026-08-19T00:00:00.000Z')
      })
    ).resolves.toEqual(TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME)

    expect(context.enqueueChild).toHaveBeenCalledTimes(2)
    expect(context.enqueueChild).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { action: 'CLEAN_STAGING', archiveImportId: 'expired-import' },
        idempotencyKey: expect.stringContaining('archive-maintenance:CLEAN_STAGING:expired-import:')
      })
    )
    expect(context.enqueueChild).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { action: 'PURGE_ARCHIVE', artworkId: 8 },
        idempotencyKey: expect.stringContaining('archive-maintenance:PURGE_ARCHIVE:8:')
      })
    )
    expect(context.__scope.complete).toHaveBeenCalledWith({
      result: { action: 'RECONCILE', discovered: 3, materialized: 2, reused: 1, skipped: 0 },
      message: 'Archive maintenance reconciliation completed'
    })
  })

  it('fails reconciliation when candidate discovery has an unexpected database error', async () => {
    const transaction = reconcileTransaction()
    transaction.archiveImport.findMany.mockRejectedValueOnce(new Error('database unavailable'))
    const context = executionContext({ action: 'RECONCILE' }, transaction)

    await expect(
      executeArchiveMaintenance(context, {
        database: {} as never,
        config: { scanRoot: '/archive' },
        now: () => new Date('2026-08-19T00:00:00.000Z')
      })
    ).rejects.toThrow('database unavailable')

    expect(context.enqueueChild).not.toHaveBeenCalled()
    expect(context.finalizeInTransaction).not.toHaveBeenCalled()
  })
})

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-archive-maintenance-'))
  temporaryRoots.push(root)
  return root
}

async function writeFixture(root: string, relativePath: string) {
  const target = path.join(root, relativePath)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, 'fixture')
}

function cleanTransaction(overrides: { stagingPath?: string } = {}) {
  const archiveImport = {
    id: 'import-1',
    stagingPath: overrides.stagingPath ?? '.archive-staging/import-1',
    providerKey: 'test',
    creatorBucket: 'bucket',
    externalId: '42',
    cleanupRequestedAt: new Date('2026-08-18T00:00:00.000Z'),
    status: 'FAILED',
    systemJob: { id: 'import-job' }
  }
  return {
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    archiveImport: {
      findUnique: vi.fn().mockResolvedValue(archiveImport),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    archiveImportItem: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }
  }
}

function artworkTransaction(state: 'ACTIVE' | 'TRASHING' | 'RESTORING') {
  const artwork = {
    id: 7,
    createdVia: 'URL_ARCHIVE',
    archiveLifecycleState: state,
    deletedAt: new Date('2026-08-18T00:00:00.000Z'),
    archiveRevisions: [{ id: 'rev-1', archivePath: 'sources/test/rev-1', trashPath: '.trash/archive/7/rev-1' }]
  }
  return {
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    artwork: {
      findUnique: vi.fn().mockResolvedValue(artwork),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    archiveRevision: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }
  }
}

function purgeTransaction(overrides: { trashPath?: string } = {}) {
  const artwork = {
    id: 7,
    createdVia: 'URL_ARCHIVE',
    archiveLifecycleState: 'TRASHED',
    deletedAt: new Date('2026-08-18T00:00:00.000Z'),
    archiveRevisions: [
      {
        id: 'rev-1',
        archivePath: 'sources/test/rev-1',
        trashPath: overrides.trashPath ?? '.trash/archive/7/rev-1',
        purgeAfter: new Date('2026-08-18T12:00:00.000Z')
      }
    ]
  }
  return {
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    artwork: {
      findUnique: vi.fn().mockResolvedValue(artwork),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    image: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) }
  }
}

function reconcileTransaction() {
  const expired = {
    id: 'expired-import',
    status: 'FAILED',
    cleanupRequestedAt: null,
    retainUntil: new Date('2026-08-18T00:00:00.000Z')
  }
  const lifecycle = {
    id: 7,
    createdVia: 'URL_ARCHIVE',
    archiveLifecycleState: 'TRASHING',
    deletedAt: new Date('2026-08-18T00:00:00.000Z'),
    updatedAt: new Date('2026-08-18T00:00:00.000Z'),
    archiveRevisions: [
      {
        id: 'rev-7',
        trashPath: '.trash/archive/7/rev-7',
        purgeAfter: new Date('2026-08-25T00:00:00.000Z')
      }
    ]
  }
  const purge = {
    ...lifecycle,
    id: 8,
    archiveLifecycleState: 'TRASHED',
    archiveRevisions: [
      {
        id: 'rev-8',
        trashPath: '.trash/archive/8/rev-8',
        purgeAfter: new Date('2026-08-18T00:00:00.000Z')
      }
    ]
  }
  return {
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    archiveImport: {
      findMany: vi.fn().mockResolvedValue([{ id: expired.id }]),
      findUnique: vi.fn().mockResolvedValue(expired),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    artwork: {
      findMany: vi.fn().mockResolvedValue([
        { id: lifecycle.id, archiveLifecycleState: lifecycle.archiveLifecycleState },
        { id: purge.id, archiveLifecycleState: purge.archiveLifecycleState }
      ]),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === lifecycle.id ? lifecycle : purge)
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    systemJob: {
      findFirst: vi.fn().mockImplementation(({ where }: { where: { payload: { equals: { action: string } } } }) =>
        Promise.resolve(where.payload.equals.action === 'TRASH_ARCHIVE' ? { id: 'active-trash' } : null)
      )
    }
  }
}

function executionContext<TPayload extends ArchiveMaintenancePayload>(
  payload: TPayload,
  transaction: any,
  crash = false,
  signal = new AbortController().signal
) {
  const scope = {
    transaction,
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn(),
    pause: vi.fn(),
    cancel: vi.fn(),
    release: vi.fn()
  }
  const context = {
    job: { id: 'maintenance-job', attempt: 1 },
    payload,
    signal,
    progress: vi.fn().mockResolvedValue(undefined),
    enqueueChild: vi.fn().mockResolvedValue({ id: 'child-job', created: true }),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    mutateInTransaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction)),
    finalizeInTransaction: vi.fn(async (operation: (value: unknown) => Promise<void>) => {
      if (crash) throw new Error('crash after filesystem mutation')
      await operation(scope)
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    }),
    __scope: scope
  }
  return context as unknown as ExecutionContext<ArchiveMaintenancePayload, EnqueuedChildJob> & {
    __scope: typeof scope
  }
}
