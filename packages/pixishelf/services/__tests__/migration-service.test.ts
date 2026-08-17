import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  precheck: vi.fn(),
  buildWhere: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    artwork: { aggregate: mocks.aggregate },
    $queryRaw: vi.fn()
  }
}))

vi.mock('@/lib/logger', () => ({
  migrationLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

vi.mock('@/services/setting.service', () => ({ getScanPath: vi.fn() }))

vi.mock('@pixishelf/job-executors', () => ({
  createPrismaMigrationSelectionPort: vi.fn(() => ({ precheck: mocks.precheck })),
  buildMigrationArtworkWhere: mocks.buildWhere
}))

import { precheckMigration } from '../migration-service'

describe('migration precheck canonical selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.aggregate.mockResolvedValue({ _max: { id: 500 } })
    mocks.precheck.mockResolvedValue({
      total: 2,
      eligible: 1,
      missingArtist: 1,
      missingExternalId: 0,
      missingImages: 0
    })
  })

  it('canonicalizes ARTWORK_IDS and delegates all counts to the executor selection port', async () => {
    await expect(precheckMigration({ targetIds: [9, 2, 9] })).resolves.toEqual({
      total: 2,
      eligible: 1,
      missingArtist: 1,
      missingExternalId: 0,
      missingImages: 0
    })

    expect(mocks.precheck).toHaveBeenCalledWith({ mode: 'ARTWORK_IDS', artworkIds: [2, 9] })
    expect(mocks.aggregate).not.toHaveBeenCalled()
  })

  it('passes FAILED_FROM_JOB through the same canonical adapter', async () => {
    await precheckMigration({ selection: { mode: 'FAILED_FROM_JOB', sourceJobId: 'migration-old' } })

    expect(mocks.precheck).toHaveBeenCalledWith({ mode: 'FAILED_FROM_JOB', sourceJobId: 'migration-old' })
  })

  it('freezes QUERY at the current upper id and includes normalized media filters', async () => {
    await precheckMigration({ filters: { search: 'artist-user-id', mediaTypes: 'jpg,png', exactMatch: false } })

    expect(mocks.precheck).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'QUERY',
        upperArtworkId: 500,
        filters: expect.objectContaining({ search: 'artist-user-id', exactMatch: false })
      })
    )
  })
})
