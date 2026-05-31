import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaFileInfo } from './media-collector'

vi.mock('server-only', () => ({}))
vi.mock('@/services/setting.service', () => ({
  getScanPath: vi.fn()
}))

import { buildScannedImageCreateData } from './scan-image-builder'

describe('buildScannedImageCreateData', () => {
  let scanPath: string

  beforeEach(async () => {
    scanPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-scan-image-builder-'))
  })

  afterEach(async () => {
    await fs.rm(scanPath, { recursive: true, force: true })
  })

  it('should attach chapter metadata for scanned video files', async () => {
    const mediaFiles = [await createMediaFile(scanPath, '/artist/artwork/100_p0.mp4')]

    await writeChapterManifest(scanPath, '/artist/artwork/100_p0.chapters.json', {
      version: 1,
      duration: 20,
      chapters: [
        { index: 1, title: 'Opening', start: 0, end: 8, duration: 8 },
        { index: 2, title: 'Ending', start: 8, end: 20, duration: 12 }
      ]
    })

    const records = await buildScannedImageCreateData({
      mediaFiles,
      artworkId: 99,
      scanPath
    })

    expect(records).toEqual([
      {
        artworkId: 99,
        path: '/artist/artwork/100_p0.mp4',
        size: 3,
        sortOrder: 0,
        chaptersPath: '/artist/artwork/100_p0.chapters.json',
        chaptersCount: 2,
        chaptersDuration: 20,
        chaptersUpdatedAt: expect.any(Date),
        chaptersHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    ])
  })

  it('should clear chapter fields when no chapter file is found during rescan rebuild', async () => {
    const mediaFiles = [await createMediaFile(scanPath, '/artist/artwork/100_p0.mp4')]

    await writeChapterManifest(scanPath, '/artist/artwork/100_p0.chapters.json', {
      version: 1,
      duration: 10,
      chapters: [{ index: 1, title: 'Only', start: 0, end: 10, duration: 10 }]
    })

    const withChapters = await buildScannedImageCreateData({
      mediaFiles,
      artworkId: 99,
      scanPath
    })

    expect(withChapters[0]?.chaptersPath).toBe('/artist/artwork/100_p0.chapters.json')

    await fs.unlink(path.join(scanPath, 'artist', 'artwork', '100_p0.chapters.json'))

    const withoutChapters = await buildScannedImageCreateData({
      mediaFiles,
      artworkId: 99,
      scanPath
    })

    expect(withoutChapters).toEqual([
      {
        artworkId: 99,
        path: '/artist/artwork/100_p0.mp4',
        size: 3,
        sortOrder: 0,
        chaptersPath: null,
        chaptersCount: 0,
        chaptersDuration: null,
        chaptersUpdatedAt: null,
        chaptersHash: null
      }
    ])
  })
})

async function createMediaFile(scanPath: string, relativePath: string): Promise<MediaFileInfo> {
  const absolutePath = path.join(scanPath, relativePath.replace(/^\/+/, ''))
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  await fs.writeFile(absolutePath, 'mp4', 'utf8')

  return {
    path: absolutePath,
    filename: path.basename(absolutePath),
    extension: '.mp4',
    size: 3,
    artworkId: '100',
    pageIndex: 0,
    sortOrder: 0
  }
}

async function writeChapterManifest(scanPath: string, relativePath: string, manifest: unknown) {
  const absolutePath = path.join(scanPath, relativePath.replace(/^\/+/, ''))
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  await fs.writeFile(absolutePath, JSON.stringify(manifest), 'utf8')
}
