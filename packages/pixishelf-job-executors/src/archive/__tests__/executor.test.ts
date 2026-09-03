import { PassThrough } from 'node:stream'
import type { Prisma } from '@pixishelf/db'
import {
  JobExecutionFenceError,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type EnqueuedChildJob,
  type ExecutionContext,
  type ExecutionProgressUpdate,
  type FencedExecutionTransaction
} from '@pixishelf/job-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { publishMock, storageMocks } = vi.hoisted(() => ({
  publishMock: vi.fn(),
  storageMocks: {
    buildArchiveStoragePaths: vi.fn(() => ({
      scanRootAbsolutePath: 'D:/archive',
      stagingRelativePath: '.archive-staging/import-1',
      stagingAbsolutePath: 'D:/archive/.archive-staging/import-1',
      finalRelativePath: 'sources/test/bucket/42/revisions/import-1',
      finalAbsolutePath: 'D:/archive/sources/test/bucket/42/revisions/import-1'
    })),
    pathExists: vi.fn(async () => false),
    prepareArchiveStagingDirectory: vi.fn(async () => 'D:/archive/.archive-staging/import-1'),
    prepareArchiveRevisionDirectory: vi.fn(async () => undefined),
    storeArchiveRemoteMedia: vi.fn(),
    validateArchiveStoredMedia: vi.fn(async () => undefined),
    writeArchiveManifest: vi.fn(async () => undefined)
  }
}))

vi.mock('../storage.js', () => storageMocks)
vi.mock('../publisher.js', () => ({ publishArchiveImportInTransaction: publishMock }))

import { createArchiveExecutorRegistrations, executeArchiveImport } from '../executor.js'
import { ArchiveExecutorError } from '../errors.js'
import { DefaultArchiveMediaProviderRegistry } from '../provider-registry.js'
import {
  GovernedArchiveProviderRegistry,
  type ArchiveProviderGovernor,
  type ArchiveProviderPermit
} from '../provider-governor.js'
import type { ArchiveProvider } from '../types.js'

const archiveImport = {
  id: 'import-1',
  systemJobId: 'job-1',
  providerKey: 'test',
  externalId: '42',
  externalRefId: null,
  submittedUrl: 'https://example.test/gallery/42',
  canonicalUrl: 'https://example.test/gallery/42',
  locator: {},
  status: 'PENDING' as const,
  requestedQuality: 'ORIGINAL' as const,
  selectedQuality: 'ORIGINAL' as const,
  decisionCode: null,
  normalizedMetadata: { titles: { display: 'Archive' }, relationships: [] },
  rawMetadata: {},
  metadataHash: 'a'.repeat(64),
  creatorBucket: 'bucket',
  stagingPath: '.archive-staging/import-1',
  totalItems: 0,
  completedItems: 0,
  failedItems: 0,
  warning: null,
  errorCode: null,
  errorMessage: null,
  publishedArtworkId: null,
  startedAt: null,
  finishedAt: null,
  retainUntil: null,
  cleanupRequestedAt: null,
  createdAt: new Date('2026-08-14T00:00:00.000Z'),
  updatedAt: new Date('2026-08-14T00:00:00.000Z'),
  items: []
}

const archiveItem = {
  id: 'item-1',
  archiveImportId: 'import-1',
  pageIndex: 0,
  sourcePageUrl: 'https://example.test/page/1',
  locator: {},
  expectedFilename: '001.jpg',
  status: 'PENDING' as const,
  attempts: 0,
  stagedPath: null,
  byteCount: null,
  mimeType: null,
  quality: null,
  width: null,
  height: null,
  sha256: null,
  errorCode: null,
  errorMessage: null,
  errorStage: null,
  remoteHost: null,
  startedAt: null,
  finishedAt: null,
  createdAt: new Date('2026-08-14T00:00:00.000Z'),
  updatedAt: new Date('2026-08-14T00:00:00.000Z')
}

const completedArchiveItem = {
  ...archiveItem,
  status: 'COMPLETED' as const,
  attempts: 1,
  stagedPath: 'media/001.jpg',
  byteCount: BigInt(128),
  mimeType: 'image/jpeg',
  quality: 'ORIGINAL' as const,
  width: 100,
  height: 100,
  sha256: 'b'.repeat(64)
}

describe('archive executor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    publishMock.mockResolvedValue({ artworkId: 42, revisionId: 'import-1', archivePath: 'sources/test/42' })
  })

  afterEach(() => vi.useRealTimers())

  it('registers backward-compatible ARCHIVE_IMPORT v1 and frozen-default-tag v2 executors', () => {
    const registrations = createArchiveExecutorRegistrations(dependencies(createTransaction()))
    expect(registrations).toHaveLength(2)
    expect(registrations[0]).toMatchObject({ jobType: 'ARCHIVE_IMPORT', definitionVersion: 1 })
    expect(registrations[0]!.parsePayload?.({ archiveImportId: 'import-1' })).toEqual({
      archiveImportId: 'import-1',
      defaultTagIds: []
    })
    expect(registrations[1]).toMatchObject({ jobType: 'ARCHIVE_IMPORT', definitionVersion: 2 })
    expect(registrations[1]!.parsePayload?.({ archiveImportId: 'import-1', defaultTagIds: [5, 2] })).toEqual({
      archiveImportId: 'import-1',
      defaultTagIds: [2, 5]
    })
    expect(() => registrations[0]!.parsePayload?.({ archiveImportId: '' })).toThrow()
  })

  it('reads and freezes database media concurrency under the shared advisory lock', async () => {
    const transaction = createTransaction()
    const context = createContext(transaction)
    const base = dependencies(transaction)
    const executorDependencies = {
      ...base,
      config: { scanRoot: base.config.scanRoot, maxMediaAttempts: base.config.maxMediaAttempts }
    }

    await executeArchiveImport(context, executorDependencies)

    expect(transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock(hashtextextended'),
      'pixishelf:archive-media-concurrency'
    )
    expect(transaction.setting.findUnique).toHaveBeenCalledWith({
      where: { key: 'archive_media_concurrency' },
      select: { value: true }
    })
    expect(transaction.$queryRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.setting.findUnique.mock.invocationCallOrder[0]!
    )
  })

  it('publishes domain state and completes the queue in the same fenced transaction callback', async () => {
    const order: string[] = []
    const transaction = createTransaction()
    publishMock.mockImplementation(async () => {
      order.push('publish')
      return { artworkId: 42, revisionId: 'import-1', archivePath: 'sources/test/42' }
    })
    const context = createContext(transaction, order)

    await expect(executeArchiveImport(context, dependencies(transaction))).resolves.toEqual(
      TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    )

    expect(order).toEqual(['publish', 'complete'])
    expect(publishMock).toHaveBeenCalledWith(
      transaction,
      'import-1',
      expect.objectContaining({ stagingRelativePath: '.archive-staging/import-1' }),
      expect.any(Date),
      []
    )
    expect(context.finalizeInTransaction).toHaveBeenCalledOnce()
  })

  it('passes frozen v2 default tags into the fenced archive publication', async () => {
    const transaction = createTransaction()
    const context = createContext(transaction)
    context.payload.defaultTagIds = [2, 5]

    await executeArchiveImport(context, dependencies(transaction))

    expect(publishMock).toHaveBeenCalledWith(transaction, 'import-1', expect.any(Object), expect.any(Date), [2, 5])
  })

  it('reconciles stale aggregate counts from durable item checkpoints before execution', async () => {
    const transaction = createTransaction()
    transaction.archiveImport.findUnique.mockResolvedValue({
      ...archiveImport,
      totalItems: 1,
      completedItems: 0,
      items: [completedArchiveItem]
    })
    transaction.archiveImportItem.groupBy.mockResolvedValue([{ status: 'COMPLETED', _count: { _all: 1 } }])
    transaction.archiveImportItem.findMany.mockResolvedValue([completedArchiveItem])
    const context = createContext(transaction)

    await expect(executeArchiveImport(context, dependencies(transaction))).resolves.toEqual(
      TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    )

    expect(transaction.archiveImport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ completedItems: 1, failedItems: 0 })
      })
    )
  })

  it('increments the live aggregate in the same transaction as an item completion', async () => {
    const transaction = createTransaction()
    transaction.archiveImport.findUnique.mockResolvedValue({
      ...archiveImport,
      totalItems: 1,
      items: [archiveItem]
    })
    transaction.archiveImportItem.updateMany.mockResolvedValue({ count: 1 })
    transaction.archiveImportItem.groupBy.mockResolvedValue([{ status: 'COMPLETED', _count: { _all: 1 } }])
    transaction.archiveImportItem.findMany.mockResolvedValue([completedArchiveItem])
    transaction.archiveImport.update.mockResolvedValueOnce({ completedItems: 1 }).mockResolvedValue(undefined)
    storageMocks.storeArchiveRemoteMedia.mockResolvedValueOnce({
      relativePath: completedArchiveItem.stagedPath,
      byteCount: completedArchiveItem.byteCount,
      mimeType: completedArchiveItem.mimeType,
      width: completedArchiveItem.width,
      height: completedArchiveItem.height,
      sha256: completedArchiveItem.sha256
    })
    const stream = new PassThrough()
    const executorDependencies = dependencies(transaction)
    executorDependencies.providers = new DefaultArchiveMediaProviderRegistry([
      {
        key: 'test',
        openMedia: vi.fn(async () => ({
          stream,
          mimeType: 'image/jpeg',
          contentLength: 128,
          originalFilename: '001.jpg',
          quality: 'ORIGINAL' as const,
          remoteHost: 'example.test'
        }))
      }
    ])
    const context = createContext(transaction)

    await expect(executeArchiveImport(context, executorDependencies)).resolves.toEqual(
      TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    )

    expect(transaction.archiveImport.update).toHaveBeenCalledWith({
      where: { id: 'import-1' },
      data: { completedItems: { increment: 1 } },
      select: { completedItems: true }
    })
    expect(context.progress).toHaveBeenCalledWith(expect.objectContaining({ message: '已下载 1/1', progress: 95 }))
  })

  it.each([
    ['PAUSING', 'PAUSED', 'pause'],
    ['CANCELLING', 'CANCELLED', 'cancel']
  ] as const)(
    'honors locked %s control before publishing domain state',
    async (executionStatus, archiveStatus, finalizer) => {
      const transaction = createTransaction()
      const context = createContext(transaction, [], new AbortController().signal, executionStatus)

      await expect(executeArchiveImport(context, dependencies(transaction))).resolves.toEqual(
        TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
      )

      expect(publishMock).not.toHaveBeenCalled()
      expect(transaction.archiveImport.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: archiveStatus }) })
      )
      expect(context.__scope[finalizer]).toHaveBeenCalledOnce()
      expect(context.__scope.complete).not.toHaveBeenCalled()
    }
  )

  it('does not attempt an ordinary or second terminal transition when fenced publication fails', async () => {
    const transaction = createTransaction()
    const context = createContext(transaction)
    publishMock.mockRejectedValueOnce(new Error('publisher fault injection'))

    await expect(executeArchiveImport(context, dependencies(transaction))).rejects.toThrow('publisher fault injection')

    expect(context.finalizeInTransaction).toHaveBeenCalledOnce()
  })

  it('releases a claimed import without changing domain state when staging cleanup won the race', async () => {
    const transaction = createTransaction()
    transaction.archiveImport.findUnique.mockResolvedValue({
      ...archiveImport,
      cleanupRequestedAt: new Date('2026-08-18T00:00:00.000Z')
    })
    const context = createContext(transaction)

    await expect(executeArchiveImport(context, dependencies(transaction))).resolves.toEqual(
      TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    )

    expect(context.__scope.release).toHaveBeenCalledWith('归档导入恢复前将先执行清理')
    expect(context.__scope.fail).not.toHaveBeenCalled()
    expect(transaction.archiveImport.updateMany).not.toHaveBeenCalled()
    expect(storageMocks.prepareArchiveStagingDirectory).not.toHaveBeenCalled()
  })

  it('atomically cancels the ArchiveImport when cancellation arrives before domain startup', async () => {
    const transaction = createTransaction()
    const controller = new AbortController()
    controller.abort({ reason: 'CANCEL_REQUESTED' })
    const context = createContext(transaction, [], controller.signal)

    await expect(executeArchiveImport(context, dependencies(transaction))).resolves.toEqual(
      TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    )

    expect(transaction.archiveImport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) })
    )
    expect(transaction.archiveUploaderCatalogItem.updateMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { lastArchiveImportId: 'import-1' },
          { providerKey: archiveImport.providerKey, externalId: archiveImport.externalId }
        ]
      },
      data: expect.objectContaining({
        lastArchiveImportId: 'import-1',
        lastOutcome: 'CANCELLED',
        lastErrorCode: 'CANCELLED',
        lastErrorMessage: '归档导入已取消'
      })
    })
    expect(context.__scope.cancel).toHaveBeenCalledWith('归档导入已取消')
    expect(transaction.archiveImport.findUnique).toHaveBeenCalledWith({
      where: { id: 'import-1' },
      select: { providerKey: true, externalId: true, canonicalUrl: true }
    })
  })

  it.each([
    ['PAUSE_REQUESTED', 'PAUSED', 'pause'],
    ['SHUTDOWN', 'PENDING', 'release']
  ] as const)('atomically handles %s with the shared lifecycle finalizer', async (reason, status, finalizer) => {
    const transaction = createTransaction()
    const controller = new AbortController()
    controller.abort({ reason })
    const context = createContext(transaction, [], controller.signal)

    await expect(executeArchiveImport(context, dependencies(transaction))).resolves.toEqual(
      TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    )

    expect(transaction.archiveImport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status }) })
    )
    expect(context.__scope[finalizer]).toHaveBeenCalledOnce()
  })

  it('atomically pauses when PAUSING rejects a checkpoint before the abort signal arrives', async () => {
    const transaction = createTransaction()
    transaction.archiveImport.findUnique.mockResolvedValue({
      ...archiveImport,
      totalItems: 1,
      items: [archiveItem]
    })
    const context = createContext(transaction, [], new AbortController().signal, 'PAUSING')
    vi.mocked(context.mutateInTransaction)
      .mockImplementationOnce(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction))
      .mockRejectedValue(new JobExecutionFenceError('job-1'))

    await expect(executeArchiveImport(context, dependencies(transaction))).resolves.toEqual(
      TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    )

    expect(transaction.archiveImport.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PAUSED' }) })
    )
    expect(context.__scope.pause).toHaveBeenCalledWith({
      reason: 'USER_REQUESTED',
      message: '归档导入已暂停'
    })
    expect(context.finalizeInTransaction).toHaveBeenCalledOnce()
  })

  it('atomically pauses a running import when provider action is required', async () => {
    const transaction = createTransaction()
    transaction.archiveImport.findUnique.mockResolvedValue({
      ...archiveImport,
      totalItems: 1,
      items: [archiveItem]
    })
    transaction.archiveImportItem.updateMany.mockResolvedValue({ count: 1 })
    const context = createContext(transaction)
    const executorDependencies = dependencies(transaction)
    executorDependencies.providers = new DefaultArchiveMediaProviderRegistry([
      {
        key: 'test',
        openMedia: vi.fn(async () => {
          throw new ArchiveExecutorError('ORIGINAL_UNAVAILABLE', 'Choose display quality to continue', {
            pause: true,
            recoverable: true,
            decisionCode: 'USE_DISPLAY_QUALITY'
          })
        })
      }
    ])

    await expect(executeArchiveImport(context, executorDependencies)).resolves.toEqual(
      TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    )

    expect(transaction.archiveImport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PAUSED',
          decisionCode: 'USE_DISPLAY_QUALITY',
          errorCode: 'ORIGINAL_UNAVAILABLE'
        })
      })
    )
    expect(context.__scope.pause).toHaveBeenCalledWith({
      reason: 'ACTION_REQUIRED',
      message: 'Choose display quality to continue',
      data: {
        errorCode: 'ORIGINAL_UNAVAILABLE',
        decisionCode: 'USE_DISPLAY_QUALITY'
      }
    })
    expect(context.finalizeInTransaction).toHaveBeenCalledOnce()
  })

  it('destroys an unconsumed remote stream so a local storage failure releases its provider permit', async () => {
    const transaction = createTransaction()
    transaction.archiveImport.findUnique.mockResolvedValue({
      ...archiveImport,
      totalItems: 1,
      items: [archiveItem]
    })
    transaction.archiveImportItem.updateMany.mockResolvedValue({ count: 1 })
    const context = createContext(transaction)
    const stream = new PassThrough()
    const permit: ArchiveProviderPermit = {
      id: 'download-permit-1',
      providerKey: 'test',
      requestClass: 'DOWNLOAD',
      renewAfterMs: 60_000
    }
    const governor = {
      acquire: vi.fn(async () => permit),
      renew: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
      penalize: vi.fn(async () => undefined)
    } satisfies ArchiveProviderGovernor
    const provider: ArchiveProvider = {
      key: 'test',
      requestGovernance: 'PER_REQUEST',
      accepts: () => true,
      resolve: vi.fn(),
      openMedia: vi.fn(async (_item, downloadContext) =>
        downloadContext.runDownloadStreamRequest!(async () => ({
          stream,
          mimeType: 'image/jpeg',
          contentLength: null,
          originalFilename: '001.jpg',
          quality: 'ORIGINAL' as const,
          remoteHost: 'example.test'
        }))
      )
    }
    storageMocks.storeArchiveRemoteMedia.mockRejectedValueOnce(
      new ArchiveExecutorError('STORAGE_FULL', 'local open failed', { recoverable: true, stage: 'STORAGE' })
    )
    const baseDependencies = dependencies(transaction)
    const executorDependencies = {
      ...baseDependencies,
      config: { ...baseDependencies.config, maxMediaAttempts: 1 },
      providers: new GovernedArchiveProviderRegistry(new DefaultArchiveMediaProviderRegistry([provider]), governor)
    }

    await executeArchiveImport(context, executorDependencies).catch(() => undefined)

    expect(stream.destroyed).toBe(true)
    expect(transaction.archiveImport.update).toHaveBeenCalledWith({
      where: { id: 'import-1' },
      data: { failedItems: { increment: 1 } },
      select: { failedItems: true }
    })
    await vi.waitFor(() => expect(governor.release).toHaveBeenCalledWith(permit))
  })

  it('aborts an in-flight remote stream when realtime progress loses its execution fence', async () => {
    vi.useFakeTimers()
    const transaction = createTransaction()
    transaction.archiveImport.findUnique.mockResolvedValue({
      ...archiveImport,
      totalItems: 1,
      items: [archiveItem]
    })
    transaction.archiveImportItem.updateMany.mockResolvedValue({ count: 1 })
    const stream = new PassThrough()
    stream.on('error', () => undefined)
    const executorDependencies = dependencies(transaction)
    executorDependencies.providers = new DefaultArchiveMediaProviderRegistry([
      {
        key: 'test',
        openMedia: vi.fn(async () => ({
          stream,
          mimeType: 'image/jpeg',
          contentLength: null,
          originalFilename: '001.jpg',
          quality: 'ORIGINAL' as const,
          remoteHost: 'example.test'
        }))
      }
    ])
    storageMocks.storeArchiveRemoteMedia.mockImplementationOnce(
      async ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const context = createContext(transaction)
    const fenceFailure = new JobExecutionFenceError('job-1')
    context.progress.mockImplementation(async (update) => {
      if (update.persistenceMode === 'REALTIME') throw fenceFailure
    })

    const execution = executeArchiveImport(context, executorDependencies)
    await vi.waitFor(() => expect(storageMocks.storeArchiveRemoteMedia).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(1_000)
    await execution.catch(() => undefined)

    expect(stream.destroyed).toBe(true)
    expect(context.progress).toHaveBeenCalledWith(expect.objectContaining({ persistenceMode: 'REALTIME' }))
  })

  it('performs no domain callback or terminal settlement after the execution fence is lost', async () => {
    const transaction = createTransaction()
    const context = createContext(transaction)
    context.mutateInTransaction = vi.fn(async () => {
      throw new JobExecutionFenceError('job-1')
    }) as never
    context.finalizeInTransaction.mockRejectedValueOnce(new JobExecutionFenceError('job-1'))

    await expect(executeArchiveImport(context, dependencies(transaction))).rejects.toBeInstanceOf(
      JobExecutionFenceError
    )

    expect(transaction.archiveImport.findUnique).not.toHaveBeenCalled()
    expect(transaction.archiveImport.updateMany).not.toHaveBeenCalled()
    expect(context.finalizeInTransaction).toHaveBeenCalledOnce()
    expect(context.__scope.fail).not.toHaveBeenCalled()
  })
})

function dependencies(transaction: ReturnType<typeof createTransaction>) {
  return {
    database: {
      $transaction: (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)
    } as never,
    config: { scanRoot: 'D:/archive', mediaConcurrency: 2, maxMediaAttempts: 3 },
    providers: new DefaultArchiveMediaProviderRegistry([{ key: 'test', openMedia: vi.fn() }]),
    now: () => new Date('2026-08-14T01:00:00.000Z'),
    random: () => 0,
    sleep: vi.fn(async () => undefined)
  }
}

function createTransaction() {
  return {
    $queryRawUnsafe: vi.fn(async () => [{ lock: null }]),
    setting: {
      findUnique: vi.fn(async () => ({ value: '4' }))
    },
    archiveImport: {
      findUnique: vi.fn(async () => archiveImport),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn()
    },
    archiveImportItem: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      groupBy: vi.fn(async () => []),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0)
    },
    archiveUploaderCatalogItem: {
      updateMany: vi.fn(async () => ({ count: 1 }))
    }
  } as unknown as Prisma.TransactionClient & {
    $queryRawUnsafe: ReturnType<typeof vi.fn>
    setting: { findUnique: ReturnType<typeof vi.fn> }
    archiveImport: {
      findUnique: ReturnType<typeof vi.fn>
      updateMany: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
    }
    archiveImportItem: {
      updateMany: ReturnType<typeof vi.fn>
      groupBy: ReturnType<typeof vi.fn>
      findMany: ReturnType<typeof vi.fn>
      count: ReturnType<typeof vi.fn>
    }
    archiveUploaderCatalogItem: { updateMany: ReturnType<typeof vi.fn> }
  }
}

function createContext(
  transaction: ReturnType<typeof createTransaction>,
  order: string[] = [],
  signal: AbortSignal = new AbortController().signal,
  executionStatus: 'RUNNING' | 'PAUSING' | 'CANCELLING' = 'RUNNING'
) {
  const scope = {
    transaction,
    executionStatus,
    controlStatus:
      executionStatus === 'CANCELLING'
        ? 'CANCEL_REQUESTED'
        : executionStatus === 'PAUSING'
          ? 'PAUSE_REQUESTED'
          : 'CONTINUE',
    complete: vi.fn(async () => {
      order.push('complete')
    }),
    fail: vi.fn(),
    retry: vi.fn(),
    skip: vi.fn(),
    pause: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
    cancel: vi.fn(async () => {
      order.push('cancel')
    })
  } as unknown as FencedExecutionTransaction<Prisma.TransactionClient>
  const context = {
    job: {
      id: 'job-1',
      type: 'ARCHIVE_IMPORT',
      definitionVersion: 1,
      status: 'RUNNING',
      triggerSource: 'MANUAL',
      payload: { archiveImportId: 'import-1', defaultTagIds: [] },
      attempt: 1,
      maxAttempts: 3,
      effectivePriority: 10,
      availableAt: new Date(),
      deadlineAt: null,
      workerId: 'worker-1',
      leaseToken: '11111111-1111-4111-8111-111111111111',
      leaseExpiresAt: new Date(Date.now() + 60_000),
      heartbeatAt: new Date(),
      startedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      executionToken: '11111111-1111-4111-8111-111111111111'
    },
    payload: { archiveImportId: 'import-1', defaultTagIds: [] },
    signal,
    progress: vi.fn(async () => undefined),
    enqueueChild: vi.fn(async () => ({ id: 'child', created: true })),
    mutateInTransaction: vi.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) =>
      operation(transaction)
    ),
    finalizeInTransaction: vi.fn(async (operation: (value: typeof scope) => Promise<void>) => {
      await operation(scope)
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    }),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    __scope: scope
  }
  return context as unknown as ExecutionContext<
    { archiveImportId: string; defaultTagIds: number[] },
    EnqueuedChildJob
  > & {
    finalizeInTransaction: ReturnType<typeof vi.fn>
    progress: ReturnType<typeof vi.fn<(update: ExecutionProgressUpdate) => Promise<void>>>
    __scope: typeof scope
  }
}
