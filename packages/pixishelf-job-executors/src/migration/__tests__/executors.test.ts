import { migrationPayloadSchema } from '@pixishelf/job-contracts'
import { describe, expect, it, vi } from 'vitest'
import { createMigrationExecutorRegistrations } from '../executors.js'

describe('migration executor registration', () => {
  it('registers only MIGRATION v1 and delegates strict payload parsing to contracts', () => {
    const [registration] = createMigrationExecutorRegistrations({
      database: {} as never,
      fileSystem: {} as never,
      config: { scanRoot: '/scan' }
    })

    expect(registration).toMatchObject({ jobType: 'MIGRATION', definitionVersion: 1 })
    expect(
      registration!.parsePayload?.({
        selection: { mode: 'ARTWORK_IDS', artworkIds: [2, 1, 2] },
        safety: {}
      })
    ).toEqual({
      selection: { mode: 'ARTWORK_IDS', artworkIds: [1, 2] },
      safety: { transferMode: 'move', verifyAfterCopy: true, cleanupSource: true }
    })
    expect(() =>
      migrationPayloadSchema.parse({ selection: { mode: 'QUERY', filters: {}, upperArtworkId: 1 }, extra: true })
    ).toThrow()
  })

  it('refuses an unsafe unbounded page configuration before registration', () => {
    expect(() =>
      createMigrationExecutorRegistrations({
        database: {} as never,
        fileSystem: {} as never,
        config: { scanRoot: '/scan', selectionPageSize: 101 }
      })
    ).toThrow('between 1 and 100')
    expect(vi.isMockFunction(createMigrationExecutorRegistrations)).toBe(false)
  })
})
