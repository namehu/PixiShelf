import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  execFileMock,
  childKillMock,
  imageFindManyMock,
  imageUpdateMock,
  previewDeleteManyMock,
  previewFindManyMock,
  previewUpdateManyMock,
  previewUpdateMock,
  previewUpsertMock,
  queryRawMock,
  readFileMock,
  readChapterManifestMock,
  readdirMock,
  renameMock,
  rmdirMock,
  rmMock,
  sharpMock,
  sharpStatsMock,
  statMock
} = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  childKillMock: vi.fn(),
  imageFindManyMock: vi.fn(),
  imageUpdateMock: vi.fn(),
  previewDeleteManyMock: vi.fn(),
  previewFindManyMock: vi.fn(),
  previewUpdateManyMock: vi.fn(),
  previewUpdateMock: vi.fn(),
  previewUpsertMock: vi.fn(),
  queryRawMock: vi.fn(),
  readFileMock: vi.fn(),
  readChapterManifestMock: vi.fn(),
  readdirMock: vi.fn(),
  renameMock: vi.fn(),
  rmdirMock: vi.fn(),
  rmMock: vi.fn(),
  sharpStatsMock: vi.fn(),
  sharpMock: vi.fn(),
  statMock: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('node:child_process', () => ({ execFile: execFileMock }))
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readFile: readFileMock,
  readdir: readdirMock,
  rename: renameMock,
  rmdir: rmdirMock,
  rm: rmMock,
  stat: statMock
}))
vi.mock('sharp', () => ({ default: sharpMock }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: queryRawMock,
    image: { findMany: imageFindManyMock, update: imageUpdateMock },
    mediaChapterPreview: {
      deleteMany: previewDeleteManyMock,
      findMany: previewFindManyMock,
      update: previewUpdateMock,
      updateMany: previewUpdateManyMock,
      upsert: previewUpsertMock
    }
  }
}))
vi.mock('@/services/artwork-service/video-chapters', () => ({
  createChapterManifestHash: vi.fn(() => '0123456789abcdef-full-hash'),
  readChapterManifestByStoredPath: readChapterManifestMock
}))
vi.mock('@/services/video-media-probe-service', () => ({
  resolvePathWithinScanRoot: vi.fn((_scanPath: string, videoPath: string) => `C:/scan/${videoPath}`)
}))

import {
  buildChapterCaptureTimes,
  calculateFrameLuma,
  runVideoChapterPreviewGenerationJob
} from '../video-chapter-preview-service'

const manifest = {
  version: 1 as const,
  duration: 10,
  chapters: [{ index: 1, title: 'Opening', start: 0, end: 10, duration: 10 }]
}

function video(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    path: '/artist/work/video.mp4',
    chaptersPath: '/artist/work/video.chapters.json',
    chaptersHash: '0123456789abcdef-full-hash',
    chaptersCount: 1,
    chaptersDuration: 10,
    chapterPreviews: [],
    ...overrides
  }
}

describe('video chapter preview service', () => {
  beforeEach(() => {
    childKillMock.mockReset()
    execFileMock.mockReset().mockImplementation((_command, _args, _options, callback) => callback(null, '', ''))
    imageFindManyMock.mockReset().mockResolvedValue([])
    imageUpdateMock.mockReset().mockResolvedValue({})
    previewDeleteManyMock.mockReset().mockResolvedValue({ count: 0 })
    previewFindManyMock.mockReset().mockResolvedValue([])
    previewUpdateManyMock.mockReset().mockResolvedValue({ count: 0 })
    previewUpdateMock.mockReset().mockResolvedValue({})
    previewUpsertMock.mockReset().mockResolvedValue({})
    queryRawMock.mockReset().mockResolvedValue([])
    readFileMock.mockReset().mockResolvedValue(Buffer.from('frame'))
    readChapterManifestMock.mockReset().mockResolvedValue(manifest)
    readdirMock.mockReset().mockResolvedValue([])
    renameMock.mockReset().mockResolvedValue(undefined)
    rmdirMock.mockReset().mockResolvedValue(undefined)
    rmMock.mockReset().mockResolvedValue(undefined)
    statMock.mockReset().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    sharpStatsMock.mockReset()
    sharpMock.mockReset().mockImplementation(() => ({ stats: sharpStatsMock }))
  })

  it('uses start plus one second first and falls back inside short chapter bounds', () => {
    expect(buildChapterCaptureTimes(0, 10)).toEqual([1, 3, 5])
    expect(buildChapterCaptureTimes(20, 21)[0]).toBe(20.5)
    expect(buildChapterCaptureTimes(4, 4)).toEqual([4])
  })

  it('calculates weighted frame luminance and supports grayscale frames', () => {
    expect(calculateFrameLuma([{ mean: 10 }])).toBe(10)
    expect(calculateFrameLuma([{ mean: 255 }, { mean: 0 }, { mean: 0 }])).toBeCloseTo(54.213)
  })

  it('reuses a completed preview when manifest hash, path, and file are current', async () => {
    imageFindManyMock.mockResolvedValue([
      video({
        chapterPreviews: [
          {
            id: 'preview-1',
            chapterOrder: 0,
            chaptersHash: '0123456789abcdef-full-hash',
            status: 'COMPLETED',
            previewPath: '7/0123456789abcdef-full-hash/0.webp'
          }
        ]
      })
    ])
    statMock.mockResolvedValue({ isFile: () => true })
    previewFindManyMock.mockResolvedValue([{ previewPath: '7/0123456789abcdef-full-hash/0.webp' }])

    const result = await runVideoChapterPreviewGenerationJob({ scanPath: 'C:/scan' })

    expect(result).toMatchObject({ pending: 0, processed: 0, reused: 1, generated: 0, failed: 0 })
    expect(execFileMock).not.toHaveBeenCalled()
    expect(previewUpsertMock).not.toHaveBeenCalled()
  })

  it('incremental mode reads manifests only for database-selected incomplete previews', async () => {
    queryRawMock.mockResolvedValue([{ id: 7 }])
    imageFindManyMock.mockResolvedValue([video()])
    sharpStatsMock.mockResolvedValue({ channels: [{ mean: 60 }, { mean: 60 }, { mean: 60 }] })

    const result = await runVideoChapterPreviewGenerationJob({ scanPath: 'C:/scan', mode: 'INCREMENTAL' })

    expect(result).toMatchObject({ mode: 'INCREMENTAL', pending: 1, generated: 1, failed: 0 })
    expect(imageFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [7] } } }))
    expect(readChapterManifestMock).toHaveBeenCalledTimes(1)
    expect(previewDeleteManyMock).not.toHaveBeenCalled()
    expect(previewFindManyMock).not.toHaveBeenCalled()
    expect(readdirMock).not.toHaveBeenCalled()
  })

  it('incremental mode does not read chapter files when the database has no incomplete previews', async () => {
    queryRawMock.mockResolvedValue([])

    const result = await runVideoChapterPreviewGenerationJob({ scanPath: 'C:/scan', mode: 'INCREMENTAL' })

    expect(result).toMatchObject({ mode: 'INCREMENTAL', pending: 0, processed: 0, generated: 0 })
    expect(imageFindManyMock).not.toHaveBeenCalled()
    expect(readChapterManifestMock).not.toHaveBeenCalled()
    expect(readdirMock).not.toHaveBeenCalled()
  })

  it('retries a dark start frame and stores the first bright fallback capture time', async () => {
    imageFindManyMock.mockResolvedValue([video()])
    sharpStatsMock
      .mockResolvedValueOnce({ channels: [{ mean: 0 }, { mean: 0 }, { mean: 0 }] })
      .mockResolvedValueOnce({ channels: [{ mean: 60 }, { mean: 60 }, { mean: 60 }] })
    previewFindManyMock.mockResolvedValue([{ previewPath: '7/0123456789abcdef-full-hash/0.webp' }])

    const result = await runVideoChapterPreviewGenerationJob({ scanPath: 'C:/scan' })

    expect(result).toMatchObject({ pending: 1, processed: 1, reused: 0, generated: 1, failed: 0 })
    expect(execFileMock).toHaveBeenCalledTimes(2)
    expect(execFileMock.mock.calls[0]?.[2]).toMatchObject({ timeout: 120_000, killSignal: 'SIGKILL' })
    expect(sharpMock).toHaveBeenCalledWith(expect.any(Buffer))
    expect(previewUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'COMPLETED',
          previewPath: '7/0123456789abcdef-full-hash/0.webp',
          captureTime: 3
        })
      })
    )
    expect(renameMock).toHaveBeenCalledWith(
      expect.stringContaining('.tmp.webp'),
      expect.stringContaining(path.join('7', '0123456789abcdef-full-hash', '0.webp'))
    )
  })

  it('terminates an active ffmpeg process when the task is cancelled and leaves the chapter retryable', async () => {
    imageFindManyMock.mockResolvedValue([video()])
    const checkCancelled = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    childKillMock.mockImplementation(() => true)
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      childKillMock.mockImplementationOnce(() => {
        queueMicrotask(() => callback(Object.assign(new Error('killed'), { killed: true }), '', ''))
        return true
      })
      return { kill: childKillMock }
    })

    await expect(runVideoChapterPreviewGenerationJob({ scanPath: 'C:/scan', checkCancelled })).rejects.toThrow(
      'Task cancelled'
    )

    expect(childKillMock).toHaveBeenCalledWith('SIGKILL')
    expect(previewUpdateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { status: 'PENDING', previewPath: null, previewUpdatedAt: null, error: null }
      })
    )
    expect(rmMock).toHaveBeenCalledWith(expect.stringContaining('.tmp.webp'), { force: true })
  })

  it('marks an ffmpeg timeout as failed so the next task can retry it', async () => {
    imageFindManyMock.mockResolvedValue([video()])
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(Object.assign(new Error('timed out'), { killed: true }), '', '')
      return { kill: childKillMock }
    })

    const result = await runVideoChapterPreviewGenerationJob({ scanPath: 'C:/scan' })

    expect(result).toMatchObject({ processed: 1, generated: 0, failed: 1 })
    expect(previewUpdateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          error: 'FFmpeg timed out after 120000ms'
        })
      })
    )
  })

  it('retries a Windows file lock before promoting the temporary frame', async () => {
    imageFindManyMock.mockResolvedValue([video()])
    sharpStatsMock.mockResolvedValue({ channels: [{ mean: 60 }, { mean: 60 }, { mean: 60 }] })
    previewFindManyMock.mockResolvedValue([{ previewPath: '7/0123456789abcdef-full-hash/0.webp' }])
    renameMock
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EBUSY' }))
      .mockResolvedValueOnce(undefined)

    const result = await runVideoChapterPreviewGenerationJob({ scanPath: 'C:/scan' })

    expect(result).toMatchObject({ generated: 1, failed: 0 })
    expect(renameMock).toHaveBeenCalledTimes(2)
  })

  it('defers a persistently locked orphan instead of failing the whole task', async () => {
    imageFindManyMock.mockResolvedValue([
      video({
        chapterPreviews: [
          {
            id: 'preview-1',
            chapterOrder: 0,
            chaptersHash: '0123456789abcdef-full-hash',
            status: 'COMPLETED',
            previewPath: '7/0123456789abcdef-full-hash/0.webp'
          }
        ]
      })
    ])
    statMock.mockResolvedValue({ isFile: () => true })
    previewFindManyMock.mockResolvedValue([{ previewPath: '7/0123456789abcdef-full-hash/0.webp' }])
    readdirMock.mockResolvedValue([{ name: 'stale.tmp.webp', isDirectory: () => false, isFile: () => true }])
    rmMock.mockRejectedValue(Object.assign(new Error('busy'), { code: 'EBUSY' }))

    const result = await runVideoChapterPreviewGenerationJob({ scanPath: 'C:/scan' })

    expect(result).toMatchObject({ reused: 1, generated: 0, failed: 0, orphanedFilesDeleted: 0 })
    expect(rmMock).toHaveBeenCalledTimes(6)
  })

  it('recursively removes unreferenced chapter files and empty hash directories in full mode', async () => {
    const currentHash = '0123456789abcdef-full-hash'
    const staleHash = 'stale-full-hash'
    imageFindManyMock.mockResolvedValue([
      video({
        chapterPreviews: [
          {
            id: 'preview-1',
            chapterOrder: 0,
            chaptersHash: currentHash,
            status: 'COMPLETED',
            previewPath: `7/${currentHash}/0.webp`
          }
        ]
      })
    ])
    statMock.mockResolvedValue({ isFile: () => true })
    previewFindManyMock.mockResolvedValue([{ previewPath: `7/${currentHash}/0.webp` }])
    readdirMock.mockImplementation(async (directoryPath: string) => {
      const value = String(directoryPath)
      if (value.endsWith(path.join('chapters', '7', currentHash))) {
        return [{ name: '0.webp', isDirectory: () => false, isFile: () => true }]
      }
      if (value.endsWith(path.join('chapters', '7', staleHash))) {
        return [{ name: '1.webp', isDirectory: () => false, isFile: () => true }]
      }
      if (value.endsWith(path.join('chapters', '7'))) {
        return [
          { name: currentHash, isDirectory: () => true, isFile: () => false },
          { name: staleHash, isDirectory: () => true, isFile: () => false }
        ]
      }
      if (value.endsWith('chapters')) {
        return [{ name: '7', isDirectory: () => true, isFile: () => false }]
      }
      return []
    })
    rmdirMock.mockImplementation(async (directoryPath: string) => {
      const value = String(directoryPath)
      if (value.endsWith(path.join('7', currentHash)) || value.endsWith(`${path.sep}7`)) {
        throw Object.assign(new Error('not empty'), { code: 'ENOTEMPTY' })
      }
    })

    const result = await runVideoChapterPreviewGenerationJob({ scanPath: 'C:/scan' })

    expect(result).toMatchObject({ reused: 1, generated: 0, orphanedFilesDeleted: 1 })
    expect(rmMock).toHaveBeenCalledWith(
      expect.stringContaining(path.join('7', staleHash, '1.webp')),
      { force: true }
    )
    expect(rmMock).not.toHaveBeenCalledWith(
      expect.stringContaining(path.join('7', currentHash, '0.webp')),
      expect.anything()
    )
    expect(rmdirMock).toHaveBeenCalledWith(expect.stringContaining(path.join('7', staleHash)))
  })
})
