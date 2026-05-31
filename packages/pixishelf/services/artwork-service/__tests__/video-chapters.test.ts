import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

const { getScanPathMock } = vi.hoisted(() => ({
  getScanPathMock: vi.fn()
}))
const { findUniqueMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/services/setting.service', () => ({
  getScanPath: getScanPathMock
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    image: {
      findUnique: findUniqueMock
    }
  }
}))

import {
  discoverChaptersForVideo,
  getVideoChapterManifestByImageId,
  getChapterPathCandidates,
  resolveCanonicalChapterPath,
  validateChapterManifest
} from '../video-chapters'

describe('validateChapterManifest', () => {
  it('should accept valid manifest and normalize empty title', async () => {
    const manifest = await validateChapterManifest({
      version: 1,
      duration: 20,
      chapters: [
        { index: 1, title: '  Opening  ', start: 0, end: 10, duration: 10 },
        { index: 2, title: '   ', start: 10, end: 20, duration: 10 }
      ]
    })

    expect(manifest.chapters[0]?.title).toBe('Opening')
    expect(manifest.chapters[1]?.title).toBe('Chapter 2')
  })

  it('should reject unsupported version', async () => {
    await expect(
      validateChapterManifest({
        version: 2,
        duration: 20,
        chapters: [{ index: 1, title: 'Opening', start: 0, end: 20, duration: 20 }]
      })
    ).rejects.toThrow()
  })

  it('should reject invalid timeline overlap', async () => {
    await expect(
      validateChapterManifest({
        version: 1,
        duration: 20,
        chapters: [
          { index: 1, title: 'A', start: 0, end: 12, duration: 12 },
          { index: 2, title: 'B', start: 11.9, end: 20, duration: 8.1 }
        ]
      })
    ).rejects.toThrow('overlaps')
  })

  it('should reject duration mismatch', async () => {
    await expect(
      validateChapterManifest({
        version: 1,
        duration: 10,
        chapters: [{ index: 1, title: 'A', start: 0, end: 5, duration: 4.8 }]
      })
    ).rejects.toThrow('duration does not match')
  })
})

describe('chapter path helpers', () => {
  it('should build both single-dot and legacy double-dot candidates', () => {
    expect(getChapterPathCandidates('/artist/artwork/video.mp4')).toEqual([
      '/artist/artwork/video.chapters.json',
      '/artist/artwork/video..chapters.json'
    ])
  })

  it('should normalize windows-style path to canonical chapter path', () => {
    expect(resolveCanonicalChapterPath('artist\\artwork\\video.mp4')).toBe('/artist/artwork/video.chapters.json')
  })
})

describe('discoverChaptersForVideo', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-video-chapters-'))
    getScanPathMock.mockResolvedValue(tempDir)
  })

  afterEach(async () => {
    getScanPathMock.mockReset()
    findUniqueMock.mockReset()
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('should discover canonical chapter file and return summary meta', async () => {
    await writeManifestFile(tempDir, '/artist/artwork/video.chapters.json', {
      version: 1,
      duration: 20,
      chapters: [
        { index: 1, title: 'Opening', start: 0, end: 8, duration: 8 },
        { index: 2, title: 'Ending', start: 8, end: 20, duration: 12 }
      ]
    })

    const meta = await discoverChaptersForVideo('/artist/artwork/video.mp4')

    expect(meta).toEqual({
      chaptersPath: '/artist/artwork/video.chapters.json',
      chaptersCount: 2,
      chaptersDuration: 20,
      chaptersHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
  })

  it('should discover legacy double-dot chapter file when canonical file is absent', async () => {
    await writeManifestFile(tempDir, '/artist/artwork/video..chapters.json', {
      version: 1,
      duration: 12.5,
      chapters: [{ index: 1, title: 'Legacy', start: 0, end: 12.5, duration: 12.5 }]
    })

    const meta = await discoverChaptersForVideo('/artist/artwork/video.mp4')

    expect(meta?.chaptersPath).toBe('/artist/artwork/video..chapters.json')
    expect(meta?.chaptersCount).toBe(1)
    expect(meta?.chaptersDuration).toBe(12.5)
  })

  it('should read chapter manifest by image id', async () => {
    await writeManifestFile(tempDir, '/artist/artwork/video.chapters.json', {
      version: 1,
      duration: 20,
      chapters: [
        { index: 1, title: 'Opening', start: 0, end: 8, duration: 8 },
        { index: 2, title: 'Ending', start: 8, end: 20, duration: 12 }
      ]
    })
    findUniqueMock.mockResolvedValue({
      id: 1,
      path: '/artist/artwork/video.mp4',
      chaptersPath: '/artist/artwork/video.chapters.json'
    })

    const manifest = await getVideoChapterManifestByImageId(1)

    expect(manifest).toEqual({
      source: 'chapters-file',
      version: 1,
      duration: 20,
      chapters: [
        { index: 1, title: 'Opening', start: 0, end: 8, duration: 8 },
        { index: 2, title: 'Ending', start: 8, end: 20, duration: 12 }
      ]
    })
  })

  it('should return null when image has no chapters path', async () => {
    findUniqueMock.mockResolvedValue({
      id: 2,
      path: '/artist/artwork/video.mp4',
      chaptersPath: null
    })

    await expect(getVideoChapterManifestByImageId(2)).resolves.toBeNull()
  })
})

async function writeManifestFile(scanRoot: string, relativePath: string, manifest: unknown) {
  const absolutePath = path.join(scanRoot, relativePath.replace(/^\/+/, ''))
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  await fs.writeFile(absolutePath, JSON.stringify(manifest), 'utf8')
}
