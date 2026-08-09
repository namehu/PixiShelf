import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearPixivImportedData: vi.fn(),
  globMetadataFiles: vi.fn(),
  prepareMetadataFilesFromList: vi.fn(),
  parseAndCollect: vi.fn(),
  batchProcessArtists: vi.fn(),
  batchProcessTags: vi.fn(),
  processBatch: vi.fn()
}))

vi.mock('../force-reset', () => ({
  clearPixivImportedData: mocks.clearPixivImportedData
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

const metadataFile = {
  name: '1001-meta.txt',
  artworkId: '1001',
  path: 'D:/scan/artist/1001/1001-meta.txt',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  metadataFormat: 'txt'
}

const artworkData = {
  metadata: {
    id: '1001',
    title: 'Artwork',
    user: 'Artist',
    userId: 'artist-1',
    tags: []
  },
  mediaFiles: [],
  directoryPath: 'D:/scan/artist/1001',
  metadataFilePath: metadataFile.path,
  directoryCreatedAt: metadataFile.createdAt
}

describe('force scan reset scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.clearPixivImportedData.mockResolvedValue(7)
    mocks.globMetadataFiles.mockResolvedValue([metadataFile])
    mocks.prepareMetadataFilesFromList.mockResolvedValue([metadataFile])
    mocks.parseAndCollect.mockResolvedValue(artworkData)
    mocks.batchProcessArtists.mockResolvedValue(undefined)
    mocks.batchProcessTags.mockResolvedValue(undefined)
    mocks.processBatch.mockResolvedValue(undefined)
  })

  it('discovers a non-empty source before resetting Pixiv data', async () => {
    const progress = vi.fn()

    const result = await scan({
      scanPath: 'D:/scan',
      forceUpdate: true,
      onProgress: progress
    })

    expect(mocks.globMetadataFiles).toHaveBeenCalledTimes(1)
    expect(mocks.clearPixivImportedData).toHaveBeenCalledTimes(1)
    expect(mocks.globMetadataFiles.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearPixivImportedData.mock.invocationCallOrder[0]!
    )
    expect(result.removedArtworks).toBe(7)
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('保留自建和本地导入作品') })
    )
  })

  it('rejects an empty full-force source without deleting existing Pixiv data', async () => {
    mocks.globMetadataFiles.mockResolvedValueOnce([])

    await expect(scan({ scanPath: 'D:/scan', forceUpdate: true })).rejects.toThrow(
      'Force scan aborted: no metadata files found'
    )
    expect(mocks.clearPixivImportedData).not.toHaveBeenCalled()
    expect(mocks.parseAndCollect).not.toHaveBeenCalled()
  })

  it('treats an empty metadata array as a list scan and never falls back to glob', async () => {
    mocks.prepareMetadataFilesFromList.mockResolvedValueOnce([])

    const result = await scan({
      scanPath: 'D:/scan',
      forceUpdate: true,
      metadataRelativePaths: []
    })

    expect(mocks.prepareMetadataFilesFromList).toHaveBeenCalledWith('D:/scan', [], expect.any(Object), true)
    expect(mocks.globMetadataFiles).not.toHaveBeenCalled()
    expect(mocks.clearPixivImportedData).not.toHaveBeenCalled()
    expect(result.removedArtworks).toBe(0)
  })

  it('rejects and stops scanning when the reset transaction fails', async () => {
    mocks.clearPixivImportedData.mockRejectedValueOnce(new Error('Database cleanup failed: rollback'))

    await expect(scan({ scanPath: 'D:/scan', forceUpdate: true })).rejects.toThrow(
      'Database cleanup failed: rollback'
    )
    expect(mocks.parseAndCollect).not.toHaveBeenCalled()
  })

  it('rejects a full-force scan when rebuilding a batch fails', async () => {
    mocks.processBatch.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(scan({ scanPath: 'D:/scan', forceUpdate: true })).rejects.toThrow(
      'Failed to process batch 1: database unavailable'
    )
    expect(mocks.clearPixivImportedData).toHaveBeenCalledTimes(1)
  })

  it('rejects a full-force scan when a discovered artwork cannot be rebuilt', async () => {
    mocks.parseAndCollect.mockResolvedValueOnce(null)

    await expect(scan({ scanPath: 'D:/scan', forceUpdate: true })).rejects.toThrow(
      'Force scan failed to rebuild 1 of 1 discovered artworks'
    )
    expect(mocks.clearPixivImportedData).toHaveBeenCalledTimes(1)
    expect(mocks.processBatch).not.toHaveBeenCalled()
  })
})
