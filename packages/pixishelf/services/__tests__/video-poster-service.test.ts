import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  transactionMock,
  queryRawMock,
  metadataCountMock,
  metadataFindManyMock,
  metadataUpdateManyMock,
  metadataCreateManyMock,
  txMetadataFindFirstMock,
  txMetadataFindUniqueMock,
  txMetadataUpdateManyMock,
  txGcUpsertMock,
  imageFindManyMock,
  imageUpdateManyMock,
  readdirMock,
  unlinkMock,
  mkdirMock,
  renameMock,
  rmMock,
  statMock,
  execFileMock
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  queryRawMock: vi.fn(),
  metadataCountMock: vi.fn(),
  metadataFindManyMock: vi.fn(),
  metadataUpdateManyMock: vi.fn(),
  metadataCreateManyMock: vi.fn(),
  txMetadataFindFirstMock: vi.fn(),
  txMetadataFindUniqueMock: vi.fn(),
  txMetadataUpdateManyMock: vi.fn(),
  txGcUpsertMock: vi.fn(),
  imageFindManyMock: vi.fn(),
  imageUpdateManyMock: vi.fn(),
  readdirMock: vi.fn(),
  unlinkMock: vi.fn(),
  mkdirMock: vi.fn(),
  renameMock: vi.fn(),
  rmMock: vi.fn(),
  statMock: vi.fn(),
  execFileMock: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('node:fs/promises', () => ({
  readdir: readdirMock,
  unlink: unlinkMock,
  mkdir: mkdirMock,
  rename: renameMock,
  rm: rmMock,
  stat: statMock
}))
vi.mock('node:child_process', () => ({ execFile: execFileMock }))
vi.mock('@/services/derived-media-storage', () => ({
  VIDEO_POSTER_STORAGE_ROOT: '/posters',
  resolveDerivedMediaStoragePath: (_root: string, relativePath: string) => `/posters/${relativePath}`
}))
vi.mock('@/services/video-media-probe-service', () => ({
  resolvePathWithinScanRoot: (_root: string, relativePath: string) => `/scan/${relativePath}`
}))

const tx = {
  $queryRawUnsafe: queryRawMock,
  mediaVideoMetadata: {
    findFirst: txMetadataFindFirstMock,
    findUnique: txMetadataFindUniqueMock,
    updateMany: txMetadataUpdateManyMock
  },
  derivedMediaGcEntry: { upsert: txGcUpsertMock }
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: transactionMock,
    mediaVideoMetadata: {
      count: metadataCountMock,
      findMany: metadataFindManyMock,
      updateMany: metadataUpdateManyMock,
      createMany: metadataCreateManyMock
    },
    image: { findMany: imageFindManyMock, updateMany: imageUpdateManyMock }
  }
}))

import { runVideoPosterGenerationJob } from '../video-poster-service'

describe('video poster publication coordination', () => {
  beforeEach(() => {
    transactionMock.mockReset().mockImplementation((callback) => callback(tx))
    queryRawMock.mockReset().mockResolvedValue([])
    metadataCountMock.mockReset().mockResolvedValue(0)
    metadataFindManyMock.mockReset().mockResolvedValue([])
    metadataUpdateManyMock.mockReset().mockResolvedValue({ count: 1 })
    metadataCreateManyMock.mockReset().mockResolvedValue({ count: 0 })
    txMetadataFindFirstMock.mockReset().mockResolvedValue(null)
    txMetadataFindUniqueMock.mockReset().mockResolvedValue(null)
    txMetadataUpdateManyMock.mockReset().mockResolvedValue({ count: 1 })
    txGcUpsertMock.mockReset().mockResolvedValue({})
    imageFindManyMock.mockReset().mockResolvedValue([])
    imageUpdateManyMock.mockReset().mockResolvedValue({ count: 0 })
    readdirMock.mockReset().mockResolvedValue([])
    unlinkMock.mockReset().mockResolvedValue(undefined)
    mkdirMock.mockReset().mockResolvedValue(undefined)
    renameMock.mockReset().mockResolvedValue(undefined)
    rmMock.mockReset().mockResolvedValue(undefined)
    statMock.mockReset().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    execFileMock.mockReset().mockImplementation((_command, _args, _options, callback) => callback(null, '', ''))
  })

  it('never enumerates the poster directory as part of a generation run', async () => {
    await runVideoPosterGenerationJob({ scanPath: '/scan' })

    expect(readdirMock).not.toHaveBeenCalled()
    expect(unlinkMock).not.toHaveBeenCalled()
  })

  it('does not overwrite a manual selection that wins while the default poster is rendering', async () => {
    metadataCountMock.mockResolvedValueOnce(1)
    metadataFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ imageId: 1, image: { path: 'video.mp4' } }])
      .mockResolvedValueOnce([])
    txMetadataFindUniqueMock.mockResolvedValueOnce({
      posterStatus: 'GENERATING',
      posterPath: '1-manual.webp',
      manualPosterTimestamp: 42
    })

    const result = await runVideoPosterGenerationJob({ scanPath: '/scan' })

    expect(result).toMatchObject({ processed: 1, generated: 0, failed: 0, skipped: 1 })
    expect(queryRawMock).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock($1::integer, $2::integer)::text',
      expect.any(Number),
      1
    )
    expect(renameMock).not.toHaveBeenCalled()
    expect(txMetadataUpdateManyMock).not.toHaveBeenCalled()
    expect(metadataUpdateManyMock).toHaveBeenCalledTimes(1)
    expect(rmMock).toHaveBeenCalledWith(expect.stringMatching(/\.tmp\.webp$/), { force: true })
  })

  it('uses the observed poster path as a CAS when marking missing output', async () => {
    metadataFindManyMock.mockResolvedValueOnce([{ imageId: 1, posterPath: '1-old.webp' }]).mockResolvedValueOnce([])
    metadataCountMock.mockResolvedValueOnce(0)

    await runVideoPosterGenerationJob({ scanPath: '/scan' })

    expect(metadataUpdateManyMock).toHaveBeenCalledWith({
      where: { imageId: 1, posterStatus: 'COMPLETED', posterPath: '1-old.webp' },
      data: expect.objectContaining({ posterStatus: 'PENDING', posterPath: null })
    })
  })

  it('keeps the old poster when publication rolls back after the callback', async () => {
    metadataCountMock.mockResolvedValueOnce(1)
    metadataFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ imageId: 1, image: { path: 'video.mp4' } }])
    txMetadataFindUniqueMock.mockResolvedValueOnce({
      posterStatus: 'GENERATING',
      posterPath: '1-old.webp',
      manualPosterTimestamp: null
    })
    transactionMock.mockImplementationOnce(async (callback) => {
      await callback(tx)
      throw new Error('commit failed')
    })

    const result = await runVideoPosterGenerationJob({ scanPath: '/scan' })

    expect(result.failed).toBe(1)
    expect(renameMock).toHaveBeenCalledTimes(1)
    expect(rmMock.mock.calls.some(([target]) => target === '/posters/1-old.webp')).toBe(false)
  })

  it('registers a replaced poster for delayed GC instead of deleting it inline', async () => {
    metadataCountMock.mockResolvedValueOnce(1)
    metadataFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ imageId: 1, image: { path: 'video.mp4' } }])
    txMetadataFindUniqueMock.mockResolvedValueOnce({
      posterStatus: 'GENERATING',
      posterPath: '1-old.webp',
      manualPosterTimestamp: null
    })

    await runVideoPosterGenerationJob({ scanPath: '/scan' })

    expect(txGcUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ relativePath: '1-old.webp', reason: 'POSTER_REPLACED' })
      })
    )
    expect(rmMock).not.toHaveBeenCalledWith('/posters/1-old.webp', { force: true })
  })
})
