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
  createArchiveUploaderSource,
  ignoreArchiveUploaderScanItems,
  listArchiveUploaderIgnoredItems,
  listArchiveUploaderScanItems,
  restoreArchiveUploaderIgnoredItems,
  safeArchiveUploaderThumbnailUrl,
  triggerArchiveUploaderScan
} from '../archive-uploader-service'

describe('archive uploader service', () => {
  beforeEach(() => {
    mocks.createIntake.mockReset()
    mocks.cancelJob.mockReset()
    mocks.writeJobEvent.mockReset()
  })

  it('canonicalizes a numeric UID before storing a reusable source', async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      id: 'source-1',
      status: 'ACTIVE',
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
        data: expect.objectContaining({ identityValue: '123', normalizedIdentity: '123', displayName: 'UID 123' })
      })
    )
    expect(result).toMatchObject({ identityValue: '123', hasPendingLatest: false, canContinueHistory: false })
    expect(result).not.toHaveProperty('incrementalCursor')
    expect(result).not.toHaveProperty('historyCursor')
  })

  it('creates a manually triggered resolver-lane job and binds the frozen source cursor in one transaction', async () => {
    const source = {
      id: 'source-1',
      providerKey: 'e-hentai',
      identityKind: 'UID',
      identityValue: '123',
      normalizedIdentity: '123',
      displayName: 'UID 123',
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
      expect.objectContaining({ data: expect.objectContaining({ cursorBefore: 'incremental-cursor' }) })
    )
    expect(mocks.writeJobEvent).toHaveBeenCalledOnce()
  })

  it('paginates the source-wide deduplicated result feed without exposing canonical URLs', async () => {
    const firstCreatedAt = new Date('2026-09-02T02:00:00.000Z')
    const secondCreatedAt = new Date('2026-09-02T01:00:00.000Z')
    const database = {
      archiveUploaderSource: { findUnique: vi.fn(async () => ({ id: 'source-1' })) },
      $queryRaw: vi.fn(async () => [
        {
          id: 'scan-item-2',
          externalId: '302',
          canonicalUrl: 'https://e-hentai.org/g/302/token302/',
          title: 'Gallery 302',
          thumbnailUrl: 'https://ehgt.org/thumb-302.jpg?token=private#fragment',
          uploaderName: 'Uploader',
          postedAt: firstCreatedAt,
          classification: 'NEW',
          intakeItemId: null,
          createdAt: firstCreatedAt,
          sortAt: firstCreatedAt
        },
        {
          id: 'scan-item-1',
          externalId: '301',
          canonicalUrl: 'https://e-hentai.org/g/301/token301/',
          title: 'Gallery 301',
          thumbnailUrl: 'https://untrusted.example/thumb-301.jpg',
          uploaderName: 'Uploader',
          postedAt: secondCreatedAt,
          classification: 'ARCHIVED',
          intakeItemId: null,
          createdAt: secondCreatedAt,
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
      id: 'scan-item-2',
      externalId: '302',
      thumbnailUrl: 'https://ehgt.org/thumb-302.jpg'
    })
    expect(result.items[0]).not.toHaveProperty('canonicalUrl')
    expect(result.items[0]?.displayUrl).not.toContain('token302')
    expect(result.nextCursor).toEqual({ sortAt: firstCreatedAt, createdAt: firstCreatedAt, id: 'scan-item-2' })
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
      archiveUploaderScanItem: {
        findMany: vi.fn(async () => [
          {
            id: 'scan-item-1',
            providerKey: 'e-hentai',
            externalId: '300',
            title: 'Gallery 300',
            thumbnailUrl: 'https://ehgt.org/thumb.jpg',
            uploaderName: 'Uploader',
            postedAt: new Date('2026-09-02T00:00:00.000Z'),
            classification: 'NEW',
            intakeItemId: null
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
      ignoreArchiveUploaderScanItems({ sourceId: 'source-1', itemIds: ['scan-item-1'] }, 'admin-1', {
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

  it('rejects a global ignore when another scan record for the Provider/GID is already linked', async () => {
    const createMany = vi.fn()
    const database = transactionalDatabase({
      archiveUploaderSource: {
        findUnique: vi.fn(async () => ({ id: 'source-1', displayName: 'Uploader' }))
      },
      archiveUploaderScanItem: {
        findMany: vi.fn(async () => [
          {
            id: 'scan-item-1',
            providerKey: 'e-hentai',
            externalId: '300',
            title: 'Gallery 300',
            thumbnailUrl: null,
            uploaderName: 'Uploader',
            postedAt: null,
            classification: 'NEW',
            intakeItemId: null
          }
        ]),
        findFirst: vi.fn(async () => ({ id: 'scan-item-other-source' }))
      },
      archiveUploaderIgnoredItem: { createMany }
    })

    await expect(
      ignoreArchiveUploaderScanItems({ sourceId: 'source-1', itemIds: ['scan-item-1'] }, 'admin-1', {
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
    const scanItems = [
      {
        id: 'scan-item-1',
        providerKey: 'e-hentai',
        externalId: '300',
        canonicalUrl: 'https://e-hentai.org/g/300/token300/',
        classification: 'NEW',
        intakeItemId: null
      }
    ]
    const linkUpdate = vi.fn(async () => ({ count: 1 }))
    const database = transactionalDatabase({
      archiveUploaderScanItem: {
        findMany: vi.fn(async () => scanItems),
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
        submissionAttemptId: '00000000-0000-4000-8000-000000000001',
        itemIds: ['scan-item-1']
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
      where: { id: 'scan-item-1', intakeItemId: null },
      data: { intakeItemId: 'intake-item-1' }
    })
  })

  it('creates a new idempotent submission attempt after a capacity rejection', async () => {
    const canonicalUrl = 'https://e-hentai.org/g/300/token300/'
    const linkUpdate = vi.fn(async () => ({ count: 1 }))
    const intakeFindMany = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'intake-item-2', submittedUrl: canonicalUrl }])
    const database = transactionalDatabase({
      archiveUploaderScanItem: {
        findMany: vi.fn(async () => [
          {
            id: 'scan-item-1',
            providerKey: 'e-hentai',
            externalId: '300',
            canonicalUrl,
            classification: 'NEW',
            intakeItemId: null
          }
        ]),
        updateMany: linkUpdate
      },
      archiveIntakeSubmission: { findUnique: vi.fn(async () => null) },
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
        id: 'submission-accepted',
        acceptedCount: 1,
        duplicateCount: 0,
        rejectedCount: 0
      })

    const first = await addArchiveUploaderScanItems(
      {
        sourceId: 'source-1',
        submissionAttemptId: '00000000-0000-4000-8000-000000000001',
        itemIds: ['scan-item-1']
      },
      'admin-1',
      { database: database as never }
    )
    const second = await addArchiveUploaderScanItems(
      {
        sourceId: 'source-1',
        submissionAttemptId: '00000000-0000-4000-8000-000000000002',
        itemIds: ['scan-item-1']
      },
      'admin-1',
      { database: database as never }
    )

    expect(first.rejectedCount).toBe(1)
    expect(second.acceptedCount).toBe(1)
    const firstKey = mocks.createIntake.mock.calls[0]?.[0].idempotencyKey
    const secondKey = mocks.createIntake.mock.calls[1]?.[0].idempotencyKey
    expect(firstKey).not.toBe(secondKey)
    expect(firstKey).toMatch(/00000000-0000-4000-8000-000000000001$/)
    expect(secondKey).toMatch(/00000000-0000-4000-8000-000000000002$/)
    expect(linkUpdate).toHaveBeenCalledOnce()
    expect(linkUpdate).toHaveBeenCalledWith({
      where: { id: 'scan-item-1', intakeItemId: null },
      data: { intakeItemId: 'intake-item-2' }
    })
  })

  it('replays the same submission attempt after its scan item has already been linked', async () => {
    const canonicalUrl = 'https://e-hentai.org/g/300/token300/'
    const database = transactionalDatabase({
      archiveUploaderScanItem: {
        findMany: vi.fn(async () => [
          {
            id: 'scan-item-1',
            providerKey: 'e-hentai',
            externalId: '300',
            canonicalUrl,
            classification: 'NEW',
            intakeItemId: 'intake-item-1'
          }
        ]),
        updateMany: vi.fn(async () => ({ count: 0 }))
      },
      archiveIntakeSubmission: { findUnique: vi.fn(async () => ({ id: 'submission-1' })) },
      archiveIntakeItem: {
        findMany: vi.fn(async () => [{ id: 'intake-item-1', submittedUrl: canonicalUrl }])
      }
    })
    mocks.createIntake.mockResolvedValue({
      id: 'submission-1',
      acceptedCount: 1,
      duplicateCount: 0,
      rejectedCount: 0
    })

    await expect(
      addArchiveUploaderScanItems(
        {
          sourceId: 'source-1',
          submissionAttemptId: '00000000-0000-4000-8000-000000000001',
          itemIds: ['scan-item-1']
        },
        'admin-1',
        { database: database as never }
      )
    ).resolves.toMatchObject({ id: 'submission-1', acceptedCount: 1 })
    expect(mocks.createIntake).toHaveBeenCalledOnce()
  })

  it('rejects a new submission attempt after its scan item has already been linked', async () => {
    const database = transactionalDatabase({
      archiveUploaderScanItem: {
        findMany: vi.fn(async () => [
          {
            id: 'scan-item-1',
            providerKey: 'e-hentai',
            externalId: '300',
            canonicalUrl: 'https://e-hentai.org/g/300/token300/',
            classification: 'NEW',
            intakeItemId: 'intake-item-1'
          }
        ])
      },
      archiveIntakeSubmission: { findUnique: vi.fn(async () => null) }
    })

    await expect(
      addArchiveUploaderScanItems(
        {
          sourceId: 'source-1',
          submissionAttemptId: '00000000-0000-4000-8000-000000000002',
          itemIds: ['scan-item-1']
        },
        'admin-1',
        { database: database as never }
      )
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(mocks.createIntake).not.toHaveBeenCalled()
  })

  it('rejects a new intake attempt for a globally ignored gallery', async () => {
    const database = transactionalDatabase({
      archiveUploaderScanItem: {
        findMany: vi.fn(async () => [
          {
            id: 'scan-item-1',
            providerKey: 'e-hentai',
            externalId: '300',
            canonicalUrl: 'https://e-hentai.org/g/300/token300/',
            classification: 'NEW',
            intakeItemId: null
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
          submissionAttemptId: '00000000-0000-4000-8000-000000000002',
          itemIds: ['scan-item-1']
        },
        'admin-1',
        { database: database as never }
      )
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(mocks.createIntake).not.toHaveBeenCalled()
  })
})

function transactionalDatabase<T extends object>(delegates: T) {
  const transaction = Object.assign(delegates, {
    $queryRaw: vi.fn(async () => [{ lock: '' }])
  })
  return Object.assign(transaction, {
    $transaction: (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)
  })
}
