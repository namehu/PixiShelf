import fsPromises, { mkdtemp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleImageReplaceSession } from '../image-replace-session'

const { beginAnimationReplaceSessionWriteMock, captureAnimationReplaceRollbackWriteTokensMock, finishAnimationSourcePathWriteMock } = vi.hoisted(() => ({
  beginAnimationReplaceSessionWriteMock: vi.fn(),
  captureAnimationReplaceRollbackWriteTokensMock: vi.fn(),
  finishAnimationSourcePathWriteMock: vi.fn()
}))

vi.mock('../animation-source-guard', () => ({
  beginAnimationReplaceSessionWrite: beginAnimationReplaceSessionWriteMock,
  captureAnimationReplaceRollbackWriteTokens: captureAnimationReplaceRollbackWriteTokensMock,
  finishAnimationSourcePathWrite: finishAnimationSourcePathWriteMock
}))

vi.mock('../replace-write-lock', () => ({
  ReplaceWriteBusyError: class extends Error {},
  withReplaceWriteLock: async (_targetDir: string, action: () => Promise<unknown>) => action()
}))

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
    beginAnimationReplaceSessionWriteMock.mockReset().mockResolvedValue(undefined)
    captureAnimationReplaceRollbackWriteTokensMock.mockReset().mockResolvedValue([])
    finishAnimationSourcePathWriteMock.mockReset().mockResolvedValue(undefined)
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

  it('resumes an interrupted init using its manifest without adopting new upload files', async () => {
    await mkdir(path.join(scanRoot, 'artist/work/.bak_session'), { recursive: true })
    await writeFile(path.join(scanRoot, 'artist/work/.bak_session/old.webp'), 'backed-original')
    await writeFile(path.join(scanRoot, 'artist/work/unmoved.webp'), 'unmoved-original')
    await writeFile(path.join(scanRoot, 'artist/work/upload.webp'), 'new-upload')
    const backup = path.join(scanRoot, 'artist/work/.bak_session/old.webp')
    const unmoved = path.join(scanRoot, 'artist/work/unmoved.webp')
    await writeFile(path.join(scanRoot, 'artist/work/.bak_session/.session-manifest.json'), JSON.stringify({
      version: 1,
      originalFiles: ['old.webp', 'unmoved.webp'],
      originalStates: { 'old.webp': await fileIdentity(backup), 'unmoved.webp': await fileIdentity(unmoved) }
    }))

    await handleImageReplaceSession({
      scanRoot,
      artworkId: 10,
      artwork: artworkWithStoragePath('/artist/work'),
      action: 'init'
    })

    await expect(readFile(path.join(scanRoot, 'artist/work/.bak_session/unmoved.webp'), 'utf8')).resolves.toBe('unmoved-original')
    await expect(readFile(path.join(scanRoot, 'artist/work/upload.webp'), 'utf8')).resolves.toBe('new-upload')
    expect(beginAnimationReplaceSessionWriteMock).toHaveBeenCalledWith(10)
  })

  it('does not guess how to recover a legacy backup that has no manifest', async () => {
    await mkdir(path.join(scanRoot, 'artist/work/.bak_session'), { recursive: true })
    await writeFile(path.join(scanRoot, 'artist/work/.bak_session/old.webp'), 'backed-original')
    await writeFile(path.join(scanRoot, 'artist/work/unmoved.webp'), 'unmoved-original')

    await expect(handleImageReplaceSession({
      scanRoot,
      artworkId: 10,
      artwork: artworkWithStoragePath('/artist/work'),
      action: 'init'
    })).rejects.toMatchObject({ status: 409 })
    await expect(readFile(path.join(scanRoot, 'artist/work/unmoved.webp'), 'utf8')).resolves.toBe('unmoved-original')
    await expect(readFile(path.join(scanRoot, 'artist/work/.bak_session/old.webp'), 'utf8')).resolves.toBe('backed-original')
  })

  it('commits sorted files, chapter metadata, default tags, and removes backup directory', async () => {
    await mkdir(path.join(scanRoot, 'artist/work/.bak_session'), { recursive: true })
    await writeFile(path.join(scanRoot, 'artist/work/.bak_session/old.jpg'), 'old-image')
    await writeFile(path.join(scanRoot, 'artist/work/.bak_session/.session-manifest.json'), JSON.stringify({
      version: 1, originalFiles: ['old.jpg'], phase: 'READY'
    }))

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
    await writeFile(path.join(scanRoot, 'artist/work/.bak_session/.session-manifest.json'), JSON.stringify({
      version: 1,
      originalFiles: ['old.jpg']
    }))

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

  it('preserves an original that an interrupted init had not moved yet', async () => {
    await mkdir(path.join(scanRoot, 'artist/work/.bak_session'), { recursive: true })
    await writeFile(path.join(scanRoot, 'artist/work/unmoved.webp'), 'original')
    await writeFile(path.join(scanRoot, 'artist/work/new.webp'), 'upload')
    await writeFile(path.join(scanRoot, 'artist/work/.bak_session/old.webp'), 'backed-original')
    const backup = path.join(scanRoot, 'artist/work/.bak_session/old.webp')
    const unmoved = path.join(scanRoot, 'artist/work/unmoved.webp')
    await writeFile(path.join(scanRoot, 'artist/work/.bak_session/.session-manifest.json'), JSON.stringify({
      version: 1,
      originalFiles: ['old.webp', 'unmoved.webp'],
      originalStates: { 'old.webp': await fileIdentity(backup), 'unmoved.webp': await fileIdentity(unmoved) }
    }))
    captureAnimationReplaceRollbackWriteTokensMock.mockResolvedValue([{ imageId: 7, sourceRevision: 2 }])

    await handleImageReplaceSession({
      scanRoot,
      artworkId: 10,
      artwork: artworkWithStoragePath('/artist/work'),
      action: 'rollback'
    })

    await expect(readFile(path.join(scanRoot, 'artist/work/unmoved.webp'), 'utf8')).resolves.toBe('original')
    await expect(readFile(path.join(scanRoot, 'artist/work/old.webp'), 'utf8')).resolves.toBe('backed-original')
    await expect(readFile(path.join(scanRoot, 'artist/work/new.webp'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(captureAnimationReplaceRollbackWriteTokensMock).toHaveBeenCalledWith(10)
    expect(finishAnimationSourcePathWriteMock).toHaveBeenCalledWith([{ imageId: 7, sourceRevision: 2 }])
  })

  it('refuses rollback before deleting uploads when a manifest original is missing', async () => {
    await mkdir(path.join(scanRoot, 'artist/work/.bak_session'), { recursive: true })
    await writeFile(path.join(scanRoot, 'artist/work/new.webp'), 'new-upload')
    await writeFile(path.join(scanRoot, 'artist/work/.bak_session/.session-manifest.json'), JSON.stringify({
      version: 1,
      originalFiles: ['missing.webp']
    }))

    await expect(handleImageReplaceSession({
      scanRoot,
      artworkId: 10,
      artwork: artworkWithStoragePath('/artist/work'),
      action: 'rollback'
    })).rejects.toMatchObject({ status: 409 })
    await expect(readFile(path.join(scanRoot, 'artist/work/new.webp'), 'utf8')).resolves.toBe('new-upload')
    expect(finishAnimationSourcePathWriteMock).not.toHaveBeenCalled()
  })

  it('restores a real renamed original even when rename changes ctime', async () => {
    const target = path.join(scanRoot, 'artist/work')
    await mkdir(target, { recursive: true })
    await writeFile(path.join(target, 'original.webp'), 'original-bytes')
    const input = {
      scanRoot, artworkId: 10, artwork: artworkWithStoragePath('/artist/work')
    }
    await handleImageReplaceSession({ ...input, action: 'init' })
    await writeFile(path.join(target, 'new.webp'), 'new-upload')
    await handleImageReplaceSession({ ...input, action: 'rollback' })
    await expect(readFile(path.join(target, 'original.webp'), 'utf8')).resolves.toBe('original-bytes')
    await expect(readFile(path.join(target, 'new.webp'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to call a same-name replacement an unmoved original', async () => {
    const target = path.join(scanRoot, 'artist/work')
    const backupDir = path.join(target, '.bak_session')
    await mkdir(backupDir, { recursive: true })
    const original = path.join(target, 'original.webp')
    await writeFile(original, 'original')
    const originalStates = { 'original.webp': await fileIdentity(original) }
    await writeFile(path.join(backupDir, '.session-manifest.json'), JSON.stringify({
      version: 1, originalFiles: ['original.webp'], originalStates
    }))
    await rm(original)
    await writeFile(original, 'replacement')
    await expect(handleImageReplaceSession({
      scanRoot, artworkId: 10, artwork: artworkWithStoragePath('/artist/work'), action: 'rollback'
    })).rejects.toMatchObject({ status: 409 })
    await expect(readFile(original, 'utf8')).resolves.toBe('replacement')
    expect(finishAnimationSourcePathWriteMock).not.toHaveBeenCalled()
  })

  it('continues a rollback interrupted after one real file rename', async () => {
    const target = path.join(scanRoot, 'artist/work')
    await mkdir(target, { recursive: true })
    await writeFile(path.join(target, 'a.webp'), 'original-a')
    await writeFile(path.join(target, 'b.webp'), 'original-b')
    const input = { scanRoot, artworkId: 10, artwork: artworkWithStoragePath('/artist/work') }
    await handleImageReplaceSession({ ...input, action: 'init' })
    await writeFile(path.join(target, 'new.webp'), 'replacement')
    const actualRename = fsPromises.rename.bind(fsPromises)
    let restored = 0
    const rename = vi.spyOn(fsPromises, 'rename').mockImplementation(async (source, destination) => {
      if (String(source).endsWith('.webp') && String(source).includes('.bak_session')) {
        restored++
        if (restored === 2) throw new Error('interrupted after first restore')
      }
      return actualRename(source, destination)
    })
    try {
      await expect(handleImageReplaceSession({ ...input, action: 'rollback' })).rejects.toThrow('interrupted after first restore')
    } finally {
      rename.mockRestore()
    }
    await handleImageReplaceSession({ ...input, action: 'rollback' })
    await expect(readFile(path.join(target, 'a.webp'), 'utf8')).resolves.toBe('original-a')
    await expect(readFile(path.join(target, 'b.webp'), 'utf8')).resolves.toBe('original-b')
    await expect(readFile(path.join(target, 'new.webp'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses automatic rollback when a commit may already have changed database rows', async () => {
    const backupDir = path.join(scanRoot, 'artist/work/.bak_session')
    await mkdir(backupDir, { recursive: true })
    await writeFile(path.join(backupDir, 'old.webp'), 'original')
    await writeFile(path.join(backupDir, '.session-manifest.json'), JSON.stringify({
      version: 1, originalFiles: ['old.webp'], phase: 'COMMITTING'
    }))
    await expect(handleImageReplaceSession({
      scanRoot, artworkId: 10, artwork: artworkWithStoragePath('/artist/work'), action: 'rollback'
    })).rejects.toMatchObject({ status: 409 })
    await expect(readFile(path.join(backupDir, 'old.webp'), 'utf8')).resolves.toBe('original')
    expect(finishAnimationSourcePathWriteMock).not.toHaveBeenCalled()
  })

  it('rejects a backup directory symlink or junction before touching outside files', async () => {
    const target = path.join(scanRoot, 'artist/work')
    const outside = path.join(scanRoot, 'outside')
    await mkdir(target, { recursive: true })
    await mkdir(outside)
    await writeFile(path.join(outside, 'old.webp'), 'outside-original')
    await symlink(outside, path.join(target, '.bak_session'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(handleImageReplaceSession({
      scanRoot, artworkId: 10, artwork: artworkWithStoragePath('/artist/work'), action: 'rollback'
    })).rejects.toMatchObject({ status: 409 })
    await expect(readFile(path.join(outside, 'old.webp'), 'utf8')).resolves.toBe('outside-original')
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

async function fileIdentity(filePath: string) {
  const value = await stat(filePath, { bigint: true })
  return {
    size: String(value.size), mtimeNs: String(value.mtimeNs), ctimeNs: String(value.ctimeNs),
    deviceId: String(value.dev), inode: String(value.ino)
  }
}
