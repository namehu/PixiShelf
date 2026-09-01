import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settingFindUnique: vi.fn(),
  settingUpsert: vi.fn(),
  systemJobFindFirst: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn()
}))

const transactionClient = {
  setting: { upsert: mocks.settingUpsert },
  systemJob: { findFirst: mocks.systemJobFindFirst },
  $queryRawUnsafe: mocks.queryRaw
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    setting: { findUnique: mocks.settingFindUnique },
    systemJob: { findFirst: mocks.systemJobFindFirst },
    $transaction: mocks.transaction
  }
}))

import {
  ArchiveDownloadSettingsConflictError,
  getArchiveDownloadSettings,
  updateArchiveDownloadSettings
} from '../archive-download-settings-service'

describe('archive download settings service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.settingFindUnique.mockResolvedValue(null)
    mocks.systemJobFindFirst.mockResolvedValue(null)
    mocks.queryRaw.mockResolvedValue([{ lock: null }])
    mocks.settingUpsert.mockResolvedValue({})
    mocks.transaction.mockImplementation((operation) => operation(transactionClient))
  })

  it('returns concurrency 2 when the setting is absent', async () => {
    await expect(getArchiveDownloadSettings()).resolves.toEqual({
      mediaConcurrency: 2,
      canUpdate: true,
      blockingSystemJobId: null,
      blockingArchiveImportId: null
    })
    expect(mocks.systemJobFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          type: 'ARCHIVE_IMPORT',
          status: { in: ['RUNNING', 'PAUSING', 'CANCELLING'] }
        }
      })
    )
  })

  it.each([1, 8])('persists the supported boundary value %s under the advisory lock', async (value) => {
    await expect(updateArchiveDownloadSettings(value)).resolves.toMatchObject({ mediaConcurrency: value })
    expect(mocks.queryRaw).toHaveBeenCalledBefore(mocks.systemJobFindFirst)
    expect(mocks.settingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'archive_media_concurrency' },
        update: { value: String(value), type: 'number' }
      })
    )
  })

  it.each([0, 9, 1.5])('rejects unsupported concurrency %s', async (value) => {
    await expect(updateArchiveDownloadSettings(value)).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('rejects a save when an archive import is executing', async () => {
    mocks.systemJobFindFirst.mockResolvedValue({ id: 'job-running', archiveImport: { id: 'archive-running' } })

    await expect(updateArchiveDownloadSettings(4)).rejects.toEqual(
      expect.objectContaining<Partial<ArchiveDownloadSettingsConflictError>>({
        blockingSystemJobId: 'job-running',
        blockingArchiveImportId: 'archive-running'
      })
    )
    expect(mocks.settingUpsert).not.toHaveBeenCalled()
  })
})
