import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createPendingReplaceExecutorRegistrations } from '../executors.js'

describe('pending replacement registration', () => {
  it('registers the strict v1 PENDING_REPLACE executor', () => {
    const [registration] = createPendingReplaceExecutorRegistrations({
      database: {} as never,
      fileSystem: {} as never,
      config: { scanRoot: path.resolve('/scan') }
    })
    expect(registration?.jobType).toBe('PENDING_REPLACE')
    expect(registration?.definitionVersion).toBe(1)
    expect(registration?.parsePayload?.({ mode: 'CLEANUP', batchId: 'batch-1' })).toEqual({
      mode: 'CLEANUP',
      batchId: 'batch-1'
    })
    expect(() => registration?.parsePayload?.({ mode: 'CLEANUP', batchId: 'batch-1', itemIds: [] })).toThrow()
    expect(vi.isMockFunction(registration?.execute)).toBe(false)
  })

  it('rejects unbounded runtime configuration', () => {
    expect(() =>
      createPendingReplaceExecutorRegistrations({
        database: {} as never,
        fileSystem: {} as never,
        config: { scanRoot: path.resolve('/scan'), maximumDirectoryEntries: 1_235 }
      })
    ).toThrow('1..1234')
  })
})
