import { describe, expect, it } from 'vitest'
import { PostgresQueueRepository, type QueueDatabase } from '../queue-repository.js'

describe('PostgresQueueRepository transaction bounds', () => {
  const database = {} as QueueDatabase

  it('uses a transaction timeout below the default lease', () => {
    expect(() => new PostgresQueueRepository(database)).not.toThrow()
  })

  it('rejects invalid transaction bounds and a timeout that can outlive the lease', () => {
    expect(() => new PostgresQueueRepository(database, { transactionMaxWaitMs: 0 })).toThrow(
      'transactionMaxWaitMs must be a positive safe integer'
    )
    expect(() => new PostgresQueueRepository(database, { transactionTimeoutMs: 0 })).toThrow(
      'transactionTimeoutMs must be a positive safe integer'
    )
    expect(
      () => new PostgresQueueRepository(database, { leaseDurationMs: 30_000, transactionTimeoutMs: 30_000 })
    ).toThrow('transactionTimeoutMs must be less than leaseDurationMs')
  })
})
