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
import { createArchiveUploaderComparisonSnapshot, hashArchiveUploaderDiscoveryMetadata } from '../providers/e-hentai.js'
import { executeArchiveUploaderScan } from '../uploader-scan-executor.js'
import type { ArchiveUploaderProvider, ArchiveUploaderScanResult } from '../types.js'

const discovery = {
  gid: '200',
  titles: { display: 'Existing', aliases: [] },
  category: null,
  uploader: 'alice',
  thumbnailUrl: null,
  postedAt: null,
  fileCount: 1,
  fileSize: null,
  rating: null,
  expunged: false,
  tags: [],
  relationships: []
}

const scanResult: ArchiveUploaderScanResult = {
  items: [
    {
      providerKey: 'e-hentai',
      externalId: '300',
      canonicalUrl: 'https://e-hentai.org/g/300/token300/',
      title: 'New gallery',
      thumbnailUrl: null,
      uploaderName: 'alice',
      postedAt: null,
      metadataFingerprint: 'a'.repeat(64),
      comparisonSnapshot: createArchiveUploaderComparisonSnapshot({ ...discovery, gid: '300' })!,
      normalizedMetadata: { ...discovery, gid: '300' },
      relationships: []
    },
    {
      providerKey: 'e-hentai',
      externalId: '200',
      canonicalUrl: 'https://e-hentai.org/g/200/token200/',
      title: 'Existing',
      thumbnailUrl: null,
      uploaderName: 'alice',
      postedAt: null,
      metadataFingerprint: hashArchiveUploaderDiscoveryMetadata(discovery)!,
      comparisonSnapshot: createArchiveUploaderComparisonSnapshot(discovery)!,
      normalizedMetadata: discovery,
      relationships: []
    }
  ],
  nextCursor: 'older-cursor',
  reachedStop: false
}

describe('archive uploader scan executor', () => {
  it('persists classified results and advances initial latest/history cursors only on completion', async () => {
    const fixture = createFixture({ scanUploader: vi.fn(async () => scanResult) })

    const outcome = await executeArchiveUploaderScan(fixture.context, fixture.dependencies)

    expect(outcome).toEqual({ kind: 'transactionally-finalized' })
    expect(fixture.finalOutcome).toMatchObject({ kind: 'completed' })
    expect(fixture.createdItems.map(({ externalId, classification }) => ({ externalId, classification }))).toEqual([
      { externalId: '300', classification: 'NEW' },
      { externalId: '200', classification: 'ARCHIVED' }
    ])
    expect(fixture.sourceUpdates.at(-1)).toMatchObject({
      latestSeenExternalId: '300',
      historyCursor: 'older-cursor',
      incrementalCursor: null,
      incrementalHeadExternalId: null,
      displayName: 'alice'
    })
    expect(fixture.runUpdates.at(-1)).toMatchObject({ stopReason: 'LIMIT_REACHED' })
    expect(fixture.catalogUpserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          create: expect.objectContaining({
            sourceId: 'source-1',
            externalId: '200',
            classification: 'ARCHIVED',
            comparisonKnown: true,
            comparisonSnapshot: createArchiveUploaderComparisonSnapshot(discovery),
            comparisonFingerprint: hashArchiveUploaderDiscoveryMetadata(discovery),
            firstSeenAt: new Date('2026-09-02T04:00:00.000Z'),
            lastSeenAt: new Date('2026-09-02T04:00:00.000Z'),
            lastScanRunId: 'scan-run-1'
          })
        })
      ])
    )
  })

  it.each([
    { reachedStop: true, nextCursor: null, expected: 'WATERMARK_REACHED' },
    { reachedStop: false, nextCursor: null, expected: 'REMOTE_END' }
  ])(
    'persists $expected when the provider completes at that boundary',
    async ({ reachedStop, nextCursor, expected }) => {
      const fixture = createFixture({
        scanUploader: vi.fn(async () => ({ ...scanResult, reachedStop, nextCursor }))
      })

      await executeArchiveUploaderScan(fixture.context, fixture.dependencies)

      expect(fixture.runUpdates.at(-1)).toMatchObject({ status: 'COMPLETED', stopReason: expected })
    }
  )

  it('keeps every cursor unchanged when a recoverable provider failure schedules a retry', async () => {
    const fixture = createFixture({
      scanUploader: vi.fn(async () => {
        throw new ArchiveExecutorError('REMOTE_RATE_LIMITED', 'Provider limited', {
          recoverable: true,
          retryAfterMs: 5_000
        })
      })
    })

    await executeArchiveUploaderScan(fixture.context, fixture.dependencies)

    expect(fixture.finalOutcome).toMatchObject({ kind: 'retry', errorCode: 'RESOURCE_BUSY' })
    expect(fixture.runUpdates.at(-1)).toMatchObject({ status: 'RETRY_WAIT', errorCode: 'REMOTE_RATE_LIMITED' })
    expect(fixture.sourceUpdates).not.toContainEqual(
      expect.objectContaining({ latestSeenExternalId: expect.anything() })
    )
    expect(fixture.sourceUpdates).not.toContainEqual(expect.objectContaining({ historyCursor: expect.anything() }))
    expect(fixture.sourceUpdates).not.toContainEqual(expect.objectContaining({ incrementalCursor: expect.anything() }))
  })

  it('does not classify an older gallery as a replacement when a stored gallery replaces it', async () => {
    const olderResult: ArchiveUploaderScanResult = {
      items: [
        {
          providerKey: 'e-hentai',
          externalId: '100',
          canonicalUrl: 'https://e-hentai.org/g/100/token100/',
          title: 'Older gallery',
          thumbnailUrl: null,
          uploaderName: 'alice',
          postedAt: null,
          metadataFingerprint: 'b'.repeat(64),
          comparisonSnapshot: createArchiveUploaderComparisonSnapshot({ ...discovery, gid: '100' })!,
          normalizedMetadata: { ...discovery, gid: '100' },
          relationships: [
            {
              type: 'REPLACES',
              direction: 'INBOUND',
              providerKey: 'e-hentai',
              externalId: '200',
              canonicalUrl: 'https://e-hentai.org/g/200/token200/',
              locator: { gid: '200', token: 'token200' }
            }
          ]
        }
      ],
      nextCursor: null,
      reachedStop: false
    }
    const fixture = createFixture({
      scanUploader: vi.fn(async () => olderResult)
    })

    await executeArchiveUploaderScan(fixture.context, fixture.dependencies)

    expect(fixture.createdItems).toEqual([expect.objectContaining({ externalId: '100', classification: 'NEW' })])
  })

  it('classifies an unresolved active intake item by its submitted canonical URL', async () => {
    const fixture = createFixture({
      scanUploader: vi.fn(async () => scanResult),
      activeIntake: [
        {
          id: 'intake-300',
          externalId: null,
          submittedUrl: 'https://e-hentai.org/g/300/token300/',
          canonicalUrl: null
        }
      ]
    })

    await executeArchiveUploaderScan(fixture.context, fixture.dependencies)

    expect(fixture.createdItems.map(({ externalId, classification }) => ({ externalId, classification }))).toEqual([
      { externalId: '300', classification: 'ACTIVE' },
      { externalId: '200', classification: 'ARCHIVED' }
    ])
    expect(fixture.activeIntakeQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { submittedUrl: { in: ['https://e-hentai.org/g/300/token300/', 'https://e-hentai.org/g/200/token200/'] } }
          ])
        })
      })
    )
    expect(fixture.catalogUpserts).toContainEqual(
      expect.objectContaining({
        create: expect.objectContaining({
          externalId: '300',
          classification: 'NEW',
          lastIntakeItemId: 'intake-300'
        })
      })
    )
  })

  it('keeps a stable update recommendation while linking the active import observed by the scan', async () => {
    const updatedMetadata = { ...discovery, fileCount: 2 }
    const fixture = createFixture({
      scanUploader: vi.fn(async () => ({
        ...scanResult,
        items: [
          {
            ...scanResult.items[1]!,
            metadataFingerprint: hashArchiveUploaderDiscoveryMetadata(updatedMetadata)!,
            comparisonSnapshot: createArchiveUploaderComparisonSnapshot(updatedMetadata)!,
            normalizedMetadata: updatedMetadata
          }
        ]
      })),
      activeImports: [{ id: 'import-200', externalId: '200' }]
    })

    await executeArchiveUploaderScan(fixture.context, fixture.dependencies)

    expect(fixture.createdItems).toEqual([expect.objectContaining({ classification: 'ACTIVE' })])
    expect(fixture.catalogUpserts).toEqual([
      expect.objectContaining({
        update: expect.objectContaining({
          classification: 'POSSIBLE_UPDATE',
          changeReasons: [{ field: 'fileCount', message: '页数 1 → 2' }]
        }),
        create: expect.objectContaining({ lastArchiveImportId: 'import-200', lastOutcome: 'SUBMITTED' })
      })
    ])
    expect(fixture.catalogWorkflowUpdates).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({ lastArchiveImportId: 'import-200', lastOutcome: 'SUBMITTED' })
      })
    )
  })

  it('keeps an archived gallery archived when its historical snapshot is not comparable', async () => {
    const fixture = createFixture({
      scanUploader: vi.fn(async () => scanResult),
      storedNormalizedMetadata: { gid: '200', titles: discovery.titles }
    })

    await executeArchiveUploaderScan(fixture.context, fixture.dependencies)

    expect(fixture.createdItems).toContainEqual(
      expect.objectContaining({ externalId: '200', classification: 'ARCHIVED' })
    )
    expect(fixture.catalogUpserts).toContainEqual(
      expect.objectContaining({
        create: expect.objectContaining({
          externalId: '200',
          classification: 'ARCHIVED',
          comparisonKnown: false,
          changeReasons: []
        })
      })
    )
  })

  it('persists an explainable stable-metadata change for a possible update', async () => {
    const updatedMetadata = { ...discovery, fileCount: 2 }
    const updatedResult: ArchiveUploaderScanResult = {
      ...scanResult,
      items: [
        {
          ...scanResult.items[1]!,
          metadataFingerprint: hashArchiveUploaderDiscoveryMetadata(updatedMetadata)!,
          comparisonSnapshot: createArchiveUploaderComparisonSnapshot(updatedMetadata)!,
          normalizedMetadata: updatedMetadata
        }
      ]
    }
    const fixture = createFixture({ scanUploader: vi.fn(async () => updatedResult) })

    await executeArchiveUploaderScan(fixture.context, fixture.dependencies)

    expect(fixture.createdItems).toEqual([expect.objectContaining({ classification: 'POSSIBLE_UPDATE' })])
    expect(fixture.catalogUpserts[0]).toEqual(
      expect.objectContaining({
        update: expect.objectContaining({
          classification: 'POSSIBLE_UPDATE',
          comparisonKnown: true,
          changeReasons: [{ field: 'fileCount', message: '页数 1 → 2' }]
        })
      })
    )
  })
})

function createFixture(input: {
  scanUploader: ArchiveUploaderProvider['scanUploader']
  activeIntake?: Array<{
    id: string
    externalId: string | null
    submittedUrl: string
    canonicalUrl: string | null
  }>
  activeImports?: Array<{ id: string; externalId: string }>
  storedNormalizedMetadata?: unknown
}) {
  const runUpdates: Array<Record<string, unknown>> = []
  const sourceUpdates: Array<Record<string, unknown>> = []
  const createdItems: Array<Record<string, unknown>> = []
  const catalogUpserts: Array<Record<string, unknown>> = []
  const catalogWorkflowUpdates: Array<Record<string, unknown>> = []
  let finalOutcome: unknown = null
  const run = {
    id: 'scan-run-1',
    sourceId: 'source-1',
    systemJobId: 'uploader-job-1',
    mode: 'LATEST' as const,
    status: 'PENDING' as const,
    cursorBefore: null,
    source: {
      id: 'source-1',
      providerKey: 'e-hentai',
      identityKind: 'UID' as const,
      identityValue: '123',
      status: 'ACTIVE' as const,
      latestSeenExternalId: null,
      incrementalHeadExternalId: null
    }
  }
  const activeIntakeQuery = vi.fn(async (_args?: unknown) => input.activeIntake ?? [])
  const transaction = {
    archiveUploaderScanRun: {
      findUnique: vi.fn(async () => run),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        runUpdates.push(data)
        return { count: 1 }
      })
    },
    archiveUploaderSource: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        sourceUpdates.push(data)
        return { id: 'source-1' }
      }),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        sourceUpdates.push(data)
        return { count: 1 }
      })
    },
    archiveUploaderScanItem: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        createdItems.push(...data)
        return { count: data.length }
      })
    },
    archiveUploaderCatalogItem: {
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        catalogUpserts.push(args)
        return { id: `catalog-${catalogUpserts.length}` }
      }),
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        catalogWorkflowUpdates.push(args)
        return { count: 1 }
      })
    },
    archiveIntakeItem: {
      findMany: vi.fn(async (...args: unknown[]) => {
        await activeIntakeQuery(args[0])
        return (input.activeIntake ?? []).map((item) => ({
          ...item,
          status: 'QUEUED' as const,
          finishedAt: null,
          updatedAt: new Date('2026-09-02T03:30:00.000Z'),
          createdAt: new Date('2026-09-02T03:00:00.000Z'),
          errorCode: null,
          errorMessage: null
        }))
      })
    },
    archiveImport: {
      findMany: vi.fn(async () =>
        (input.activeImports ?? []).map((item) => ({
          ...item,
          status: 'RUNNING' as const,
          canonicalUrl: `https://e-hentai.org/g/${item.externalId}/token${item.externalId}/`,
          finishedAt: null,
          updatedAt: new Date('2026-09-02T03:45:00.000Z'),
          createdAt: new Date('2026-09-02T03:15:00.000Z'),
          errorCode: null,
          errorMessage: null
        }))
      )
    },
    artworkExternalRef: {
      findMany: vi.fn(async () => [
        {
          id: 'reference-200',
          externalId: '200',
          lastSuccessAt: new Date('2026-09-02T02:00:00.000Z'),
          updatedAt: new Date('2026-09-02T02:00:00.000Z'),
          createdAt: new Date('2026-09-02T02:00:00.000Z'),
          snapshots: [
            {
              normalizedMetadata: Object.hasOwn(input, 'storedNormalizedMetadata')
                ? input.storedNormalizedMetadata
                : discovery
            }
          ]
        }
      ])
    },
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn()
  }
  const provider: ArchiveUploaderProvider = {
    key: 'e-hentai',
    requestGovernance: 'PER_REQUEST',
    accepts: () => true,
    resolve: vi.fn(),
    openMedia: vi.fn(),
    scanUploader: input.scanUploader
  }
  const context = {
    job: claimedJob(),
    payload: { scanRunId: run.id },
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
        controlStatus: 'CONTINUE',
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
  } as unknown as ExecutionContext<{ scanRunId: string }, EnqueuedChildJob>

  return {
    context,
    dependencies: {
      database: {} as PrismaClient,
      providers: {
        get: () => provider,
        getForUrl: () => provider,
        getUploaderScanner: () => provider
      },
      now: () => new Date('2026-09-02T04:00:00.000Z')
    },
    runUpdates,
    sourceUpdates,
    createdItems,
    catalogUpserts,
    catalogWorkflowUpdates,
    activeIntakeQuery,
    get finalOutcome() {
      return finalOutcome
    }
  }
}

function claimedJob(): ClaimedJob {
  const now = new Date('2026-09-02T04:00:00.000Z')
  const executionToken = randomUUID()
  return {
    id: 'uploader-job-1',
    type: 'ARCHIVE_UPLOADER_SCAN',
    executionLane: 'ARCHIVE_RESOLVE',
    definitionVersion: 1,
    status: 'RUNNING',
    triggerSource: 'MANUAL',
    payload: { scanRunId: 'scan-run-1' },
    attempt: 1,
    maxAttempts: 3,
    effectivePriority: 20,
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
