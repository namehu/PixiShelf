import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createIntake: vi.fn(),
  cancelJob: vi.fn(),
  writeJobEvent: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/services/archive-intake/archive-intake-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/archive-intake/archive-intake-service')>()),
  createArchiveIntakeSubmissionInTransaction: mocks.createIntake
}))
vi.mock('@/services/background-task/job-event-service', () => ({ writeJobEvent: mocks.writeJobEvent }))
vi.mock('@/services/background-task/job-command-service', () => ({ cancelJobCommand: mocks.cancelJob }))

import {
  addArchiveUploaderScanItems,
  cancelArchiveUploaderScan,
  createArchiveUploaderSubmissionAttempt,
  createArchiveUploaderSource,
  ignoreArchiveUploaderScanItems,
  listArchiveUploaderIgnoredItems,
  listArchiveUploaderScanItems,
  matchArchiveUploaderUid,
  restoreArchiveUploaderIgnoredItems,
  safeArchiveUploaderThumbnailUrl,
  setArchiveUploaderUid,
  triggerArchiveUploaderScan
} from '../archive-uploader-service'

describe('archive uploader service', () => {
  beforeEach(() => {
    mocks.createIntake.mockReset()
    mocks.cancelJob.mockReset()
    mocks.writeJobEvent.mockReset()
  })

  it('issues submission attempt ids on the server', async () => {
    const uuid = vi.fn(() => '00000000-0000-4000-8000-000000000001')

    await expect(
      createArchiveUploaderSubmissionAttempt({ sourceId: 'source-1', itemIds: ['catalog-item-1'] }, { uuid })
    ).resolves.toEqual({ submissionAttemptId: '00000000-0000-4000-8000-000000000001' })
    expect(uuid).toHaveBeenCalledOnce()
  })

  it('canonicalizes a numeric UID before storing a reusable source', async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      id: 'source-1',
      status: 'ACTIVE',
      uploaderUid: data.uploaderUid ?? null,
      uidRevalidationRequiredAt: null,
      latestSeenExternalId: null,
      incrementalCursor: null,
      historyCursor: null,
      lastScanAt: null,
      lastSuccessAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: new Date('2026-09-02T00:00:00.000Z'),
      updatedAt: new Date('2026-09-02T00:00:00.000Z')
    }))

    const result = await createArchiveUploaderSource(
      { identityKind: 'UID', identityValue: '000123' },
      { database: { archiveUploaderSource: { create } } as never }
    )

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          identityValue: '123',
          normalizedIdentity: '123',
          uploaderUid: '123',
          displayName: 'UID 123'
        })
      })
    )
    expect(result).toMatchObject({
      identityValue: '123',
      uploaderUid: '123',
      uidBindingState: 'BOUND',
      hasPendingLatest: false,
      canContinueHistory: false
    })
    expect(result).not.toHaveProperty('incrementalCursor')
    expect(result).not.toHaveProperty('historyCursor')
  })

  it('creates a manually triggered resolver-lane job and binds the frozen source cursor in one transaction', async () => {
    const source = {
      id: 'source-1',
      providerKey: 'e-hentai',
      identityKind: 'NAME',
      identityValue: 'alice',
      uploaderUid: '123',
      uidRevalidationRequiredAt: null,
      normalizedIdentity: 'alice',
      displayName: 'alice',
      status: 'ACTIVE',
      latestSeenExternalId: '300',
      incrementalCursor: 'incremental-cursor',
      incrementalHeadExternalId: '400',
      historyCursor: 'history-cursor'
    }
    const systemJobCreate = vi.fn(async () => ({ id: 'job-1' }))
    const runCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      id: 'run-1',
      systemJobId: 'job-1',
      mode: 'LATEST',
      searchIdentityKind: data.searchIdentityKind,
      searchIdentityValue: data.searchIdentityValue,
      status: 'PENDING',
      itemCount: 0,
      newCount: 0,
      activeCount: 0,
      archivedCount: 0,
      possibleUpdateCount: 0,
      replacementCount: 0,
      startedAt: null,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      createdAt: new Date('2026-09-02T00:00:00.000Z'),
      updatedAt: new Date('2026-09-02T00:00:00.000Z')
    }))
    const transaction = {
      $queryRaw: vi.fn(async () => [{ lock: '' }]),
      archiveUploaderSource: { findUnique: vi.fn(async () => source), update: vi.fn(async () => source) },
      archiveUploaderScanRun: { findFirst: vi.fn(async () => null), create: runCreate },
      systemJob: { create: systemJobCreate }
    }
    const database = {
      $transaction: (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)
    }

    await triggerArchiveUploaderScan({ sourceId: source.id, mode: 'LATEST' }, 'admin-1', {
      database: database as never,
      now: () => new Date('2026-09-02T00:00:00.000Z'),
      uuid: vi.fn().mockReturnValueOnce('run-1').mockReturnValueOnce('job-1')
    })

    expect(systemJobCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'job-1',
        type: 'ARCHIVE_UPLOADER_SCAN',
        executionLane: 'ARCHIVE_RESOLVE',
        triggerSource: 'MANUAL',
        requestedByUserId: 'admin-1',
        payload: { scanRunId: 'run-1' }
      })
    })
    expect(runCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cursorBefore: 'incremental-cursor',
          searchIdentityKind: 'UID',
          searchIdentityValue: '123'
        })
      })
    )
    expect(mocks.writeJobEvent).toHaveBeenCalledOnce()
  })

  it('binds a NAME source to a canonical UID while preserving its durable records', async () => {
    const timestamp = new Date('2026-09-04T00:00:00.000Z')
    const source = {
      id: 'source-name',
      providerKey: 'e-hentai',
      identityKind: 'NAME' as const,
      identityValue: 'alice',
      normalizedIdentity: 'alice',
      uploaderUid: null,
      uidRevalidationRequiredAt: null,
      displayName: 'alice',
      status: 'ACTIVE' as const,
      latestSeenExternalId: '300',
      incrementalCursor: 'incremental',
      incrementalHeadExternalId: '400',
      historyCursor: 'history',
      lastScanAt: new Date('2026-09-03T00:00:00.000Z'),
      lastSuccessAt: new Date('2026-09-03T00:01:00.000Z'),
      lastErrorCode: 'OLD',
      lastErrorMessage: 'old error',
      lastRunId: 'run-old',
      createdAt: new Date('2026-09-02T00:00:00.000Z'),
      updatedAt: new Date('2026-09-03T00:01:00.000Z')
    }
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      ...source,
      ...data,
      updatedAt: timestamp
    }))
    const transaction = {
      $queryRaw: vi.fn(async () => [{ lock: '' }]),
      archiveUploaderSource: {
        findUnique: vi.fn(async () => source),
        findFirst: vi.fn(async () => null),
        update
      },
      archiveUploaderScanRun: { findFirst: vi.fn(async () => null) }
    }
    const database = {
      $transaction: (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)
    }

    const result = await setArchiveUploaderUid(
      { sourceId: source.id, uploaderUid: '000456' },
      { database: database as never, now: () => timestamp }
    )

    expect(result).toMatchObject({
      outcome: 'UPDATED',
      sourceId: source.id,
      uploaderUid: '456',
      source: { uidBindingState: 'REVALIDATION_REQUIRED' }
    })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: source.id },
        data: expect.objectContaining({
          uploaderUid: '456',
          uidRevalidationRequiredAt: timestamp,
          latestSeenExternalId: null,
          incrementalCursor: null,
          incrementalHeadExternalId: null,
          historyCursor: null,
          lastScanAt: null,
          lastSuccessAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastRunId: null
        })
      })
    )
    const updateData = update.mock.calls[0]?.[0].data
    expect(updateData).not.toHaveProperty('identityKind')
    expect(updateData).not.toHaveProperty('identityValue')
  })

  it('matches a NAME source UID without saving before explicit confirmation', async () => {
    const scanUploader = vi.fn(async () => ({
      items: [
        {
          externalId: '300',
          uploaderName: 'Alice'
        }
      ],
      nextCursor: null,
      reachedStop: false,
      discoveredUploaderUid: '456'
    }))
    const database = {
      archiveUploaderSource: {
        findUnique: vi.fn(async () => ({
          id: 'source-1',
          providerKey: 'e-hentai',
          identityKind: 'NAME',
          identityValue: 'alice',
          uploaderUid: null,
          displayName: 'alice',
          runs: []
        })),
        findFirst: vi.fn(async () => null),
        update: vi.fn()
      }
    }

    await expect(
      matchArchiveUploaderUid(
        { sourceId: 'source-1' },
        {
          database: database as never,
          uploaderProviders: { getUploaderScanner: () => ({ scanUploader }) } as never
        }
      )
    ).resolves.toEqual({
      outcome: 'MATCHED',
      sourceId: 'source-1',
      uploaderUid: '456',
      uploaderName: 'Alice',
      evidenceExternalId: '300'
    })
    expect(scanUploader).toHaveBeenCalledWith({
      identityKind: 'NAME',
      identityValue: 'alice',
      cursor: null,
      stopAtExternalId: null,
      limit: 1
    })
    expect(database.archiveUploaderSource.update).not.toHaveBeenCalled()
  })

  it('rejects UID changes while a scan is active', async () => {
    const source = { id: 'source-1', providerKey: 'e-hentai', uploaderUid: null }
    const update = vi.fn()
    const transaction = {
      $queryRaw: vi.fn(async () => [{ lock: '' }]),
      archiveUploaderSource: { findUnique: vi.fn(async () => source), update },
      archiveUploaderScanRun: { findFirst: vi.fn(async () => ({ id: 'run-active' })) }
    }
    const database = {
      $transaction: (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)
    }

    await expect(
      setArchiveUploaderUid({ sourceId: source.id, uploaderUid: '456' }, { database: database as never })
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(update).not.toHaveBeenCalled()
  })

  it.each(['0', '-1', '12x', '123456789012345678901'])('rejects invalid uploader UID %s', async (uploaderUid) => {
    const database = { $transaction: vi.fn() }

    await expect(
      setArchiveUploaderUid({ sourceId: 'source-1', uploaderUid }, { database: database as never })
    ).rejects.toThrow()
    expect(database.$transaction).not.toHaveBeenCalled()
  })

  it('treats rebinding the same canonical UID as an idempotent no-op', async () => {
    const source = { id: 'source-1', providerKey: 'e-hentai', uploaderUid: '456' }
    const update = vi.fn()
    const transaction = {
      $queryRaw: vi.fn(async () => [{ lock: '' }]),
      archiveUploaderSource: { findUnique: vi.fn(async () => source), update },
      archiveUploaderScanRun: { findFirst: vi.fn() }
    }
    const database = {
      $transaction: (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)
    }

    await expect(
      setArchiveUploaderUid({ sourceId: source.id, uploaderUid: '000456' }, { database: database as never })
    ).resolves.toEqual({ outcome: 'UNCHANGED', sourceId: source.id, uploaderUid: '456' })
    expect(transaction.archiveUploaderScanRun.findFirst).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('returns the existing source when a UID binding conflicts', async () => {
    const source = { id: 'source-1', providerKey: 'e-hentai', uploaderUid: null }
    const update = vi.fn()
    const transaction = {
      $queryRaw: vi.fn(async () => [{ lock: '' }]),
      archiveUploaderSource: {
        findUnique: vi.fn(async () => source),
        findFirst: vi.fn(async () => ({ id: 'source-existing' })),
        update
      },
      archiveUploaderScanRun: { findFirst: vi.fn(async () => null) }
    }
    const database = {
      $transaction: (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)
    }

    await expect(
      setArchiveUploaderUid({ sourceId: source.id, uploaderUid: '456' }, { database: database as never })
    ).resolves.toEqual({
      outcome: 'CONFLICT',
      sourceId: source.id,
      conflictingSourceId: 'source-existing',
      uploaderUid: '456'
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('turns a concurrent UID unique-constraint race into a conflict result', async () => {
    const database = {
      $transaction: vi.fn(async () => {
        throw { code: 'P2002' }
      }),
      archiveUploaderSource: {
        findUnique: vi.fn(async () => ({ id: 'source-1', providerKey: 'e-hentai' })),
        findFirst: vi.fn(async () => ({ id: 'source-existing' }))
      }
    }

    await expect(
      setArchiveUploaderUid({ sourceId: 'source-1', uploaderUid: '000456' }, { database: database as never })
    ).resolves.toEqual({
      outcome: 'CONFLICT',
      sourceId: 'source-1',
      conflictingSourceId: 'source-existing',
      uploaderUid: '456'
    })
  })

  it('paginates the source-wide deduplicated result feed without exposing canonical URLs', async () => {
    const firstCreatedAt = new Date('2026-09-02T02:00:00.000Z')
    const secondCreatedAt = new Date('2026-09-02T01:00:00.000Z')
    const database = {
      archiveUploaderSource: { findUnique: vi.fn(async () => ({ id: 'source-1' })) },
      $queryRaw: vi.fn(async () => [
        {
          id: 'catalog-item-2',
          sourceId: 'source-1',
          providerKey: 'e-hentai',
          externalId: '302',
          canonicalUrl: 'https://e-hentai.org/g/302/token302/',
          title: 'Gallery 302',
          thumbnailUrl: 'https://ehgt.org/thumb-302.jpg?token=private#fragment',
          uploaderName: 'Uploader',
          postedAt: firstCreatedAt,
          classification: 'NEW',
          comparisonKnown: true,
          changeReasons: [],
          intakeItemId: null,
          intakeStatus: null,
          archiveImportId: null,
          archiveImportStatus: null,
          artworkId: null,
          errorCode: null,
          errorMessage: null,
          firstSeenAt: firstCreatedAt,
          lastSeenAt: firstCreatedAt,
          workflowStage: 'NEW',
          workflowBucket: 'ACTIONABLE',
          recommendation: 'NEW',
          sortAt: firstCreatedAt
        },
        {
          id: 'catalog-item-1',
          sourceId: 'source-1',
          providerKey: 'e-hentai',
          externalId: '301',
          canonicalUrl: 'https://e-hentai.org/g/301/token301/',
          title: 'Gallery 301',
          thumbnailUrl: 'https://untrusted.example/thumb-301.jpg',
          uploaderName: 'Uploader',
          postedAt: secondCreatedAt,
          classification: 'ARCHIVED',
          comparisonKnown: true,
          changeReasons: [],
          intakeItemId: null,
          intakeStatus: null,
          archiveImportId: null,
          archiveImportStatus: null,
          artworkId: 1,
          errorCode: null,
          errorMessage: null,
          firstSeenAt: secondCreatedAt,
          lastSeenAt: secondCreatedAt,
          workflowStage: 'ARCHIVED',
          workflowBucket: 'ARCHIVED',
          recommendation: null,
          sortAt: secondCreatedAt
        }
      ])
    }

    const result = await listArchiveUploaderScanItems(
      { sourceId: 'source-1', limit: 1, direction: 'forward' },
      { database: database as never }
    )

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: 'catalog-item-2',
      externalId: '302',
      thumbnailUrl: 'https://ehgt.org/thumb-302.jpg'
    })
    expect(result.items[0]).not.toHaveProperty('canonicalUrl')
    expect(result.items[0]?.displayUrl).not.toContain('token302')
    expect(result.nextCursor).toEqual({
      sortAt: firstCreatedAt,
      lastSeenAt: firstCreatedAt,
      id: 'catalog-item-2'
    })
  })

  it('cancels the active system job bound to the requested uploader scan', async () => {
    const database = {
      archiveUploaderScanRun: {
        findFirst: vi.fn(async () => ({ id: 'run-1', systemJobId: 'job-1', status: 'RUNNING' }))
      }
    }
    mocks.cancelJob.mockResolvedValue({ id: 'job-1', status: 'CANCELLING' })

    await expect(
      cancelArchiveUploaderScan({ sourceId: 'source-1', runId: 'run-1' }, { database: database as never })
    ).resolves.toEqual({ id: 'run-1', status: 'CANCELLING' })
    expect(mocks.cancelJob).toHaveBeenCalledWith({ jobId: 'job-1' }, database)
  })

  it('accepts only redacted HTTPS thumbnail URLs from provider-owned hosts', () => {
    expect(safeArchiveUploaderThumbnailUrl('https://ehgt.org/thumb.jpg?token=private#fragment')).toBe(
      'https://ehgt.org/thumb.jpg'
    )
    expect(safeArchiveUploaderThumbnailUrl('https://cdn.hath.network/thumb.jpg')).toBe(
      'https://cdn.hath.network/thumb.jpg'
    )
    expect(safeArchiveUploaderThumbnailUrl('http://ehgt.org/thumb.jpg')).toBeNull()
    expect(safeArchiveUploaderThumbnailUrl('https://ehgt.org.example/thumb.jpg')).toBeNull()
    expect(safeArchiveUploaderThumbnailUrl('https://user:secret@ehgt.org/thumb.jpg')).toBeNull()
  })

  it('stores a durable globally unique ignored-gallery snapshot without its canonical token', async () => {
    const createMany = vi.fn(async (input: unknown) => {
      void input
      return { count: 1 }
    })
    const database = transactionalDatabase({
      archiveUploaderSource: {
        findUnique: vi.fn(async () => ({ id: 'source-1', displayName: 'Uploader' }))
      },
      archiveUploaderCatalogItem: {
        findMany: vi.fn(async () => [
          {
            id: 'catalog-item-1',
            sourceId: 'source-1',
            canonicalUrl: 'https://e-hentai.org/g/300/token300/',
            providerKey: 'e-hentai',
            externalId: '300',
            title: 'Gallery 300',
            thumbnailUrl: 'https://ehgt.org/thumb.jpg',
            uploaderName: 'Uploader',
            postedAt: new Date('2026-09-02T00:00:00.000Z'),
            classification: 'NEW',
            lastIntakeItemId: null,
            lastOutcome: null
          }
        ]),
        findFirst: vi.fn(async () => null)
      },
      archiveUploaderIgnoredItem: {
        createMany,
        findMany: vi.fn(async () => [{ id: 'ignored-1' }])
      }
    })

    await expect(
      ignoreArchiveUploaderScanItems({ sourceId: 'source-1', itemIds: ['catalog-item-1'] }, 'admin-1', {
        database: database as never
      })
    ).resolves.toEqual({ ignoredItemIds: ['ignored-1'], ignoredCount: 1, createdCount: 1, reusedCount: 0 })
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          providerKey: 'e-hentai',
          externalId: '300',
          sourceDisplayName: 'Uploader',
          ignoredByUserId: 'admin-1'
        })
      ],
      skipDuplicates: true
    })
    const createInput = createMany.mock.calls[0]?.[0] as { data: Array<Record<string, unknown>> }
    expect(createInput.data[0]).not.toHaveProperty('canonicalUrl')
  })

  it('rejects a global ignore while the globally linked workflow is still retained', async () => {
    const createMany = vi.fn()
    const database = transactionalDatabase({
      archiveUploaderSource: {
        findUnique: vi.fn(async () => ({ id: 'source-1', displayName: 'Uploader' }))
      },
      archiveUploaderCatalogItem: {
        findMany: vi.fn(async () => [
          {
            id: 'catalog-item-1',
            sourceId: 'source-1',
            canonicalUrl: 'https://e-hentai.org/g/300/token300/',
            providerKey: 'e-hentai',
            externalId: '300',
            title: 'Gallery 300',
            thumbnailUrl: null,
            uploaderName: 'Uploader',
            postedAt: null,
            classification: 'NEW',
            lastIntakeItemId: 'intake-item-other',
            lastOutcome: 'FAILED',
            lastOutcomeAt: new Date('2026-09-03T00:00:00.000Z')
          }
        ])
      },
      archiveUploaderIgnoredItem: { createMany }
    })

    await expect(
      ignoreArchiveUploaderScanItems({ sourceId: 'source-1', itemIds: ['catalog-item-1'] }, 'admin-1', {
        database: database as never
      })
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(createMany).not.toHaveBeenCalled()
  })

  it('paginates global ignored galleries and restores them idempotently', async () => {
    const ignoredAt = new Date('2026-09-02T02:00:00.000Z')
    const deleteMany = vi.fn(async () => ({ count: 1 }))
    const database = {
      archiveUploaderIgnoredItem: {
        findMany: vi.fn(async () => [
          {
            id: 'ignored-2',
            providerKey: 'e-hentai',
            externalId: '302',
            sourceDisplayName: 'Uploader',
            title: 'Gallery 302',
            thumbnailUrl: 'https://ehgt.org/thumb.jpg?secret=1',
            uploaderName: 'Uploader',
            postedAt: ignoredAt,
            ignoredAt
          },
          {
            id: 'ignored-1',
            providerKey: 'e-hentai',
            externalId: '301',
            sourceDisplayName: 'Uploader',
            title: 'Gallery 301',
            thumbnailUrl: null,
            uploaderName: 'Uploader',
            postedAt: ignoredAt,
            ignoredAt
          }
        ]),
        deleteMany
      }
    }

    const result = await listArchiveUploaderIgnoredItems(
      { limit: 1, direction: 'forward' },
      { database: database as never }
    )
    expect(result.items[0]).toMatchObject({ id: 'ignored-2', thumbnailUrl: 'https://ehgt.org/thumb.jpg' })
    expect(result.nextCursor).toEqual({ ignoredAt, id: 'ignored-2' })

    await expect(
      restoreArchiveUploaderIgnoredItems({ ignoredItemIds: ['ignored-2'] }, { database: database as never })
    ).resolves.toEqual({ restoredCount: 1 })
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['ignored-2'] } } })
  })

  it('adds only actionable results to the existing intake workflow and links its durable items', async () => {
    const catalogItems = [
      {
        id: 'catalog-item-1',
        sourceId: 'source-1',
        providerKey: 'e-hentai',
        externalId: '300',
        canonicalUrl: 'https://e-hentai.org/g/300/token300/',
        classification: 'NEW',
        lastIntakeItemId: null,
        lastOutcome: null
      }
    ]
    const linkUpdate = vi.fn(async () => catalogItems[0])
    const database = transactionalDatabase({
      archiveUploaderCatalogItem: {
        findMany: vi.fn(async () => catalogItems),
        updateMany: linkUpdate
      },
      archiveIntakeSubmission: { findUnique: vi.fn(async () => null) },
      archiveUploaderIgnoredItem: { findFirst: vi.fn(async () => null) },
      archiveIntakeItem: {
        findMany: vi.fn(async () => [{ id: 'intake-item-1', submittedUrl: 'https://e-hentai.org/g/300/token300/' }])
      }
    })
    mocks.createIntake.mockResolvedValue({
      id: 'submission-1',
      acceptedCount: 1,
      duplicateCount: 0,
      rejectedCount: 0
    })

    await addArchiveUploaderScanItems(
      {
        sourceId: 'source-1',
        itemIds: ['catalog-item-1'],
        submissionAttemptId: '00000000-0000-4000-8000-000000000001'
      },
      'admin-1',
      { database: database as never }
    )

    expect(mocks.createIntake).toHaveBeenCalledWith(
      expect.objectContaining({ urls: ['https://e-hentai.org/g/300/token300/'] }),
      'admin-1',
      database,
      expect.objectContaining({ now: undefined, uuid: undefined })
    )
    expect(linkUpdate).toHaveBeenCalledWith({
      where: { providerKey: 'e-hentai', externalId: '300' },
      data: expect.objectContaining({ lastIntakeItemId: 'intake-item-1', lastOutcome: 'SUBMITTED' })
    })
  })

  it('persists a duplicate intake audit item as attention instead of submitted', async () => {
    const canonicalUrl = 'https://e-hentai.org/g/300/token300/'
    const duplicateAt = new Date('2026-09-03T01:00:00.000Z')
    const linkUpdate = vi.fn(async () => ({ count: 1 }))
    const database = transactionalDatabase({
      archiveUploaderCatalogItem: {
        findMany: vi.fn(async () => [
          {
            id: 'catalog-item-1',
            sourceId: 'source-1',
            providerKey: 'e-hentai',
            externalId: '300',
            canonicalUrl,
            classification: 'NEW',
            lastIntakeItemId: null,
            lastOutcome: null
          }
        ]),
        updateMany: linkUpdate
      },
      archiveIntakeSubmission: { findUnique: vi.fn(async () => null) },
      archiveUploaderIgnoredItem: { findFirst: vi.fn(async () => null) },
      archiveIntakeItem: {
        findMany: vi.fn(async () => [
          { id: 'intake-duplicate', submittedUrl: canonicalUrl, status: 'DUPLICATE', updatedAt: duplicateAt }
        ])
      }
    })
    mocks.createIntake.mockResolvedValue({
      id: 'submission-duplicate',
      acceptedCount: 0,
      duplicateCount: 1,
      rejectedCount: 0
    })

    await addArchiveUploaderScanItems(
      {
        sourceId: 'source-1',
        itemIds: ['catalog-item-1'],
        submissionAttemptId: '00000000-0000-4000-8000-000000000001'
      },
      'admin-1',
      { database: database as never }
    )

    expect(linkUpdate).toHaveBeenCalledWith({
      where: { providerKey: 'e-hentai', externalId: '300' },
      data: expect.objectContaining({
        lastIntakeItemId: 'intake-duplicate',
        lastOutcome: 'DUPLICATE',
        lastOutcomeAt: duplicateAt,
        lastErrorCode: 'ACTIVE_DUPLICATE'
      })
    })
  })

  it('creates a new idempotent submission attempt after a capacity rejection', async () => {
    const canonicalUrl = 'https://e-hentai.org/g/300/token300/'
    const linkUpdate = vi.fn(async () => ({ count: 1 }))
    const intakeFindMany = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'intake-item-2', submittedUrl: canonicalUrl }])
    const findSubmissionAttempt = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'submission-rejected' })
      .mockResolvedValueOnce(null)
    const database = transactionalDatabase({
      archiveUploaderCatalogItem: {
        findMany: vi.fn(async () => [
          {
            id: 'catalog-item-1',
            sourceId: 'source-1',
            providerKey: 'e-hentai',
            externalId: '300',
            canonicalUrl,
            classification: 'NEW',
            lastIntakeItemId: null,
            lastOutcome: null
          }
        ]),
        updateMany: linkUpdate
      },
      archiveIntakeSubmission: { findUnique: findSubmissionAttempt },
      archiveUploaderIgnoredItem: { findFirst: vi.fn(async () => null) },
      archiveIntakeItem: { findMany: intakeFindMany }
    })
    mocks.createIntake
      .mockResolvedValueOnce({
        id: 'submission-rejected',
        acceptedCount: 0,
        duplicateCount: 0,
        rejectedCount: 1
      })
      .mockResolvedValueOnce({
        id: 'submission-rejected',
        acceptedCount: 0,
        duplicateCount: 0,
        rejectedCount: 1
      })
      .mockResolvedValueOnce({
        id: 'submission-accepted',
        acceptedCount: 1,
        duplicateCount: 0,
        rejectedCount: 0
      })
    const first = await addArchiveUploaderScanItems(
      {
        sourceId: 'source-1',
        itemIds: ['catalog-item-1'],
        submissionAttemptId: '00000000-0000-4000-8000-000000000001'
      },
      'admin-1',
      { database: database as never }
    )
    const second = await addArchiveUploaderScanItems(
      {
        sourceId: 'source-1',
        itemIds: ['catalog-item-1'],
        submissionAttemptId: '00000000-0000-4000-8000-000000000001'
      },
      'admin-1',
      { database: database as never }
    )
    const newAttempt = await addArchiveUploaderScanItems(
      {
        sourceId: 'source-1',
        itemIds: ['catalog-item-1'],
        submissionAttemptId: '00000000-0000-4000-8000-000000000002'
      },
      'admin-1',
      { database: database as never }
    )

    expect(first.rejectedCount).toBe(1)
    expect(second).toEqual(first)
    expect(newAttempt.acceptedCount).toBe(1)
    const firstKey = mocks.createIntake.mock.calls[0]?.[0].idempotencyKey
    const replayKey = mocks.createIntake.mock.calls[1]?.[0].idempotencyKey
    const secondKey = mocks.createIntake.mock.calls[2]?.[0].idempotencyKey
    expect(firstKey).toBe(replayKey)
    expect(firstKey).not.toBe(secondKey)
    expect(firstKey).toMatch(/00000000-0000-4000-8000-000000000001$/)
    expect(secondKey).toMatch(/00000000-0000-4000-8000-000000000002$/)
    expect(linkUpdate).toHaveBeenCalledOnce()
    expect(linkUpdate).toHaveBeenCalledWith({
      where: { providerKey: 'e-hentai', externalId: '300' },
      data: expect.objectContaining({ lastIntakeItemId: 'intake-item-2', lastOutcome: 'SUBMITTED' })
    })
  })

  it('replays the same server-issued attempt after a response is lost', async () => {
    const replayed = { id: 'submission-1', acceptedCount: 1, duplicateCount: 0, rejectedCount: 0 }
    const database = transactionalDatabase({
      archiveUploaderCatalogItem: {
        findMany: vi.fn(async () => [
          {
            id: 'catalog-item-1',
            sourceId: 'source-1',
            providerKey: 'e-hentai',
            externalId: '300',
            canonicalUrl: 'https://e-hentai.org/g/300/token300/',
            classification: 'NEW',
            lastIntakeItemId: 'intake-item-1',
            lastOutcome: 'SUBMITTED'
          }
        ])
      },
      archiveIntakeItem: {
        findMany: vi.fn(async () => [
          {
            id: 'intake-item-1',
            submissionId: 'submission-1',
            submission: { idempotencyKey: 'server-issued-attempt-1', requestedByUserId: 'admin-1' }
          }
        ])
      },
      archiveIntakeSubmission: { findUnique: vi.fn(async () => ({ id: 'submission-1' })) }
    })
    mocks.createIntake.mockResolvedValue(replayed)

    await expect(
      addArchiveUploaderScanItems(
        {
          sourceId: 'source-1',
          itemIds: ['catalog-item-1'],
          submissionAttemptId: '00000000-0000-4000-8000-000000000001'
        },
        'admin-1',
        { database: database as never }
      )
    ).resolves.toEqual(replayed)
    expect(mocks.createIntake).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/00000000-0000-4000-8000-000000000001$/),
        urls: ['https://e-hentai.org/g/300/token300/']
      }),
      'admin-1',
      database,
      expect.objectContaining({ now: undefined, uuid: undefined })
    )
  })

  it('rejects a new intake attempt for a globally ignored gallery', async () => {
    const database = transactionalDatabase({
      archiveUploaderCatalogItem: {
        findMany: vi.fn(async () => [
          {
            id: 'catalog-item-1',
            sourceId: 'source-1',
            providerKey: 'e-hentai',
            externalId: '300',
            canonicalUrl: 'https://e-hentai.org/g/300/token300/',
            classification: 'NEW',
            lastIntakeItemId: null,
            lastOutcome: null
          }
        ])
      },
      archiveIntakeSubmission: { findUnique: vi.fn(async () => null) },
      archiveUploaderIgnoredItem: { findFirst: vi.fn(async () => ({ id: 'ignored-1' })) }
    })

    await expect(
      addArchiveUploaderScanItems(
        {
          sourceId: 'source-1',
          itemIds: ['catalog-item-1'],
          submissionAttemptId: '00000000-0000-4000-8000-000000000001'
        },
        'admin-1',
        { database: database as never }
      )
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(mocks.createIntake).not.toHaveBeenCalled()
  })
})

function transactionalDatabase<T extends object>(delegates: T) {
  const defaults = {
    artworkExternalRef: { findMany: vi.fn(async () => []) },
    archiveIntakeItem: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    archiveImport: { findFirst: vi.fn(async () => null) },
    archiveUploaderCatalogItem: { findFirst: vi.fn(async () => null) }
  }
  const provided = delegates as typeof defaults
  const transaction = {
    ...defaults,
    ...delegates,
    artworkExternalRef: { ...defaults.artworkExternalRef, ...provided.artworkExternalRef },
    archiveIntakeItem: { ...defaults.archiveIntakeItem, ...provided.archiveIntakeItem },
    archiveImport: { ...defaults.archiveImport, ...provided.archiveImport },
    archiveUploaderCatalogItem: {
      ...defaults.archiveUploaderCatalogItem,
      ...provided.archiveUploaderCatalogItem
    },
    $queryRaw: vi.fn(async () => [{ lock: '' }])
  }
  const database = transaction as typeof transaction & {
    $transaction: (operation: (tx: typeof transaction) => Promise<unknown>) => Promise<unknown>
  }
  database.$transaction = (operation) => operation(database)
  return database
}
