import type { Prisma } from '@pixishelf/db'
import {
  JobExecutionFenceError,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type EnqueuedChildJob,
  type ExecutionContext,
  type FencedExecutionTransaction
} from '@pixishelf/job-runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { publishMock, storageMocks } = vi.hoisted(() => ({
  publishMock: vi.fn(),
  storageMocks: {
    buildArchiveStoragePaths: vi.fn(() => ({
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

describe('archive executor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    publishMock.mockResolvedValue({ artworkId: 42, revisionId: 'import-1', archivePath: 'sources/test/42' })
  })

  it('exports only the ARCHIVE_IMPORT v1 registration', () => {
    const registrations = createArchiveExecutorRegistrations(dependencies(createTransaction()))
    expect(registrations).toHaveLength(1)
    expect(registrations[0]).toMatchObject({ jobType: 'ARCHIVE_IMPORT', definitionVersion: 1 })
    expect(registrations[0]!.parsePayload?.({ archiveImportId: 'import-1' })).toEqual({ archiveImportId: 'import-1' })
    expect(() => registrations[0]!.parsePayload?.({ archiveImportId: '' })).toThrow()
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
      expect.any(Date)
    )
    expect(context.finalizeInTransaction).toHaveBeenCalledOnce()
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
    expect(context.__scope.cancel).toHaveBeenCalledWith('Archive import cancelled')
    expect(transaction.archiveImport.findUnique).not.toHaveBeenCalled()
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

  it('performs no domain callback or terminal settlement after the execution fence is lost', async () => {
    const transaction = createTransaction()
    const context = createContext(transaction)
    context.mutateInTransaction = vi.fn(async () => {
      throw new JobExecutionFenceError('job-1')
    }) as never

    await expect(executeArchiveImport(context, dependencies(transaction))).rejects.toBeInstanceOf(
      JobExecutionFenceError
    )

    expect(transaction.archiveImport.findUnique).not.toHaveBeenCalled()
    expect(transaction.archiveImport.updateMany).not.toHaveBeenCalled()
    expect(context.finalizeInTransaction).not.toHaveBeenCalled()
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
    }
  } as unknown as Prisma.TransactionClient & {
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
      payload: { archiveImportId: 'import-1' },
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
    payload: { archiveImportId: 'import-1' },
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
  return context as unknown as ExecutionContext<{ archiveImportId: string }, EnqueuedChildJob> & {
    finalizeInTransaction: ReturnType<typeof vi.fn>
    __scope: typeof scope
  }
}
