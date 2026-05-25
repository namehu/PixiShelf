import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareMetadataFilesFromList } from './index'

const { findManyMock, loggerWarnMock, extractArtworkIdFromFilenameMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  extractArtworkIdFromFilenameMock: vi.fn((name: string) => name.match(/^(\d+)-meta\.txt$/)?.[1] || null)
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    artwork: {
      findMany: findManyMock
    }
  }
}))

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: loggerWarnMock,
    error: vi.fn()
  }
}))

vi.mock('./metadata-parser', async () => {
  const actual = await vi.importActual('./metadata-parser')
  return {
    ...actual,
    extractArtworkIdFromFilename: extractArtworkIdFromFilenameMock
  }
})

describe('prepareMetadataFilesFromList', () => {
  beforeEach(() => {
    findManyMock.mockReset()
    loggerWarnMock.mockReset()
    extractArtworkIdFromFilenameMock.mockClear()
  })

  it('should reject path traversal entries outside scan root', async () => {
    findManyMock.mockResolvedValue([])
    const context: any = {
      scanResult: {
        totalArtworks: 0,
        newArtists: 0,
        newArtworks: 0,
        newImages: 0,
        newTags: 0,
        skippedArtworks: 0,
        errors: [],
        processingTime: 0,
        removedArtworks: 0
      }
    }

    const scanPath = '/tmp/pixishelf-scan'
    const results = await prepareMetadataFilesFromList(
      scanPath,
      ['../evil/999-meta.txt', 'safe/123-meta.txt'],
      context,
      false
    )

    expect(results).toHaveLength(1)
    expect(results[0]?.path).toBe(path.resolve(scanPath, 'safe/123-meta.txt'))
    expect(context.scanResult.errors).toContain('Invalid metadata path out of scan root: ../evil/999-meta.txt')
  })

  it('should filter existing artworks when forceUpdate is false', async () => {
    findManyMock.mockResolvedValue([{ externalId: '123' }])
    const context: any = {
      scanResult: {
        totalArtworks: 0,
        newArtists: 0,
        newArtworks: 0,
        newImages: 0,
        newTags: 0,
        skippedArtworks: 0,
        errors: [],
        processingTime: 0,
        removedArtworks: 0
      }
    }

    const scanPath = '/tmp/pixishelf-scan'
    const results = await prepareMetadataFilesFromList(
      scanPath,
      ['safe/123-meta.txt', 'safe/456-meta.txt'],
      context,
      false
    )

    expect(findManyMock).toHaveBeenCalledTimes(1)
    expect(results).toHaveLength(1)
    expect(results[0]?.artworkId).toBe('456')
    expect(context.scanResult.totalArtworks).toBe(2)
    expect(context.scanResult.skippedArtworks).toBe(1)
  })

  it('should keep one entry and record duplicate artworkId', async () => {
    findManyMock.mockResolvedValue([])
    const context: any = {
      scanResult: {
        totalArtworks: 0,
        newArtists: 0,
        newArtworks: 0,
        newImages: 0,
        newTags: 0,
        skippedArtworks: 0,
        errors: [],
        processingTime: 0,
        removedArtworks: 0
      }
    }

    const results = await prepareMetadataFilesFromList(
      '/tmp/pixishelf-scan',
      ['a/777-meta.txt', 'b/777-meta.txt'],
      context,
      false
    )

    expect(results).toHaveLength(1)
    expect(results[0]?.artworkId).toBe('777')
    expect(context.scanResult.errors.some((item: string) => item.includes('Duplicate artworkId found: 777'))).toBe(true)
  })
})
