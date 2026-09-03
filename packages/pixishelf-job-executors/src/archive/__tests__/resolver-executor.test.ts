import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@pixishelf/db'
import type {
  ClaimedJob,
  EnqueuedChildJob,
  ExecutionContext,
  FencedExecutionTransaction,
  QueueSqlExecutor
} from '@pixishelf/job-runtime'
import { describe, expect, it, vi } from 'vitest'
import { ArchiveExecutorError } from '../errors.js'
import { executeArchiveResolveItem } from '../resolver-executor.js'
import type { ArchiveProvider, ResolvedArchive } from '../types.js'

const resolved: ResolvedArchive = {
  providerKey: 'test',
  externalId: 'gallery-1',
  canonicalUrl: 'https://example.test/g/gallery-1',
  locator: { id: 'gallery-1' },
  title: 'Resolved title',
  titleAliases: [],
  description: null,
  category: null,
  uploader: null,
  thumbnailUrl: 'https://example.test/thumb.jpg',
  postedAt: null,
  tags: [],
  relationships: [],
  media: [{ index: 0, sourcePageUrl: 'https://example.test/page/1', locator: {}, expectedFilename: '0001' }],
  normalizedMetadata: { title: 'Resolved title' },
  rawMetadata: { id: 'gallery-1' },
  warnings: [],
  creatorBucket: '_unknown'
}

describe('archive resolver executor', () => {
  it('atomically writes READY and completes the owning job', async () => {
    const fixture = createFixture({ providerResolve: vi.fn(async () => resolved) })

    const outcome = await executeArchiveResolveItem(fixture.context, fixture.dependencies)

    expect(outcome).toEqual({ kind: 'transactionally-finalized' })
    expect(fixture.finalOutcome).toMatchObject({ kind: 'completed' })
    expect(fixture.intakeUpdates.at(-1)).toMatchObject({
      status: 'READY',
      resolutionKind: 'NEW',
      resolvedTitle: 'Resolved title',
      pageCount: 1
    })
    expect(fixture.catalogUpdates.at(-1)).toMatchObject({ lastOutcome: 'SUBMITTED', lastErrorCode: null })
  })

  it('marks a different URL resolving to an existing intake identity as DUPLICATE', async () => {
    const fixture = createFixture({
      providerResolve: vi.fn(async () => resolved),
      duplicateItemId: 'intake-existing'
    })

    await executeArchiveResolveItem(fixture.context, fixture.dependencies)

    expect(fixture.finalOutcome).toMatchObject({ kind: 'completed' })
    expect(fixture.intakeUpdates.at(-1)).toMatchObject({
      status: 'DUPLICATE',
      resolutionKind: 'DUPLICATE_IDENTITY',
      duplicateOfItemId: 'intake-existing'
    })
    expect(fixture.catalogUpdates.at(-1)).toMatchObject({ lastOutcome: 'DUPLICATE', lastErrorCode: null })
  })

  it('classifies an already active archive import without creating another task', async () => {
    const fixture = createFixture({
      providerResolve: vi.fn(async () => resolved),
      activeArchiveImportId: 'archive-import-active'
    })

    await executeArchiveResolveItem(fixture.context, fixture.dependencies)

    expect(fixture.intakeUpdates.at(-1)).toMatchObject({
      status: 'READY',
      resolutionKind: 'ACTIVE_TASK',
      activeArchiveImportId: 'archive-import-active'
    })
  })

  it('moves a recoverable failure to the queue tail in the same transaction as job retry', async () => {
    const fixture = createFixture({
      providerResolve: vi.fn(async () => {
        throw new ArchiveExecutorError('REMOTE_RATE_LIMITED', 'Provider rate limited', {
          recoverable: true,
          retryAfterMs: 5_000
        })
      })
    })

    const outcome = await executeArchiveResolveItem(fixture.context, fixture.dependencies)

    expect(outcome).toEqual({ kind: 'transactionally-finalized' })
    expect(fixture.finalOutcome).toMatchObject({ kind: 'retry', errorCode: 'RESOURCE_BUSY' })
    expect(fixture.retrySql).toContain("nextval(pg_get_serial_sequence('archive_intake_items', 'queueOrder'))")
  })

  it('honors an explicit provider Retry-After longer than the automatic backoff cap', async () => {
    const fixture = createFixture({
      providerResolve: vi.fn(async () => {
        throw new ArchiveExecutorError('REMOTE_RATE_LIMITED', 'Provider penalty', {
          recoverable: true,
          retryAfterMs: 120_000
        })
      })
    })

    await executeArchiveResolveItem(fixture.context, fixture.dependencies)

    expect(fixture.finalOutcome).toMatchObject({
      kind: 'retry',
      availableAt: new Date('2026-08-18T10:02:00.000Z')
    })
  })

  it('returns download-priority yield to RETRY_WAIT without exhausting the business retry budget', async () => {
    const fixture = createFixture({
      jobAttempt: 3,
      jobMaxAttempts: 3,
      providerResolve: vi.fn(async () => {
        throw new ArchiveExecutorError('REMOTE_RATE_LIMITED', 'Downloads have priority', {
          recoverable: true,
          retryAfterMs: 5_000,
          decisionCode: 'PROVIDER_DOWNLOAD_PRIORITY'
        })
      })
    })

    await executeArchiveResolveItem(fixture.context, fixture.dependencies)

    expect(fixture.finalOutcome).toMatchObject({
      kind: 'retry',
      errorCode: 'RESOURCE_BUSY',
      preserveAttempt: true
    })
  })

  it('keeps the full business failure budget across repeated download-priority yields', async () => {
    const downloadPriority = () =>
      new ArchiveExecutorError('REMOTE_RATE_LIMITED', 'Downloads have priority', {
        recoverable: true,
        retryAfterMs: 5_000,
        decisionCode: 'PROVIDER_DOWNLOAD_PRIORITY'
      })
    for (let yieldCount = 0; yieldCount < 2; yieldCount += 1) {
      const yielded = createFixture({
        jobAttempt: 1,
        jobMaxAttempts: 3,
        providerResolve: vi.fn(async () => {
          throw downloadPriority()
        })
      })
      await executeArchiveResolveItem(yielded.context, yielded.dependencies)
      expect(yielded.finalOutcome).toMatchObject({ kind: 'retry', preserveAttempt: true })
    }

    const firstBusinessFailure = createFixture({
      jobAttempt: 1,
      jobMaxAttempts: 3,
      providerResolve: vi.fn(async () => {
        throw new ArchiveExecutorError('REMOTE_RESPONSE_INVALID', 'Transient response', { recoverable: true })
      })
    })
    await executeArchiveResolveItem(firstBusinessFailure.context, firstBusinessFailure.dependencies)
    expect(firstBusinessFailure.finalOutcome).toMatchObject({ kind: 'retry' })
    expect(firstBusinessFailure.finalOutcome).not.toMatchObject({ preserveAttempt: true })
  })

  it('persists CANCELLED before acknowledging a cooperative cancellation', async () => {
    const fixture = createFixture({ providerResolve: vi.fn(async () => resolved), controlStatus: 'CANCEL_REQUESTED' })

    await executeArchiveResolveItem(fixture.context, fixture.dependencies)

    expect(fixture.finalOutcome).toEqual({ kind: 'cancelled' })
    expect(fixture.intakeUpdates.at(-1)).toMatchObject({ status: 'CANCELLED' })
    expect(fixture.catalogUpdates.at(-1)).toMatchObject({
      lastOutcome: 'CANCELLED',
      lastErrorCode: 'CANCELLED'
    })
  })

  it('persists a terminal resolver failure across linked and canonical catalog workflows', async () => {
    const fixture = createFixture({
      jobAttempt: 3,
      jobMaxAttempts: 3,
      providerResolve: vi.fn(async () => {
        throw new ArchiveExecutorError('REMOTE_RESPONSE_INVALID', 'Broken provider response')
      })
    })

    await executeArchiveResolveItem(fixture.context, fixture.dependencies)

    expect(fixture.finalOutcome).toMatchObject({ kind: 'failed' })
    expect(fixture.catalogUpdates).toEqual([
      expect.objectContaining({
        lastOutcome: 'FAILED',
        lastErrorCode: 'REMOTE_RESPONSE_INVALID',
        lastErrorMessage: 'Broken provider response'
      })
    ])
    expect(fixture.catalogWhere).toEqual([
      {
        OR: [{ lastIntakeItemId: 'intake-1' }, { canonicalUrl: 'https://example.test/g/gallery-1' }]
      }
    ])
  })
})

function createFixture(input: {
  providerResolve: ArchiveProvider['resolve']
  controlStatus?: 'CONTINUE' | 'PAUSE_REQUESTED' | 'CANCEL_REQUESTED'
  jobAttempt?: number
  jobMaxAttempts?: number
  duplicateItemId?: string
  activeArchiveImportId?: string
}) {
  const intakeUpdates: Array<Record<string, unknown>> = []
  const catalogUpdates: Array<Record<string, unknown>> = []
  const catalogWhere: Array<Record<string, unknown>> = []
  let retrySql = ''
  let finalOutcome: unknown = null
  const transaction = {
    archiveIntakeItem: {
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        intakeUpdates.push(data)
        return { count: 1 }
      }),
      findUniqueOrThrow: vi.fn(async () => ({ submittedUrl: 'https://example.test/g/gallery-1' })),
      findUnique: vi.fn(async () => ({
        providerKey: 'test',
        externalId: 'gallery-1',
        submittedUrl: 'https://example.test/g/gallery-1',
        canonicalUrl: 'https://example.test/g/gallery-1'
      })),
      findFirst: vi.fn(async () => (input.duplicateItemId ? { id: input.duplicateItemId } : null))
    },
    artworkExternalRef: { findUnique: vi.fn(async () => null) },
    archiveImport: {
      findFirst: vi.fn(async () => (input.activeArchiveImportId ? { id: input.activeArchiveImportId } : null))
    },
    archiveUploaderCatalogItem: {
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        catalogWhere.push(where)
        catalogUpdates.push(data)
        return { count: 1 }
      })
    },
    $queryRawUnsafe: vi.fn(async (query: string) => {
      retrySql = query
      return [{ id: 'intake-1' }]
    }),
    $executeRawUnsafe: vi.fn(async () => 1)
  }
  const provider: ArchiveProvider = {
    key: 'test',
    requestGovernance: 'PER_REQUEST',
    accepts: () => true,
    resolve: input.providerResolve,
    openMedia: vi.fn()
  }
  const job = claimedJob(input.jobAttempt, input.jobMaxAttempts)
  const context = {
    job,
    payload: { intakeItemId: 'intake-1' },
    signal: new AbortController().signal,
    progress: vi.fn(async () => undefined),
    enqueueChild: vi.fn(),
    mutateInTransaction: async (operation: (value: typeof transaction) => Promise<unknown>) => operation(transaction),
    finalizeInTransaction: async (
      operation: (scope: FencedExecutionTransaction<typeof transaction & QueueSqlExecutor>) => Promise<void>
    ) => {
      await operation({
        transaction: transaction as typeof transaction & QueueSqlExecutor,
        executionStatus: 'RUNNING',
        controlStatus: input.controlStatus ?? 'CONTINUE',
        complete: async (value = {}) => {
          finalOutcome = { kind: 'completed', ...value }
        },
        retry: async (value) => {
          finalOutcome = { kind: 'retry', ...value }
        },
        fail: async (value) => {
          finalOutcome = { kind: 'failed', ...value }
        },
        skip: async (value) => {
          finalOutcome = { kind: 'skipped', ...value }
        },
        cancel: async () => {
          finalOutcome = { kind: 'cancelled' }
        },
        pause: async () => {
          finalOutcome = { kind: 'paused' }
        },
        release: async () => {
          finalOutcome = { kind: 'released' }
        }
      })
      return { kind: 'transactionally-finalized' as const }
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  } as unknown as ExecutionContext<{ intakeItemId: string }, EnqueuedChildJob>

  return {
    context,
    dependencies: {
      database: {} as PrismaClient,
      providers: { get: () => provider, getForUrl: () => provider },
      now: () => new Date('2026-08-18T10:00:00.000Z')
    },
    intakeUpdates,
    catalogUpdates,
    catalogWhere,
    get retrySql() {
      return retrySql
    },
    get finalOutcome() {
      return finalOutcome
    }
  }
}

function claimedJob(attempt = 1, maxAttempts = 3): ClaimedJob {
  const executionToken = randomUUID()
  const now = new Date('2026-08-18T10:00:00.000Z')
  return {
    id: 'resolve-job-1',
    type: 'ARCHIVE_RESOLVE_ITEM',
    executionLane: 'ARCHIVE_RESOLVE',
    definitionVersion: 1,
    status: 'RUNNING',
    triggerSource: 'SYSTEM',
    payload: { intakeItemId: 'intake-1' },
    attempt,
    maxAttempts,
    effectivePriority: 100,
    availableAt: now,
    deadlineAt: null,
    workerId: 'worker-test',
    leaseToken: executionToken,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    heartbeatAt: now,
    startedAt: now,
    createdAt: now,
    updatedAt: now,
    executionToken
  }
}
