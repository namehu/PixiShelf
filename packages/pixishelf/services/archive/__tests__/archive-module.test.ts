import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchiveModule } from '../archive-module'

const { prismaMock, writeJobEventMock } = vi.hoisted(() => {
  const prismaMock = {
    artwork: { findUnique: vi.fn(), updateMany: vi.fn() },
    artworkExternalRef: { findUnique: vi.fn() },
    archiveRevision: { update: vi.fn() },
    archiveImport: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
    },
    archiveImportItem: { findFirst: vi.fn(), findMany: vi.fn(), groupBy: vi.fn(), updateMany: vi.fn() },
    archiveUploaderCatalogItem: { updateMany: vi.fn() },
    archivePreviewSession: { deleteMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    systemJob: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    jobResourceLease: { deleteMany: vi.fn() },
    $queryRawUnsafe: vi.fn(),
    $transaction: vi.fn()
  }
  return { prismaMock, writeJobEventMock: vi.fn() }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/services/background-task/job-event-service', () => ({ writeJobEvent: writeJobEventMock }))

describe('archive module', () => {
  const module = new ArchiveModule()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'false')
    prismaMock.artworkExternalRef.findUnique.mockReset()
    prismaMock.archiveImport.findUnique.mockReset()
    prismaMock.systemJob.findFirst.mockReset().mockResolvedValue(null)
    process.env.ARCHIVE_STORAGE_PATH = 'D:/archive-root'
    prismaMock.$transaction.mockImplementation(async (value: unknown) => {
      if (typeof value === 'function') return value(prismaMock)
      return Promise.all(value as Promise<unknown>[])
    })
    prismaMock.archivePreviewSession.deleteMany.mockResolvedValue({ count: 0 })
    prismaMock.systemJob.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.archiveImport.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.archiveUploaderCatalogItem.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.artwork.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.$queryRawUnsafe.mockResolvedValue([])
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.ARCHIVE_STORAGE_PATH
  })

  it('atomically cancels a queued central archive task and records the lifecycle event', async () => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    const task = {
      id: 'import-central',
      providerKey: 'test-provider',
      externalId: 'gallery-1',
      canonicalUrl: 'https://example.test/g/gallery-1',
      systemJobId: 'job-central',
      status: 'PENDING',
      cleanupRequestedAt: null,
      systemJob: { id: 'job-central', status: 'PENDING', attempt: 0, queuePriority: 10, maxAttempts: 3 }
    }
    prismaMock.archiveImport.findUnique
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(null)
    prismaMock.jobResourceLease.deleteMany.mockResolvedValue({ count: 0 })

    const result = await module.requestAction('import-central', 'CANCEL', { requestedByUserId: 'admin-1' })

    expect(result).toEqual({ taskId: 'import-central' })
    expect(result).not.toHaveProperty('errorMessage')
    expect(result).not.toHaveProperty('items')

    expect(prismaMock.systemJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-central', status: 'PENDING' },
        data: expect.objectContaining({ status: 'CANCELLED', cancelRequestedAt: expect.any(Date) })
      })
    )
    expect(prismaMock.archiveImport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED', finishedAt: expect.any(Date) }) })
    )
    expect(prismaMock.archiveUploaderCatalogItem.updateMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { lastArchiveImportId: 'import-central' },
          { providerKey: 'test-provider', externalId: 'gallery-1' }
        ]
      },
      data: expect.objectContaining({
        lastArchiveImportId: 'import-central',
        lastOutcome: 'CANCELLED',
        lastErrorCode: 'CANCELLED'
      })
    })
    expect(writeJobEventMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ jobId: 'job-central', type: 'job.cancelled' })
    )
  })

  it('resumes a legacy pause whose queue status settled before the archive status', async () => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    const task = {
      id: 'import-drifted',
      providerKey: 'test-provider',
      externalId: 'gallery-1',
      canonicalUrl: 'https://example.test/g/gallery-1',
      systemJobId: 'job-paused',
      status: 'RUNNING',
      cleanupRequestedAt: null,
      systemJob: { id: 'job-paused', status: 'PAUSED', attempt: 1, queuePriority: 10, maxAttempts: 3 }
    }
    prismaMock.archiveImport.findUnique.mockResolvedValueOnce(task).mockResolvedValueOnce(task)
    prismaMock.archiveImportItem.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.jobResourceLease.deleteMany.mockResolvedValue({ count: 1 })

    await expect(module.requestAction('import-drifted', 'RESUME', { requestedByUserId: 'admin-1' })).resolves.toEqual({
      taskId: 'import-drifted'
    })

    expect(prismaMock.systemJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING', pauseRequestedAt: null }) })
    )
    expect(prismaMock.archiveImportItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archiveImportId: 'import-drifted', status: { not: 'COMPLETED' } } })
    )
    expect(prismaMock.archiveImport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) })
    )
    expect(writeJobEventMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ jobId: 'job-paused', type: 'job.queued', data: { reason: 'RESUME' } })
    )
  })

  it('does not treat a genuinely running archive task as a recoverable paused drift', async () => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    prismaMock.archiveImport.findUnique.mockResolvedValue({
      id: 'import-running',
      systemJobId: 'job-running',
      status: 'RUNNING',
      cleanupRequestedAt: null,
      systemJob: { id: 'job-running', status: 'RUNNING', attempt: 1, queuePriority: 10, maxAttempts: 3 }
    })

    await expect(
      module.requestAction('import-running', 'RESUME', { requestedByUserId: 'admin-1' })
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT', message: '任务状态 RUNNING 不允许执行 RESUME' })

    expect(prismaMock.systemJob.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.archiveImport.updateMany).not.toHaveBeenCalled()
  })

  it('retries a terminal central archive task as a new linked SystemJob', async () => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    const task = {
      id: 'import-central',
      providerKey: 'test-provider',
      externalId: 'gallery-1',
      canonicalUrl: 'https://example.test/g/gallery-1',
      systemJobId: 'job-failed',
      status: 'FAILED',
      cleanupRequestedAt: null,
      completedItems: 1,
      failedItems: 1,
      totalItems: 2,
      systemJob: {
        id: 'job-failed',
        status: 'FAILED',
        attempt: 3,
        queuePriority: 10,
        maxAttempts: 3,
        definitionVersion: 2,
        payload: { archiveImportId: 'import-central', defaultTagIds: [2, 5] }
      }
    }
    prismaMock.archiveImport.findUnique
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(null)
    prismaMock.archiveImportItem.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.systemJob.create.mockResolvedValue({ id: 'job-retry' })

    await module.requestAction('import-central', 'RETRY', { requestedByUserId: 'admin-1' })

    expect(prismaMock.systemJob.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.systemJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'ARCHIVE_IMPORT',
        definitionVersion: 2,
        status: 'PENDING',
        triggerSource: 'RETRY',
        requestedByUserId: 'admin-1',
        parentJobId: 'job-failed',
        payload: { archiveImportId: 'import-central', defaultTagIds: [2, 5] }
      })
    })
    const retryJobId = prismaMock.systemJob.create.mock.calls[0]![0].data.id
    expect(prismaMock.archiveImport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ systemJobId: retryJobId, status: 'PENDING' }) })
    )
    expect(prismaMock.archiveUploaderCatalogItem.updateMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { lastArchiveImportId: 'import-central' },
          { providerKey: 'test-provider', externalId: 'gallery-1' }
        ]
      },
      data: expect.objectContaining({
        lastArchiveImportId: 'import-central',
        lastOutcome: 'SUBMITTED',
        lastErrorCode: null,
        lastErrorMessage: null
      })
    })
    expect(writeJobEventMock).toHaveBeenCalledTimes(2)
  })

  it('atomically records cleanup intent and queues one central archive maintenance job', async () => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    const task = {
      id: 'import-central',
      systemJobId: 'job-failed',
      status: 'FAILED',
      cleanupRequestedAt: null,
      systemJob: { id: 'job-failed', status: 'FAILED', attempt: 1 }
    }
    prismaMock.archiveImport.findUnique
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(null)
    prismaMock.systemJob.findUnique.mockResolvedValue(null)

    await module.requestAction('import-central', 'DELETE_STAGING', { requestedByUserId: 'admin-1' })

    expect(prismaMock.archiveImport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'import-central', cleanupRequestedAt: null }),
        data: expect.objectContaining({ cleanupRequestedAt: expect.any(Date), updatedAt: expect.any(Date) })
      })
    )
    expect(prismaMock.systemJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'ARCHIVE_MAINTENANCE',
        executionLane: 'BACKGROUND_WRITER',
        requestedByUserId: 'admin-1',
        parentJobId: 'job-failed',
        queuePriority: 0,
        effectivePriority: 0,
        payload: { action: 'CLEAN_STAGING', archiveImportId: 'import-central' }
      })
    })
    expect(writeJobEventMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        type: 'job.queued',
        data: expect.objectContaining({ action: 'CLEAN_STAGING', archiveImportId: 'import-central' })
      })
    )
  })

  it('reuses the active cleanup job instead of creating duplicate maintenance work', async () => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    const intentAt = new Date('2026-08-18T01:00:00.000Z')
    const task = {
      id: 'import-central',
      systemJobId: 'job-failed',
      status: 'FAILED',
      cleanupRequestedAt: intentAt,
      systemJob: { id: 'job-failed', status: 'FAILED', attempt: 1 }
    }
    prismaMock.archiveImport.findUnique
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(null)
    prismaMock.systemJob.findFirst.mockResolvedValue({ id: 'cleanup-job' })

    await module.requestAction('import-central', 'DELETE_STAGING', { requestedByUserId: 'admin-1' })

    expect(prismaMock.systemJob.findFirst).toHaveBeenCalledWith({
      where: {
        type: 'ARCHIVE_MAINTENANCE',
        status: { in: ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'] },
        payload: { equals: { action: 'CLEAN_STAGING', archiveImportId: 'import-central' } }
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true }
    })
    expect(prismaMock.systemJob.create).not.toHaveBeenCalled()
    expect(prismaMock.archiveImport.updateMany).not.toHaveBeenCalled()
  })

  it('blocks central task controls while a staging cleanup intent exists', async () => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    prismaMock.archiveImport.findUnique.mockResolvedValue({
      id: 'import-central',
      systemJobId: 'job-failed',
      status: 'FAILED',
      cleanupRequestedAt: new Date('2026-08-18T01:00:00.000Z'),
      systemJob: { id: 'job-failed', status: 'FAILED', attempt: 1 }
    })

    await expect(
      module.requestAction('import-central', 'RETRY', { requestedByUserId: 'admin-1' })
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })

    expect(prismaMock.systemJob.create).not.toHaveBeenCalled()
    expect(prismaMock.archiveImport.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['DELETE_ARCHIVE', 'ACTIVE', 'TRASHING', 'TRASH_ARCHIVE'],
    ['RESTORE_ARCHIVE', 'TRASHED', 'RESTORING', 'RESTORE_ARCHIVE']
  ] as const)(
    'queues %s as an atomic lifecycle intent plus writer job',
    async (action, state, nextState, payloadAction) => {
      vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
      const task = {
        id: 'import-central',
        systemJobId: 'job-completed',
        status: 'COMPLETED',
        cleanupRequestedAt: null,
        publishedArtworkId: 7,
        systemJob: { id: 'job-completed', status: 'COMPLETED', attempt: 1 }
      }
      prismaMock.archiveImport.findUnique
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(null)
      prismaMock.systemJob.findUnique.mockResolvedValue(null)
      prismaMock.archiveImport.findFirst.mockResolvedValue(null)
      prismaMock.artwork.findUnique.mockResolvedValue({
        id: 7,
        createdVia: 'URL_ARCHIVE',
        archiveLifecycleState: state,
        deletedAt: state === 'ACTIVE' ? null : new Date('2026-08-18T00:00:00.000Z'),
        updatedAt: new Date('2026-08-18T00:00:00.000Z'),
        archiveRevisions: [
          {
            id: 'revision-1',
            trashPath: state === 'ACTIVE' ? null : '.trash/archive/7/revision-1',
            trashedAt: state === 'ACTIVE' ? null : new Date('2026-08-18T00:00:00.000Z'),
            purgeAfter: null,
            externalRef: { providerKey: 'test-provider', externalId: '42' }
          }
        ]
      })

      await module.requestAction('import-central', action, { requestedByUserId: 'admin-1' })

      expect(prismaMock.artwork.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ archiveLifecycleState: nextState }) })
      )
      expect(prismaMock.systemJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'ARCHIVE_MAINTENANCE',
          executionLane: 'BACKGROUND_WRITER',
          queuePriority: 20,
          effectivePriority: 20,
          payload: { action: payloadAction, artworkId: 7 }
        })
      })
    }
  )

  it('rejects restore after the archive retention deadline even when no purge job is active', async () => {
    const task = {
      id: 'import-central',
      systemJobId: 'job-completed',
      status: 'COMPLETED',
      cleanupRequestedAt: null,
      publishedArtworkId: 7,
      systemJob: { id: 'job-completed', status: 'COMPLETED', attempt: 1 }
    }
    prismaMock.archiveImport.findUnique
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(null)
    prismaMock.systemJob.findFirst.mockResolvedValue(null)
    prismaMock.artwork.findUnique.mockResolvedValue({
      id: 7,
      createdVia: 'URL_ARCHIVE',
      archiveLifecycleState: 'TRASHED',
      deletedAt: new Date('2026-08-10T00:00:00.000Z'),
      updatedAt: new Date('2026-08-10T00:00:00.000Z'),
      archiveRevisions: [
        {
          id: 'revision-1',
          trashPath: '.trash/archive/7/revision-1',
          trashedAt: new Date('2026-08-10T00:00:00.000Z'),
          purgeAfter: new Date('2026-08-17T00:00:00.000Z'),
          externalRef: { providerKey: 'test-provider', externalId: '42' }
        }
      ]
    })

    await expect(
      module.requestAction('import-central', 'RESTORE_ARCHIVE', { requestedByUserId: 'admin-1' })
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT', message: '作品保留期已结束，不能再恢复' })

    expect(prismaMock.artwork.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.systemJob.create).not.toHaveBeenCalled()
  })

  it('reuses an active artwork maintenance job for a repeated lifecycle request', async () => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    const intentAt = new Date('2026-08-18T02:00:00.000Z')
    const task = {
      id: 'import-central',
      systemJobId: 'job-completed',
      status: 'COMPLETED',
      publishedArtworkId: 7,
      systemJob: { id: 'job-completed', status: 'COMPLETED', attempt: 1 }
    }
    prismaMock.archiveImport.findUnique
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(null)
    prismaMock.artwork.findUnique.mockResolvedValue({
      id: 7,
      createdVia: 'URL_ARCHIVE',
      archiveLifecycleState: 'TRASHING',
      deletedAt: intentAt,
      updatedAt: intentAt,
      archiveRevisions: [
        {
          id: 'revision-1',
          trashPath: '.trash/archive/7/revision-1',
          trashedAt: intentAt,
          purgeAfter: new Date('2026-08-25T02:00:00.000Z'),
          externalRef: { providerKey: 'test-provider', externalId: '42' }
        }
      ]
    })
    prismaMock.systemJob.findFirst.mockResolvedValue({ id: 'trash-job' })

    await module.requestAction('import-central', 'DELETE_ARCHIVE', { requestedByUserId: 'admin-1' })

    expect(prismaMock.systemJob.findFirst).toHaveBeenCalledWith({
      where: {
        type: 'ARCHIVE_MAINTENANCE',
        status: { in: ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'] },
        payload: { equals: { action: 'TRASH_ARCHIVE', artworkId: 7 } }
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true }
    })
    expect(prismaMock.systemJob.create).not.toHaveBeenCalled()
    expect(prismaMock.artwork.updateMany).not.toHaveBeenCalled()
  })

  it('refreshes a pending lifecycle intent after its maintenance job reached a terminal failure', async () => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    const intentAt = new Date('2026-08-18T02:00:00.000Z')
    const task = {
      id: 'import-central',
      systemJobId: 'job-completed',
      status: 'COMPLETED',
      publishedArtworkId: 7,
      systemJob: { id: 'job-completed', status: 'COMPLETED', attempt: 1 }
    }
    prismaMock.archiveImport.findUnique
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(null)
    prismaMock.archiveImport.findFirst.mockResolvedValue(null)
    prismaMock.artwork.findUnique.mockResolvedValue({
      id: 7,
      createdVia: 'URL_ARCHIVE',
      archiveLifecycleState: 'TRASHING',
      deletedAt: intentAt,
      updatedAt: intentAt,
      archiveRevisions: [
        {
          id: 'revision-1',
          trashPath: '.trash/archive/7/revision-1',
          trashedAt: intentAt,
          purgeAfter: new Date('2026-08-25T02:00:00.000Z'),
          externalRef: { providerKey: 'test-provider', externalId: '42' }
        }
      ]
    })
    prismaMock.systemJob.findFirst.mockResolvedValue(null)

    await module.requestAction('import-central', 'DELETE_ARCHIVE', { requestedByUserId: 'admin-1' })

    expect(prismaMock.artwork.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 7, archiveLifecycleState: 'TRASHING' }),
        data: expect.objectContaining({ archiveLifecycleState: 'TRASHING', updatedAt: expect.any(Date) })
      })
    )
    const refreshedIntent = prismaMock.artwork.updateMany.mock.calls[0]![0].data.updatedAt as Date
    expect(refreshedIntent.getTime()).toBeGreaterThan(intentAt.getTime())
    expect(prismaMock.systemJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'ARCHIVE_MAINTENANCE',
        idempotencyKey: `archive-maintenance:TRASH_ARCHIVE:7:${refreshedIntent.getTime()}`,
        payload: { action: 'TRASH_ARCHIVE', artworkId: 7 }
      })
    })
  })

  it('returns cursor-based task item batches without provider tokens or staging paths', async () => {
    prismaMock.archiveImport.findUnique.mockResolvedValue({ id: 'import-1', totalItems: 101 })
    prismaMock.archiveImportItem.findMany.mockResolvedValue([
      {
        id: 'item-51',
        pageIndex: 50,
        sourcePageUrl: 'https://archive.test/s/private-token/42-51',
        expectedFilename: '0051',
        status: 'COMPLETED',
        attempts: 1,
        stagedPath: 'media/0051.webp',
        byteCount: BigInt(1024),
        mimeType: 'image/webp',
        quality: 'ORIGINAL',
        width: 1280,
        height: 720,
        errorCode: null,
        errorMessage: 'failed https://archive.test/s/private-token/42-51 at /private/archive/item.webp',
        errorStage: 'STORAGE',
        remoteHost: 'archive.test',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        finishedAt: new Date('2026-01-01T00:00:01.000Z'),
        updatedAt: new Date('2026-01-01T00:00:01.000Z')
      },
      {
        id: 'item-52',
        pageIndex: 51,
        sourcePageUrl: 'https://archive.test/s/page/42-52',
        expectedFilename: '0052',
        status: 'PENDING',
        attempts: 0,
        stagedPath: null,
        byteCount: null,
        mimeType: null,
        quality: null,
        width: null,
        height: null,
        errorCode: null,
        errorMessage: null,
        errorStage: null,
        remoteHost: null,
        startedAt: null,
        finishedAt: null,
        updatedAt: new Date('2026-01-01T00:00:01.000Z')
      }
    ])

    const result = await module.listTaskItems('import-1', 49, 1)

    expect(prismaMock.archiveImportItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { archiveImportId: 'import-1', pageIndex: { gt: 49 } },
        orderBy: { pageIndex: 'asc' },
        take: 2
      })
    )
    expect(result).toMatchObject({
      totalItems: 101,
      nextCursor: 50,
      items: [
        expect.objectContaining({
          sourcePageUrl: 'https://archive.test/s/…',
          byteCount: '1024',
          errorMessage: '图片处理失败，请根据错误码与失败阶段排查。'
        })
      ]
    })
    expect(result.items[0]).not.toHaveProperty('stagedPath')
    expect(JSON.stringify(result.items[0])).not.toContain('private-token')
    expect(JSON.stringify(result.items[0])).not.toContain('/private/archive')
  })

  it('filters task item batches in the database before applying the cursor and limit', async () => {
    prismaMock.archiveImport.findUnique.mockResolvedValue({ id: 'import-1', totalItems: 101 })
    prismaMock.archiveImportItem.findMany.mockResolvedValue([])

    await module.listTaskItems('import-1', 49, 50, 'FAILED')

    expect(prismaMock.archiveImportItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { archiveImportId: 'import-1', pageIndex: { gt: 49 }, status: 'FAILED' },
        orderBy: { pageIndex: 'asc' },
        take: 51
      })
    )
  })

  it('returns lightweight task item counts for every server-side filter', async () => {
    prismaMock.archiveImport.findUnique.mockResolvedValue({ id: 'import-1' })
    prismaMock.archiveImportItem.groupBy.mockResolvedValue([
      { status: 'COMPLETED', _count: { _all: 80 } },
      { status: 'FAILED', _count: { _all: 2 } },
      { status: 'PENDING', _count: { _all: 17 } },
      { status: 'DOWNLOADING', _count: { _all: 2 } }
    ])

    await expect(module.getTaskItemCounts('import-1')).resolves.toEqual({
      all: 101,
      completed: 80,
      failed: 2,
      pending: 17,
      downloading: 2
    })
  })

  it('requeues only the selected failed item and preserves completed checkpoints', async () => {
    const task = {
      id: 'import-1',
      systemJobId: 'job-1',
      status: 'FAILED',
      errorCode: 'PARTIAL_FAILURE',
      completedItems: 98,
      failedItems: 2,
      totalItems: 100,
      systemJob: {
        id: 'job-1',
        status: 'FAILED',
        queuePriority: 10,
        maxAttempts: 3,
        attempt: 1,
        definitionVersion: 1,
        payload: { archiveImportId: 'import-1' }
      }
    }
    prismaMock.archiveImport.findUnique
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(null)
    prismaMock.archiveImportItem.findFirst.mockResolvedValue({ id: 'item-99', status: 'FAILED' })
    prismaMock.archiveImportItem.updateMany.mockResolvedValue({ count: 1 })

    await module.retryTaskItem('import-1', 'item-99', { requestedByUserId: 'admin-1' })

    expect(prismaMock.archiveImportItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'item-99', archiveImportId: 'import-1', status: 'FAILED' },
      data: expect.objectContaining({ status: 'PENDING', attempts: 0, errorStage: null, remoteHost: null })
    })
    expect(prismaMock.archiveImport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING', failedItems: 1, retainUntil: null })
      })
    )
  })

  it('allows single-item retry when a gallery failed before completing any image', async () => {
    const task = {
      id: 'import-1',
      systemJobId: 'job-1',
      status: 'FAILED',
      errorCode: 'PARTIAL_FAILURE',
      completedItems: 0,
      failedItems: 1,
      totalItems: 1,
      systemJob: {
        id: 'job-1',
        status: 'FAILED',
        queuePriority: 10,
        maxAttempts: 3,
        attempt: 1,
        definitionVersion: 1,
        payload: { archiveImportId: 'import-1' }
      }
    }
    prismaMock.archiveImport.findUnique
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(null)
    prismaMock.archiveImportItem.findFirst.mockResolvedValue({ id: 'item-1', status: 'FAILED' })
    prismaMock.archiveImportItem.updateMany.mockResolvedValue({ count: 1 })

    await expect(module.retryTaskItem('import-1', 'item-1', { requestedByUserId: 'admin-1' })).resolves.toEqual({
      taskId: 'import-1'
    })
    expect(prismaMock.archiveImport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING', failedItems: 0, retainUntil: null })
      })
    )
  })
})
