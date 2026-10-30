import { afterEach, describe, expect, it, vi } from 'vitest'
import { addDedupDatabaseMeasurement, addDedupTransactionTiming, emptyDedupDatabaseMeasurement, measureDedupDatabase } from '../executor-telemetry.ts'

afterEach(() => vi.restoreAllMocks())

describe('artwork detection database measurement', () => {
  it('counts each Prisma method, separates fenced reads, and does not inspect arguments', async () => {
    let elapsed = 0
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed)
    const database = {
      image: {
        findMany: vi.fn(async () => { elapsed += 3; return [] }),
        count: vi.fn(async () => { elapsed += 2; return 4 }),
        updateMany: vi.fn(async () => { elapsed += 7; return { count: 4 } })
      },
      $queryRaw: vi.fn(async () => { elapsed += 5; return [] })
    }
    const loaded = emptyDedupDatabaseMeasurement()
    const read = measureDedupDatabase(database, loaded, 'load')
    await read.image.findMany()
    await read.image.count()
    const fenced = emptyDedupDatabaseMeasurement()
    const transaction = measureDedupDatabase(database, fenced, 'validation')
    await transaction.$queryRaw()
    await transaction.image.updateMany()
    expect(loaded).toMatchObject({ dbLoadCalls: 2, dbLoadMs: 5, dbValidationCalls: 0, dbWriteCalls: 0 })
    expect(fenced).toMatchObject({ dbLoadCalls: 0, dbValidationCalls: 1, dbValidationMs: 5, dbWriteCalls: 1, dbWriteMs: 7 })
  })

  it('keeps rolled-back work outside the committed aggregate', async () => {
    const committed = emptyDedupDatabaseMeasurement()
    const attempt = emptyDedupDatabaseMeasurement()
    const tx = measureDedupDatabase({ image: { update: vi.fn(async () => undefined) } }, attempt, 'validation')
    await tx.image.update()
    expect(attempt.dbWriteCalls).toBe(1)
    expect(committed.dbWriteCalls).toBe(0)
    addDedupDatabaseMeasurement(committed, attempt)
    expect(committed.dbWriteCalls).toBe(1)
  })

  it('separates the queue fence from legacy body reads and adds each committed timing sample once', () => {
    const committed = emptyDedupDatabaseMeasurement()
    const attempt = emptyDedupDatabaseMeasurement()
    attempt.dbValidationCalls = 3
    addDedupTransactionTiming(attempt, {
      acquisitionMs: 2, preFenceMs: 3, bodyMs: 5, postFenceMs: 7,
      commitFinalizationMs: 11, wallMs: 28, fenceReadCalls: 4
    })
    expect(committed.timedTransactions).toBe(0)
    addDedupDatabaseMeasurement(committed, attempt)
    expect(committed).toMatchObject({
      dbValidationCalls: 3, dbFenceCalls: 4, timedTransactions: 1,
      transactionAcquisitionMs: 2, transactionPreFenceMs: 3, transactionBodyMs: 5,
      transactionPostFenceMs: 7, transactionCommitFinalizationMs: 11
    })
  })
})
