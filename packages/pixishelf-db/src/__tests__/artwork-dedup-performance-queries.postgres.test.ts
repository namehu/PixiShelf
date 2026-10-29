import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const prefix = `visual-v2-queries-${randomUUID()}`
const jobs: string[] = []

describe.skipIf(!db)('read-only detection performance templates', () => {
  afterAll(async () => {
    if (!db) return
    await db.artworkDedupRun.deleteMany({ where: { requestedBy: prefix } })
    await db.systemJob.deleteMany({ where: { id: { in: jobs } } })
    await db.$disconnect()
  })

  it('keeps missing metrics and input equality unknown in single-run and comparison results', async () => {
    const runs: string[] = []
    for (const version of [7, 8]) {
      const id = randomUUID(), jobId = randomUUID()
      jobs.push(jobId); runs.push(id)
      await db!.systemJob.create({ data: { id: jobId, type: 'ARTWORK_DEDUP_SCAN', definitionVersion: version,
        triggerSource: 'SYSTEM', queuePriority: 900, effectivePriority: 900, payload: { runId: id, executionVersion: 1 } } })
      await db!.artworkDedupRun.create({ data: { id, artistId: 1, requestedBy: prefix, idempotencyKey: randomUUID(), mode: 'FULL', status: 'COMPLETED', stage: 'DONE', jobId,
        ...(version === 8 ? { visualSearchVersion: 'search-v2', visualInputDigest: 'a'.repeat(64), performanceSummary: {
          version: 1, updatedAt: '2026-10-29T00:00:00.000Z', complete: false, batch: 1, progress: { queryCompleted: 0, queryTotal: 2 },
          counters: { compareCalls: 0, transactions: null }, durationsMs: { transactionWall: 4 }, memoryPeakBytes: null, cacheInvalidationReasons: ['MISSING']
        } } : {}) } })
    }
    const status = (await readFile(new URL('../../../../docs/operations/queries/artwork-dedup-run-status.sql', import.meta.url), 'utf8'))
      .replace('replace-with-run-id', runs[1]!)
    const comparison = (await readFile(new URL('../../../../docs/operations/queries/artwork-dedup-run-compare.sql', import.meta.url), 'utf8'))
      .replace('replace-with-baseline-run-id', runs[0]!).replace('replace-with-comparison-run-id', runs[1]!)
    const statusRows = await db!.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      return tx.$queryRawUnsafe<Array<{ unknown_counters: unknown; memory_peak_bytes: unknown; protocol_version: number }>>(status)
    })
    expect(statusRows).toMatchObject([{ unknown_counters: { transactions: null }, memory_peak_bytes: null, protocol_version: 8 }])
    const comparisonRows = await db!.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      return tx.$queryRawUnsafe<Array<{ key: string; same_input: boolean | null; baseline_value: unknown; comparison_value: unknown; delta: unknown; reduction_percent: unknown; interpretation: string }>>(comparison)
    })
    expect(comparisonRows.find(row => row.key === 'compareCalls')).toMatchObject({ same_input: null, baseline_value: null, delta: null, reduction_percent: null, interpretation: 'unknown metric' })
    expect(comparisonRows.find(row => row.key === 'transactions')).toMatchObject({ baseline_value: null, comparison_value: null })
  })
})
