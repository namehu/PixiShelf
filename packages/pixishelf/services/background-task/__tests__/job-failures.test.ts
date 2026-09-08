import type { Prisma } from '@pixishelf/db'
import { describe, expect, it, vi } from 'vitest'
import { acknowledgeJobFailuresCommand, acknowledgeJobFailuresRequestSchema } from '../job-command-service'
import { backgroundFailuresInputSchema, listBackgroundFailures } from '../job-history-service'
import { getBackgroundJobDetail } from '../job-query-service'
import { unacknowledgedFailureWhere } from '../job-failure-policy'
import { jobRecord } from './test-fixtures'

describe('failure notification queries and bulk acknowledgement', () => {
  it('requires an explicit scope, validates bounded IDs and deduplicates selected IDs', () => {
    for (const input of [
      {},
      { scope: 'selected', jobIds: [] },
      { scope: 'selected', jobIds: [''] },
      { scope: 'selected', jobIds: Array.from({ length: 101 }, (_, i) => `job-${i}`) },
      { scope: 'all', jobIds: ['job-1'] }
    ]) {
      expect(acknowledgeJobFailuresRequestSchema.safeParse(input).success).toBe(false)
    }
    expect(acknowledgeJobFailuresRequestSchema.parse({ scope: 'selected', jobIds: ['a', 'a', 'b'] })).toEqual({
      scope: 'selected',
      jobIds: ['a', 'b']
    })
    expect(backgroundFailuresInputSchema.parse({}).limit).toBe(50)
    expect(backgroundFailuresInputSchema.safeParse({ limit: 101 }).success).toBe(false)
    expect(backgroundFailuresInputSchema.safeParse({ cursor: 'invalid!' }).success).toBe(false)
  })

  it('pages unacknowledged failures with a value cursor and redacted lightweight summaries', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        jobRecord({ id: 'job-z', status: 'FAILED' }),
        jobRecord({ id: 'job-y', status: 'FAILED' })
      ])
      .mockResolvedValueOnce([jobRecord({ id: 'job-y', status: 'FAILED' })])
    const client = { systemJob: { findMany } } as never
    const first = await listBackgroundFailures(backgroundFailuresInputSchema.parse({ limit: 1 }), client)
    expect(findMany.mock.calls[0]![0].where.AND).toContainEqual(unacknowledgedFailureWhere)
    expect(first.items).toHaveLength(1)
    expect(first.items[0]).not.toHaveProperty('payload')
    expect(first.items[0]).not.toHaveProperty('leaseToken')
    const next = await listBackgroundFailures(
      backgroundFailuresInputSchema.parse({ cursor: first.nextCursor, limit: 1 }),
      client
    )
    expect(next.items[0]?.id).toBe('job-y')
    expect(findMany.mock.calls[1]![0]).not.toHaveProperty('cursor')
    expect(findMany.mock.calls[1]![0].where.AND.at(-1).OR[1].id).toEqual({ lt: 'job-z' })
  })

  it.each([
    [{ status: 'FAILED' as const, failureAcknowledgement: null }, true],
    [{ status: 'FAILED' as const, failureAcknowledgement: { jobId: 'old-failure' } }, false],
    [{ status: 'COMPLETED' as const, failureAcknowledgement: null }, false],
    [
      { status: 'FAILED' as const, type: 'PIXIV_TAG_ENRICHMENT', parentJobId: 'parent', failureAcknowledgement: null },
      false
    ]
  ])(
    'reads detail attention from the acknowledgement relation, independently of the dashboard',
    async (patch, expected) => {
      const findUnique = vi.fn().mockResolvedValue({ ...jobRecord({ id: 'old-failure' }), ...patch })
      const result = await getBackgroundJobDetail('old-failure', { systemJob: { findUnique } } as never)
      expect(result?.failureNeedsAttention).toBe(expected)
      expect(result).not.toHaveProperty('failureAcknowledgement')
    }
  )

  function harness(ids: string[], counts?: number[]) {
    const findMany = vi.fn().mockResolvedValue(ids.map((id) => ({ id })))
    const createMany = vi.fn(async ({ data }: { data: unknown[] }) => ({ count: counts?.shift() ?? data.length }))
    const tx = {
      systemJob: { findMany },
      systemJobFailureAcknowledgement: { createMany }
    } as unknown as Prisma.TransactionClient
    const client = { $transaction: <T>(fn: (transaction: Prisma.TransactionClient) => Promise<T>) => fn(tx) }
    return { findMany, createMany, client }
  }

  it('skips stale selected IDs and concurrent confirmations without overwriting the first acknowledgement', async () => {
    const h = harness(['one', 'two'], [1])
    const result = await acknowledgeJobFailuresCommand(
      { scope: 'selected', jobIds: ['one', 'two', 'missing', 'one'] },
      'admin',
      h.client
    )
    expect(result).toEqual({ acknowledgedCount: 1, skippedCount: 2 })
    expect(h.findMany.mock.calls[0]![0].where).toEqual({
      ...unacknowledgedFailureWhere,
      id: { in: ['one', 'two', 'missing'] }
    })
    expect(h.createMany.mock.calls[0]![0]).toMatchObject({ skipDuplicates: true })
  })

  it('freezes all candidates once and writes batches of at most 500 with one actor and timestamp', async () => {
    const h = harness(Array.from({ length: 1001 }, (_, i) => `id-${i}`))
    const now = new Date('2026-09-08T00:00:00Z')
    expect(await acknowledgeJobFailuresCommand({ scope: 'all' }, 'admin', h.client, () => now)).toEqual({
      acknowledgedCount: 1001,
      skippedCount: 0
    })
    expect(h.findMany).toHaveBeenCalledOnce()
    expect(h.findMany.mock.calls[0]![0].where).toEqual(unacknowledgedFailureWhere)
    expect(h.createMany.mock.calls.map(([input]) => input.data.length)).toEqual([500, 500, 1])
    expect(h.createMany.mock.calls[2]![0].data[0]).toMatchObject({
      source: 'MANUAL',
      acknowledgedAt: now,
      acknowledgedByUserId: 'admin'
    })
  })

  it('returns zero for an empty all scope and propagates database failures', async () => {
    const empty = harness([])
    expect(await acknowledgeJobFailuresCommand({ scope: 'all' }, 'admin', empty.client)).toEqual({
      acknowledgedCount: 0,
      skippedCount: 0
    })
    expect(empty.createMany).not.toHaveBeenCalled()
    const broken = harness(['one'])
    broken.createMany.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(acknowledgeJobFailuresCommand({ scope: 'all' }, 'admin', broken.client)).rejects.toThrow(
      'database unavailable'
    )
  })
})
