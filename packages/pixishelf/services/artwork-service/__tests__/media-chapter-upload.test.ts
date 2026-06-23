import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadMediaChapterManifest } from '../media-chapter-upload'

const { artworkFindUniqueMock, imageFindUniqueMock, associateChaptersToImageMock } = vi.hoisted(() => ({
  artworkFindUniqueMock: vi.fn(),
  imageFindUniqueMock: vi.fn(),
  associateChaptersToImageMock: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    artwork: {
      findUnique: artworkFindUniqueMock
    },
    image: {
      findUnique: imageFindUniqueMock
    }
  }
}))
vi.mock('../image-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../image-manager')>()
  return {
    ...actual,
    associateChaptersToImage: associateChaptersToImageMock
  }
})

describe('media-chapter-upload service', () => {
  let scanRoot: string

  beforeEach(async () => {
    scanRoot = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-media-chapter-upload-'))
    artworkFindUniqueMock.mockReset()
    imageFindUniqueMock.mockReset()
    associateChaptersToImageMock.mockReset().mockResolvedValue({})
  })

  afterEach(async () => {
    await rm(scanRoot, { recursive: true, force: true })
  })

  it('writes canonical manifest, removes legacy candidates, and associates chapters to image', async () => {
    await mkdir(path.join(scanRoot, 'artist/work'), { recursive: true })
    await writeFile(path.join(scanRoot, 'artist/work/movie.mp4.chapters.json'), '{"legacy":true}', 'utf8')
    await writeFile(path.join(scanRoot, 'artist/work/movie..chapters.json'), '{"legacy":true}', 'utf8')
    artworkFindUniqueMock.mockResolvedValue({
      id: 10,
      externalId: 'work',
      storagePath: '/artist/work',
      artist: { userId: 'artist' },
      images: [{ path: '/artist/work/movie.mp4' }]
    })
    imageFindUniqueMock.mockResolvedValue({
      id: 20,
      artworkId: 10,
      path: '/artist/work/movie.mp4'
    })

    const result = await uploadMediaChapterManifest({
      scanRoot,
      artworkId: 10,
      imageId: 20,
      videoPath: '',
      manifestText: JSON.stringify({
        version: 1,
        duration: 20,
        chapters: [
          { index: 1, title: 'Opening', start: 0, end: 8, duration: 8 },
          { index: 2, title: 'Ending', start: 8, end: 20, duration: 12 }
        ]
      })
    })

    expect(result).toEqual({
      videoFileName: 'movie.mp4',
      chaptersFileName: 'movie.chapters.json',
      chaptersPath: '/artist/work/movie.chapters.json',
      chaptersCount: 2,
      chaptersDuration: 20,
      chaptersHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
    await expect(readFile(path.join(scanRoot, 'artist/work/movie.chapters.json'), 'utf8')).resolves.toContain(
      '"title": "Opening"'
    )
    await expect(readFile(path.join(scanRoot, 'artist/work/movie.mp4.chapters.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(readFile(path.join(scanRoot, 'artist/work/movie..chapters.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect(associateChaptersToImageMock).toHaveBeenCalledWith({
      imageId: 20,
      chaptersPath: '/artist/work/movie.chapters.json',
      chaptersCount: 2,
      chaptersDuration: 20,
      chaptersHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
  })

  it('uses explicit videoPath when imageId is absent', async () => {
    artworkFindUniqueMock.mockResolvedValue({
      id: 10,
      externalId: 'work',
      storagePath: '/artist/work',
      artist: { userId: 'artist' },
      images: [{ path: '/artist/work/movie.mp4' }]
    })

    const result = await uploadMediaChapterManifest({
      scanRoot,
      artworkId: 10,
      imageId: null,
      videoPath: 'artist/work/movie.mp4',
      manifestText: JSON.stringify({
        version: 1,
        duration: 10,
        chapters: [{ index: 1, title: 'Only', start: 0, end: 10, duration: 10 }]
      })
    })

    expect(result.videoFileName).toBe('movie.mp4')
    expect(result.chaptersPath).toBe('/artist/work/movie.chapters.json')
    expect(imageFindUniqueMock).not.toHaveBeenCalled()
    expect(associateChaptersToImageMock).not.toHaveBeenCalled()
  })

  it('rejects a non-video path with the existing message', async () => {
    artworkFindUniqueMock.mockResolvedValue({
      id: 10,
      externalId: 'work',
      storagePath: '/artist/work',
      artist: { userId: 'artist' },
      images: [{ path: '/artist/work/cover.jpg' }]
    })

    await expect(
      uploadMediaChapterManifest({
        scanRoot,
        artworkId: 10,
        imageId: null,
        videoPath: '/artist/work/cover.jpg',
        manifestText: '{}'
      })
    ).rejects.toMatchObject({ status: 400, message: 'Chapter manifest can only be attached to video media' })
  })

  it('rejects videos outside the artwork media directory with the existing message', async () => {
    artworkFindUniqueMock.mockResolvedValue({
      id: 10,
      externalId: 'work',
      storagePath: '/artist/work',
      artist: { userId: 'artist' },
      images: [{ path: '/artist/work/movie.mp4' }]
    })

    await expect(
      uploadMediaChapterManifest({
        scanRoot,
        artworkId: 10,
        imageId: null,
        videoPath: '/artist/other/movie.mp4',
        manifestText: '{}'
      })
    ).rejects.toMatchObject({ status: 400, message: 'Video path does not belong to artwork media directory' })
  })
})
