import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleImageReplaceSession } from '../image-replace-session'

const { getSystemSettingsMock, updateArtworkImagesTransactionMock } = vi.hoisted(() => ({
  getSystemSettingsMock: vi.fn(),
  updateArtworkImagesTransactionMock: vi.fn()
}))

vi.mock('@/services/setting.service', () => ({
  getSystemSettings: getSystemSettingsMock
}))

vi.mock('../image-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../image-manager')>()
  return {
    ...actual,
    updateArtworkImagesTransaction: updateArtworkImagesTransactionMock
  }
})

describe('image-replace-session service', () => {
  let scanRoot: string

  beforeEach(async () => {
    scanRoot = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-image-replace-session-'))
    getSystemSettingsMock.mockReset().mockResolvedValue({ replace_default_tag_ids: [2, 5] })
    updateArtworkImagesTransactionMock.mockReset().mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await rm(scanRoot, { recursive: true, force: true })
  })

  it('initializes a replace session by backing up media and chapter files only', async () => {
    await mkdir(path.join(scanRoot, 'artist/work/.bak_session'), { recursive: true })
    await rm(path.join(scanRoot, 'artist/work/.bak_session'), { recursive: true, force: true })
    await writeFile(path.join(scanRoot, 'artist/work/old.jpg'), 'old-image')
    await writeFile(path.join(scanRoot, 'artist/work/video.chapters.json'), 'chapters')
    await writeFile(path.join(scanRoot, 'artist/work/notes.txt'), 'notes')

    const result = await handleImageReplaceSession({
      scanRoot,
      artworkId: 10,
      artwork: artworkWithStoragePath('/artist/work'),
      action: 'init'
    })

    expect(result).toEqual({
      success: true,
      message: 'Initialized & Backed up',
      uploadTargetDir: path.join(scanRoot, '/artist/work'),
      targetRelDir: '/artist/work'
    })
    await expect(readFile(path.join(scanRoot, 'artist/work/.bak_session/old.jpg'), 'utf8')).resolves.toBe('old-image')
    await expect(readFile(path.join(scanRoot, 'artist/work/.bak_session/video.chapters.json'), 'utf8')).resolves.toBe(
      'chapters'
    )
    await expect(readFile(path.join(scanRoot, 'artist/work/notes.txt'), 'utf8')).resolves.toBe('notes')
    await expect(readdir(path.join(scanRoot, 'artist/work'))).resolves.toEqual(
      expect.arrayContaining(['.bak_session', 'notes.txt'])
    )
  })

  it('commits sorted files, chapter metadata, default tags, and removes backup directory', async () => {
    await mkdir(path.join(scanRoot, 'artist/work/.bak_session'), { recursive: true })
    await writeFile(path.join(scanRoot, 'artist/work/.bak_session/old.jpg'), 'old-image')

    const result = await handleImageReplaceSession({
      scanRoot,
      artworkId: 10,
      artwork: artworkWithStoragePath('/artist/work'),
      action: 'commit',
      readBody: async () => ({
        filesMeta: [imageMeta('b.jpg', 2, '/artist/work/b.jpg'), imageMeta('a.jpg', 1, '/artist/work/a.jpg')],
        chaptersMeta: [
          {
            videoFileName: 'b.jpg',
            chaptersFileName: 'b.chapters.json',
            chaptersPath: '/artist/work/b.chapters.json',
            chaptersCount: 1,
            chaptersDuration: 10,
            chaptersHash: 'hash'
          }
        ]
      })
    })

    expect(result).toEqual({ success: true })
    expect(updateArtworkImagesTransactionMock).toHaveBeenCalledWith(
      10,
      [imageMeta('a.jpg', 1, '/artist/work/a.jpg'), imageMeta('b.jpg', 2, '/artist/work/b.jpg')],
      [
        {
          videoFileName: 'b.jpg',
          chaptersFileName: 'b.chapters.json',
          chaptersPath: '/artist/work/b.chapters.json',
          chaptersCount: 1,
          chaptersDuration: 10,
          chaptersHash: 'hash'
        }
      ],
      { appendTagIds: [2, 5] }
    )
    await expect(readdir(path.join(scanRoot, 'artist/work/.bak_session'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects duplicate file paths with existing details payload', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(
        handleImageReplaceSession({
          scanRoot,
          artworkId: 10,
          artwork: artworkWithStoragePath('/artist/work'),
          action: 'commit',
          readBody: async () => ({
            filesMeta: [imageMeta('a.jpg', 1, '/artist/work/a.jpg'), imageMeta('copy.jpg', 2, '/artist/work/a.jpg')]
          })
        })
      ).rejects.toMatchObject({
        status: 400,
        message: 'Duplicate files detected',
        details: ['/artist/work/a.jpg']
      })
      expect(consoleErrorSpy).toHaveBeenCalledWith('Duplicate paths detected:', ['/artist/work/a.jpg'])
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('rolls back by deleting current files and restoring backup files', async () => {
    await mkdir(path.join(scanRoot, 'artist/work/.bak_session'), { recursive: true })
    await writeFile(path.join(scanRoot, 'artist/work/new.jpg'), 'new-image')
    await writeFile(path.join(scanRoot, 'artist/work/.bak_session/old.jpg'), 'old-image')

    const result = await handleImageReplaceSession({
      scanRoot,
      artworkId: 10,
      artwork: artworkWithStoragePath('/artist/work'),
      action: 'rollback'
    })

    expect(result).toEqual({ success: true, message: 'Rolled back successfully' })
    await expect(readFile(path.join(scanRoot, 'artist/work/old.jpg'), 'utf8')).resolves.toBe('old-image')
    await expect(readFile(path.join(scanRoot, 'artist/work/new.jpg'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readdir(path.join(scanRoot, 'artist/work/.bak_session'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

function artworkWithStoragePath(storagePath: string) {
  return {
    externalId: 'work',
    storagePath,
    artist: { userId: 'artist' },
    images: [{ path: `${storagePath}/old.jpg` }]
  }
}

function imageMeta(fileName: string, order: number, imagePath: string) {
  return {
    fileName,
    order,
    width: 100,
    height: 120,
    size: 2048,
    path: imagePath
  }
}
