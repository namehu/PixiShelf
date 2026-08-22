import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  globMetadataFiles: vi.fn(),
  prepareMetadataFilesFromList: vi.fn(),
  parseAndCollect: vi.fn(),
  batchProcessArtists: vi.fn(),
  batchProcessTags: vi.fn(),
  processBatch: vi.fn()
}))

vi.mock('../metadata-files', () => ({
  globMetadataFiles: mocks.globMetadataFiles,
  prepareMetadataFilesFromList: mocks.prepareMetadataFilesFromList,
  parseAndCollect: mocks.parseAndCollect
}))

vi.mock('../batch-processor', () => ({
  batchProcessArtists: mocks.batchProcessArtists,
  batchProcessTags: mocks.batchProcessTags,
  processBatch: mocks.processBatch
}))

vi.mock('@/utils/sleep', () => ({ sleep: vi.fn() }))

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn()
  }
}))

import { scan } from '../scan'
import { FULL_SCAN_RETIRED_MESSAGE } from '../../scan-source-policy'

describe('retired directory-wide forced scan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prepareMetadataFilesFromList.mockResolvedValue([])
  })

  it('rejects a directory-wide force request before reading the source', async () => {
    await expect(scan({ scanPath: 'D:/scan', forceUpdate: true })).rejects.toThrow(FULL_SCAN_RETIRED_MESSAGE)

    expect(mocks.globMetadataFiles).not.toHaveBeenCalled()
    expect(mocks.prepareMetadataFilesFromList).not.toHaveBeenCalled()
    expect(mocks.processBatch).not.toHaveBeenCalled()
  })

  it('keeps bounded list refresh, including an explicitly empty list', async () => {
    const result = await scan({
      scanPath: 'D:/scan',
      forceUpdate: true,
      metadataRelativePaths: []
    })

    expect(mocks.prepareMetadataFilesFromList).toHaveBeenCalledWith('D:/scan', [], expect.any(Object), true)
    expect(mocks.globMetadataFiles).not.toHaveBeenCalled()
    expect(result.removedArtworks).toBe(0)
  })
})
