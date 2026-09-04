import { describe, expect, it, vi } from 'vitest'
import {
  archiveTaskActionManySchema,
  archiveTaskListSchema,
  getArchiveBulkOperation,
  listArchiveTasks
} from '../archive-task-service'

describe('archive task service input contracts', () => {
  it('keeps task page filters strict and bounded', () => {
    expect(
      archiveTaskListSchema.safeParse({
        limit: 101,
        statuses: ['PENDING'],
        locator: { token: 'secret' }
      }).success
    ).toBe(false)
    expect(
      archiveTaskListSchema.safeParse({
        limit: 50,
        statuses: ['PENDING'],
        providerKey: 'e-hentai',
        kind: 'UPDATE',
        submissionId: 'submission-1',
        search: 'gallery'
      }).success
    ).toBe(true)
  })

  it('bounds bulk actions at 100 and canonicalizes repeated task ids', () => {
    expect(
      archiveTaskActionManySchema.safeParse({
        idempotencyKey: 'bulk-101',
        taskIds: Array.from({ length: 101 }, (_, index) => `task-${index}`),
        action: 'CANCEL'
      }).success
    ).toBe(false)
    expect(
      archiveTaskActionManySchema.parse({
        idempotencyKey: 'bulk-repeat',
        taskIds: ['task-1', 'task-1', 'task-2'],
        action: 'RETRY'
      }).taskIds
    ).toEqual(['task-1', 'task-2'])
  })

  it('uses the task attribution filter in both relation matching and selection', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const database = { archiveImport: { findMany } }
    await listArchiveTasks({ limit: 50, kind: 'NEW', submissionId: 'submission-1' }, { database: database as never })
    const filteredQuery = findMany.mock.calls[0]![0]
    expect(filteredQuery.where.intakeItems.some).toEqual({ resolutionKind: 'NEW', submissionId: 'submission-1' })
    expect(filteredQuery.select.intakeItems.where).toEqual(filteredQuery.where.intakeItems.some)

    await listArchiveTasks({ limit: 50 }, { database: database as never })
    const unfilteredQuery = findMany.mock.calls[1]![0]
    expect(unfilteredQuery.select.intakeItems).toMatchObject({
      where: {},
      take: 1,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    })
  })

  it('locates one archive task by id without inheriting page filters', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    await listArchiveTasks(
      { taskId: 'task-active', cursor: 'ignored-for-direct-lookup', statuses: ['FAILED'], search: 'ignored' },
      { database: { archiveImport: { findMany } } as never }
    )
    expect(findMany.mock.calls[0]![0].where).toEqual({ id: 'task-active' })
  })

  it('projects live archive aggregates instead of the throttled queue progress while downloading', async () => {
    const timestamp = new Date('2026-08-19T00:00:00.000Z')
    const taskPage = await listArchiveTasks(
      { limit: 50 },
      {
        database: {
          archiveImport: {
            findMany: async () => [
              {
                id: 'task-running',
                providerKey: 'test',
                externalId: '276',
                submittedUrl: 'https://example.test/gallery/276',
                normalizedMetadata: { titles: { display: 'Running archive' } },
                status: 'RUNNING',
                requestedQuality: 'ORIGINAL',
                selectedQuality: 'ORIGINAL',
                decisionCode: null,
                totalItems: 276,
                completedItems: 25,
                failedItems: 0,
                warning: null,
                errorCode: null,
                errorMessage: null,
                createdAt: timestamp,
                startedAt: timestamp,
                finishedAt: null,
                retainUntil: null,
                publishedArtwork: null,
                publishedRevision: null,
                systemJob: {
                  id: 'job-running',
                  executionLane: 'BACKGROUND_WRITER',
                  status: 'RUNNING',
                  progress: 9,
                  message: 'Downloaded 12/276',
                  attempt: 1,
                  heartbeatAt: timestamp
                },
                intakeItems: []
              }
            ]
          }
        } as never
      }
    )

    expect(taskPage.items[0]).toMatchObject({
      completedItems: 25,
      progress: 13,
      message: '已下载 25/276'
    })
  })

  it.each([null, 'OUTBOUND', 'INBOUND'])(
    'projects legacy version warnings without exposing tokens: %s',
    async (direction) => {
      const timestamp = new Date('2026-08-18T00:00:00.000Z')
      const archiveImport = {
        id: 'task-1',
        providerKey: 'e-hentai',
        externalId: '123',
        submittedUrl: 'https://e-hentai.org/g/123/submitted-path-token/',
        normalizedMetadata: {
          titles: { display: 'Gallery' },
          relationships: direction
            ? [
                {
                  type: 'REPLACES',
                  providerKey: 'e-hentai',
                  externalId: direction === 'OUTBOUND' ? '122' : '124',
                  direction,
                  canonicalUrl: 'https://e-hentai.org/g/122/relation-path-token/'
                }
              ]
            : []
        },
        status: 'FAILED',
        requestedQuality: 'ORIGINAL',
        selectedQuality: 'ORIGINAL',
        decisionCode: null,
        totalItems: 1,
        completedItems: 0,
        failedItems: 1,
        warning:
          'warning https://e-hentai.org/g/123/warning-path-token/' +
          (direction ? '\n检测到 E-Hentai 画廊版本替代关系，将在关联作品存在时建立显式关系' : ''),
        errorCode: 'INTERNAL',
        errorMessage: 'error https://e-hentai.org/g/123/error-path-token/ locator=private-locator',
        createdAt: timestamp,
        startedAt: timestamp,
        finishedAt: timestamp,
        retainUntil: null,
        publishedArtwork: null,
        publishedRevision: null,
        systemJob: {
          id: 'job-1',
          executionLane: 'BACKGROUND_WRITER',
          status: 'FAILED',
          progress: 0,
          message: 'job https://e-hentai.org/g/123/message-path-token/',
          attempt: 1,
          heartbeatAt: null
        },
        intakeItems: []
      }
      const taskPage = await listArchiveTasks(
        { limit: 50 },
        { database: { archiveImport: { findMany: async () => [archiveImport] } } as never }
      )
      const bulk = await getArchiveBulkOperation('operation-1', {
        archiveBulkOperation: {
          findUnique: async () => ({
            id: 'operation-1',
            commandType: 'CANCEL',
            requestedCount: 1,
            createdCount: 0,
            appliedCount: 0,
            reusedCount: 0,
            skippedCount: 0,
            conflictCount: 0,
            failedCount: 1,
            createdAt: timestamp,
            completedAt: timestamp,
            items: [
              {
                id: 'operation-item-1',
                targetType: 'ARCHIVE_IMPORT',
                targetId: 'task-1',
                result: 'FAILED',
                relatedId: null,
                code: 'INTERNAL',
                message: 'bulk https://e-hentai.org/g/123/bulk-path-token/ locator=bulk-private-locator',
                createdAt: timestamp
              }
            ]
          })
        }
      } as never)
      const serialized = JSON.stringify({ taskPage, bulk })
      if (direction) {
        expect(taskPage.items[0]?.warning).toContain(
          direction === 'OUTBOUND'
            ? '解析时发现此画廊关联了历史版本，不影响本次归档。'
            : '解析时此链接已是旧版，远端另有更新版本；本次仍归档此链接，新版需另行添加，不会覆盖旧版。'
        )
        expect(taskPage.items[0]?.warning).not.toContain('建立显式关系')
        expect(archiveImport.warning).toContain('建立显式关系')
      }
      expect(taskPage.items[0]).toMatchObject({
        message: '内部处理失败，请稍后重试或查看服务日志。',
        errorMessage: '内部处理失败，请稍后重试或查看服务日志。'
      })
      for (const secret of [
        'submitted-path-token',
        'warning-path-token',
        'error-path-token',
        'message-path-token',
        'private-locator',
        'relation-path-token',
        'bulk-path-token',
        'bulk-private-locator'
      ]) {
        expect(serialized).not.toContain(secret)
      }
    }
  )
})
