import { describe, expect, it, vi } from 'vitest'
import {
  backgroundHistoryInputSchema,
  backgroundHistorySnapshotsInputSchema,
  getBackgroundHistorySnapshots,
  listBackgroundHistory
} from '../job-history-service'
import { jobRecord } from './test-fixtures'

describe('background execution history', () => {
  it('defaults to fifty records and excludes only the existing four batch child types', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    await listBackgroundHistory(backgroundHistoryInputSchema.parse({}), { systemJob: { findMany } } as never)
    const input = findMany.mock.calls[0]![0]
    expect(input.take).toBe(51)
    expect(input.where.AND).toContainEqual({ definitionVersion: { gte: 1 } })
    expect(input.where.AND[1].NOT.OR).toHaveLength(4)
    expect(input).not.toHaveProperty('cursor')
    expect(input).not.toHaveProperty('skip')
    expect(input.select).not.toHaveProperty('result')
  })

  it('combines filters with inclusive start and exclusive end and permits child records', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    await listBackgroundHistory(
      backgroundHistoryInputSchema.parse({
        statuses: ['FAILED', 'CANCELLED'],
        types: ['SCAN'],
        triggerSources: ['MANUAL', 'SCHEDULE'],
        createdFrom: '2026-09-01T00:00:00.000Z',
        createdTo: '2026-09-08T00:00:00.000Z',
        includeBatchChildren: true
      }),
      { systemJob: { findMany } } as never
    )
    expect(findMany.mock.calls[0]![0].where.AND).toEqual([
      { definitionVersion: { gte: 1 } },
      { status: { in: ['FAILED', 'CANCELLED'] } },
      { type: { in: ['SCAN'] } },
      { triggerSource: { in: ['MANUAL', 'SCHEDULE'] } },
      { createdAt: { gte: new Date('2026-09-01T00:00:00.000Z'), lt: new Date('2026-09-08T00:00:00.000Z') } }
    ])
  })

  it.each([
    ['视频媒体探测', { type: { in: ['VIDEO_MEDIA_PROBE'] } }],
    ['video_media_probe', { type: { in: ['VIDEO_MEDIA_PROBE'] } }],
    ['Pixiv 来源核对', { type: 'SCAN', payload: { path: ['mode'], equals: 'CONSISTENCY_AUDIT' } }],
    ['Pixiv 来源同步', { type: 'SCAN', payload: { path: ['mode'], equals: 'AUDIT_APPLY' } }],
    ['历史来源核对', { type: 'SCAN', payload: { path: ['mode'], equals: 'FULL_RECONCILE' } }]
  ])('searches display names and scan aliases: %s', async (search, predicate) => {
    const findMany = vi.fn().mockResolvedValue([])
    await listBackgroundHistory(backgroundHistoryInputSchema.parse({ search }), { systemJob: { findMany } } as never)
    const branches = findMany.mock.calls[0]![0].where.AND.at(-1).OR
    expect(branches).toContainEqual(predicate)
    for (const field of ['id', 'message', 'errorCode', 'error']) {
      expect(branches).toContainEqual({ [field]: { contains: search, mode: 'insensitive' } })
    }
  })

  it('encodes both sort values and continues without looking up a deleted cursor row', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([jobRecord({ id: 'job-z' }), jobRecord({ id: 'job-y' })])
      .mockResolvedValueOnce([])
    const client = { systemJob: { findMany } } as never
    const first = await listBackgroundHistory(backgroundHistoryInputSchema.parse({ limit: 1 }), client)
    expect(first.items.map((item) => item.id)).toEqual(['job-z'])
    const next = backgroundHistoryInputSchema.parse({ cursor: first.nextCursor, limit: 1 })
    expect(next.cursor).toEqual({ createdAt: '2026-08-14T10:00:00.000Z', id: 'job-z' })
    const last = await listBackgroundHistory(next, client)
    expect(findMany.mock.calls[1]![0].where.AND.at(-1)).toEqual({
      OR: [
        { createdAt: { lt: new Date('2026-08-14T10:00:00.000Z') } },
        { createdAt: new Date('2026-08-14T10:00:00.000Z'), id: { lt: 'job-z' } }
      ]
    })
    expect(last.nextCursor).toBeNull()
  })

  it('rejects malformed cursors, oversized pages, invalid dates and snapshot requests', () => {
    for (const cursor of ['!', 'not-json', Buffer.from('{"id":"x","createdAt":"bad"}').toString('base64url')]) {
      expect(backgroundHistoryInputSchema.safeParse({ cursor }).success).toBe(false)
    }
    expect(backgroundHistoryInputSchema.safeParse({ limit: 101 }).success).toBe(false)
    expect(
      backgroundHistoryInputSchema.safeParse({ createdFrom: '2026-09-08T00:00:00Z', createdTo: '2026-09-01T00:00:00Z' })
        .success
    ).toBe(false)
    expect(backgroundHistorySnapshotsInputSchema.safeParse({ ids: [] }).success).toBe(false)
    expect(backgroundHistorySnapshotsInputSchema.safeParse({ ids: Array(101).fill('job') }).success).toBe(false)
  })

  it('returns bounded redacted summaries, no payload/result/leases, and snapshot IDs without status filters', async () => {
    const findMany = vi.fn().mockResolvedValue([
      jobRecord({
        type: 'ARCHIVE_IMPORT',
        payload: { token: 'secret' },
        result: { private: true },
        message: 'https://e-hentai.org/g/123/private-token/',
        error: `Bearer abc.def ${'x'.repeat(1000)}`
      })
    ])
    const result = await getBackgroundHistorySnapshots({ ids: ['job-1', 'job-1'] }, {
      systemJob: { findMany }
    } as never)
    expect(findMany.mock.calls[0]![0].where).toEqual({ definitionVersion: { gte: 1 }, id: { in: ['job-1'] } })
    expect(result.items[0]!.error!.length).toBeLessThanOrEqual(500)
    for (const value of ['payload', 'result', 'leaseToken', 'private-token', 'abc.def']) {
      expect(JSON.stringify(result)).not.toContain(value)
    }
  })
})
