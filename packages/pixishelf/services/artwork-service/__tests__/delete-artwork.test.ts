// @vitest-environment node
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findArtwork: vi.fn(),
  otherArtworks: vi.fn(),
  findImages: vi.fn(),
  deleteImages: vi.fn(),
  deleteArtwork: vi.fn(),
  scanPath: vi.fn(),
  maintenance: vi.fn(),
  log: vi.fn(),
  lockCatalog: vi.fn(),
  lockArtwork: vi.fn().mockResolvedValue({ id: 1, mediaRevision: 1 })
}))
vi.mock('@pixishelf/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pixishelf/db')>()),
  lockCreatorCatalog: mocks.lockCatalog,
  lockArtworkForReading: mocks.lockArtwork
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    artwork: { findUnique: mocks.findArtwork, findMany: mocks.otherArtworks, delete: mocks.deleteArtwork },
    image: { findMany: mocks.findImages, deleteMany: mocks.deleteImages },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        image: { deleteMany: mocks.deleteImages, findMany: mocks.findImages },
        artwork: { delete: mocks.deleteArtwork }
      })
  }
}))
vi.mock('@/services/setting.service', () => ({ getScanPath: mocks.scanPath }))
vi.mock('@/services/archive/archive-maintenance-service', () => ({
  requestArchiveArtworkMaintenance: mocks.maintenance
}))
vi.mock('@/lib/logger', () => ({ default: { info: mocks.log, warn: mocks.log, error: mocks.log } }))

import { deleteArtwork, previewDeleteArtwork } from '../delete-artwork'
import { ArtworkFileDeletion, determineDeleteDirectory, normalizeDeletePath } from '../delete-artwork-files'
import {
  countArtworkDeleteEntries,
  formatArtworkDeleteReport,
  type ArtworkDeleteReport
} from '@/schemas/artwork-delete.dto'

let root: string
let media: Array<{ path: string; chaptersPath: string | null }>
let artwork: {
  id: number
  title: string
  createdVia: string
  storagePath: string | null
  storageKey: string | null
  metaSource: string | null
  externalId: string | null
  externalRefs: Array<{ externalId: string }>
}
const directory = 'local-imports/artist/work'
const metadata = JSON.stringify({ id: 42, userId: '100', user: 'Artist', title: 'Work' })
const chapter = JSON.stringify({
  version: 1,
  duration: 3,
  chapters: [{ index: 1, title: 'chapter', start: 0, end: 3, duration: 3 }]
})
async function write(relative: string, content = 'fixture') {
  const absolute = path.join(root, relative)
  await fs.mkdir(path.dirname(absolute), { recursive: true })
  await fs.writeFile(absolute, content)
}
async function exists(relative: string) {
  return fs.stat(path.join(root, relative)).then(
    () => true,
    () => false
  )
}
const run = async (selectedPaths?: string[]) => {
  const preview = await previewDeleteArtwork(1)
  return deleteArtwork(
    {
      artworkId: 1,
      ...(artwork.createdVia === 'URL_ARCHIVE'
        ? {}
        : {
            selectedPaths:
              selectedPaths ??
              preview.entries
                .filter((entry) => entry.selection === 'REQUIRED' || entry.selection === 'OPTIONAL')
                .map((entry) => entry.path)
          })
    },
    { requestedByUserId: 'admin-1' }
  )
}
beforeEach(async () => {
  vi.resetAllMocks()
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-delete-'))
  artwork = {
    id: 1,
    title: '测试作品',
    createdVia: 'LOCAL_DIRECTORY',
    storagePath: directory,
    storageKey: null,
    externalId: null,
    metaSource: null,
    externalRefs: []
  }
  media = [{ path: `${directory}/1.jpg`, chaptersPath: null }]
  mocks.findArtwork.mockImplementation(async () => artwork)
  mocks.otherArtworks.mockResolvedValue([])
  mocks.findImages.mockImplementation(async (args) => (args.where.artworkId === 1 ? media : []))
  mocks.deleteImages.mockImplementation(async () => ({ count: media.length }))
  mocks.deleteArtwork.mockResolvedValue({ id: 1 })
  mocks.scanPath.mockImplementation(async () => root)
  mocks.maintenance.mockResolvedValue({ artworkId: 1, lifecycleState: 'TRASHING', jobId: 'job-1', reused: false })
})
afterEach(async () => {
  vi.restoreAllMocks()
  const resolved = path.resolve(root)
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolved).startsWith('pixishelf-delete-')
  ) {
    throw new Error('Unsafe fixture cleanup target')
  }
  await fs.rm(resolved, { recursive: true, force: true })
})

describe('deleteArtwork actual filesystem results', () => {
  it('allows explicitly selected metadata independently of its contents or source identity', async () => {
    await write(media[0]!.path)
    artwork.metaSource = `${directory}/42-meta.json`
    artwork.externalRefs = [{ externalId: '99' }]
    await write(artwork.metaSource, metadata)
    const report = await run()
    expect(report.counts.sidecars).toBe(1)
    expect(await exists(artwork.metaSource)).toBe(false)
  })
  it('skips subtree cleanup when another work declares a nested directory', async () => {
    await write(media[0]!.path)
    await fs.mkdir(path.join(root, directory, 'other-work'), { recursive: true })
    mocks.otherArtworks.mockResolvedValue([{ storagePath: `${directory}/other-work`, metaSource: null }])
    const report = await run()
    expect(report.counts.media).toBe(1)
    expect(report.counts.directories).toBe(0)
    expect(report.inspectionComplete).toBe(true)
    expect(await exists(`${directory}/other-work`)).toBe(true)
  })
  it('keeps a junction target outside the configured scan root untouched', async () => {
    await write('outside/sentinel.txt', 'keep')
    await fs.mkdir(path.join(root, 'scan/local-imports/artist'), { recursive: true })
    await fs.symlink(
      path.join(root, 'outside'),
      path.join(root, 'scan', directory),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    mocks.scanPath.mockResolvedValue(path.join(root, 'scan'))
    media = [{ path: `${directory}/sentinel.txt`, chaptersPath: null }]
    const report = await run()
    expect(report.counts.media).toBe(0)
    expect(report.inspectionComplete).toBe(false)
    expect(await fs.readFile(path.join(root, 'outside/sentinel.txt'), 'utf8')).toBe('keep')
  })
  it('removes only the work and empty descendants, reporting every actual deletion', async () => {
    await write(media[0]!.path)
    await fs.mkdir(path.join(root, directory, 'empty', 'nested'), { recursive: true })
    const report = await run()
    expect(report.outcome).toBe('COMPLETED')
    expect(report.counts).toMatchObject({ media: 1, sidecars: 0, directories: 3, failed: 0 })
    expect(report.database).toMatchObject({ artwork: 'DELETED', media: 'DELETED', deletedMediaCount: 1 })
    expect(report.inspectionComplete).toBe(true)
    for (const entry of report.entries.filter((entry) => entry.status === 'DELETED')) {
      expect(await exists(entry.path)).toBe(false)
    }
    expect(await exists('local-imports/artist')).toBe(true)
    expect(await exists('local-imports')).toBe(true)
    expect(JSON.stringify(report)).not.toContain(root)
  })
  it('preserves deselected files and includes their exact paths and reasons', async () => {
    await write(media[0]!.path)
    for (const name of ['readme.txt', 'cover.png', 'original.zip', '.DS_Store']) {
      await write(`${directory}/${name}`, name)
    }
    const report = await run([media[0]!.path])
    expect(report.outcome).toBe('COMPLETED')
    expect(report.counts.retained).toBe(5)
    expect(report.counts.directories).toBe(0)
    for (const name of ['readme.txt', 'cover.png', 'original.zip', '.DS_Store']) {
      expect(await fs.readFile(path.join(root, directory, name), 'utf8')).toBe(name)
      expect(report.entries).toContainEqual(
        expect.objectContaining({ path: `${directory}/${name}`, status: 'RETAINED' })
      )
    }
  })
  it('deletes selected Pixiv JSON/TXT/page variants including unrecognized metadata', async () => {
    artwork.createdVia = 'PIXIV_SCAN'
    artwork.externalId = '42'
    artwork.storagePath = null
    media = [{ path: 'artist/42/42_p0.jpg', chaptersPath: null }]
    await write(media[0]!.path)
    const json = (id: number) => JSON.stringify({ id, userId: '100', user: 'Artist', title: 'Work' })
    await write('artist/42/42-meta.json', json(42))
    await write('artist/42/42_p1-meta.json', json(42))
    await write('artist/42/42-meta.txt', 'ID\n42\n\nUser\nArtist\n\nUserID\n100\n\nTitle\nWork\n')
    await write('artist/42/42_p2-meta.json', json(99))
    await write('artist/42/42_p3-meta.json', '{')
    await write('artist/42/99-meta.json', json(99))
    const report = await run()
    expect(report.counts.sidecars).toBe(6)
    expect(report.outcome).toBe('COMPLETED')
    for (const file of ['42_p2-meta.json', '42_p3-meta.json', '99-meta.json']) {
      expect(await exists(`artist/42/${file}`)).toBe(false)
    }
    expect(await exists('artist')).toBe(true)
  })
  it('cleans registered metadata and validated chapter variants without double counting', async () => {
    artwork.metaSource = `${directory}/42-meta.json`
    media = [{ path: `${directory}/video.mp4`, chaptersPath: `${directory}/video.chapters.json` }]
    await write(media[0]!.path)
    await write(artwork.metaSource, metadata)
    for (const file of ['video.chapters.json', 'video.mp4.chapters.json', 'video..chapters.json']) {
      await write(`${directory}/${file}`, chapter)
    }
    const report = await run()
    expect(report.counts).toMatchObject({ media: 1, sidecars: 4, directories: 1 })
    expect(new Set(report.entries.map((entry) => entry.path)).size).toBe(report.entries.length)
  })
  it('retains invalid registered chapter paths but allows selected ordinary chapter files', async () => {
    media = [{ path: `${directory}/video.mp4`, chaptersPath: `${directory}/cover.jpg` }]
    await write(media[0]!.path)
    await write(`${directory}/cover.jpg`)
    await write(`${directory}/video.chapters.json`, '{}')
    const report = await run()
    expect(report.counts.sidecars).toBe(1)
    expect(await exists(`${directory}/cover.jpg`)).toBe(true)
    expect(await exists(`${directory}/video.chapters.json`)).toBe(false)
  })
  it('counts already-absent files and directory separately', async () => {
    const report = await run()
    expect(report.counts.media).toBe(0)
    expect(report.counts.missing).toBe(2)
    expect(report.database.artwork).toBe('DELETED')
  })
  it('retains database records after an unlink failure and sanitizes errors', async () => {
    await write(media[0]!.path)
    artwork.metaSource = `${directory}/42-meta.json`
    await write(artwork.metaSource, metadata)
    const unlink = fs.unlink.bind(fs)
    vi.spyOn(fs, 'unlink').mockImplementation(async (file) => {
      if (String(file).endsWith('1.jpg')) throw Object.assign(new Error(`secret ${root}`), { code: 'EACCES' })
      return unlink(file)
    })
    const report = await run()
    expect(report.outcome).toBe('PARTIAL')
    expect(report.database.artwork).toBe('RETAINED')
    expect(mocks.deleteImages).not.toHaveBeenCalled()
    expect(report.entries).toContainEqual(expect.objectContaining({ path: artwork.metaSource, status: 'DELETED' }))
    expect(JSON.stringify(report)).not.toContain(root)
    expect(await exists(artwork.metaSource)).toBe(false)
  })
  it.each(['media', 'artwork'] as const)(
    'reports already-deleted files when the %s database step fails',
    async (stage) => {
      await write(media[0]!.path)
      artwork.metaSource = `${directory}/42-meta.json`
      await write(artwork.metaSource, metadata)
      ;(stage === 'media' ? mocks.deleteImages : mocks.deleteArtwork).mockRejectedValue(
        new Error('credentials should not be shown')
      )
      const report = await run()
      expect(report.outcome).toBe('PARTIAL')
      expect(report.counts.media).toBe(1)
      expect(report.database[stage]).toBe('FAILED')
      expect(await exists(artwork.metaSource)).toBe(false)
      expect(JSON.stringify(report)).not.toContain('credentials')
      if (stage === 'media') expect(mocks.deleteArtwork).not.toHaveBeenCalled()
    }
  )
  it('never forces directory removal when a new file appears', async () => {
    await write(media[0]!.path)
    const rmdir = fs.rmdir.bind(fs)
    vi.spyOn(fs, 'rmdir').mockImplementation(async (value) => {
      await fs.writeFile(path.join(String(value), 'new.txt'), 'new content')
      return rmdir(value)
    })
    const report = await run()
    expect(report.counts.directories).toBe(0)
    expect(report.entries).toContainEqual(
      expect.objectContaining({ path: directory, status: 'RETAINED', code: 'ENOTEMPTY' })
    )
    expect(await exists(`${directory}/new.txt`)).toBe(true)
  })
  it('preserves shared directories and shared registered media', async () => {
    await write(media[0]!.path)
    await write(`${directory}/42-meta.json`, '{}')
    mocks.findImages.mockImplementation(async (args) => (args.where.artworkId === 1 ? media : media))
    const report = await run()
    expect(report.outcome).toBe('COMPLETED')
    expect(report.database.artwork).toBe('DELETED')
    expect(report.inspectionComplete).toBe(true)
    expect(report.counts.media).toBe(0)
    expect(report.entries).toContainEqual(
      expect.objectContaining({ path: media[0]!.path, status: 'RETAINED', code: 'SHARED_FILE' })
    )
    expect(await exists(media[0]!.path)).toBe(true)
  })
  it('does no mutation when reference lookup fails', async () => {
    await write(media[0]!.path)
    mocks.otherArtworks.mockRejectedValue(new Error('unavailable'))
    await expect(previewDeleteArtwork(1)).rejects.toThrow('unavailable')
    const report = await deleteArtwork(
      { artworkId: 1, selectedPaths: [media[0]!.path] },
      { requestedByUserId: 'admin-1' }
    )
    expect(report.outcome).toBe('FAILED')
    expect(report.counts.media).toBe(0)
    expect(mocks.deleteImages).not.toHaveBeenCalled()
    expect(await exists(media[0]!.path)).toBe(true)
  })
  it('reports missing scan configuration without guessing a filesystem location', async () => {
    mocks.scanPath.mockResolvedValue(null)
    const report = await run()
    expect(report.counts.retained).toBe(1)
    expect(report.outcome).toBe('FAILED')
    expect(report.database.deletedMediaCount).toBe(0)
  })
  it('cleans an explicitly identified empty work without media', async () => {
    media = []
    await fs.mkdir(path.join(root, directory), { recursive: true })
    expect((await run()).counts.directories).toBe(1)
  })
  it('rejects traversal and never follows a junction, even inside the root', async () => {
    await write('outside/sentinel.txt', 'keep')
    await fs.mkdir(path.join(root, 'local-imports', 'artist'), { recursive: true })
    await fs.symlink(
      path.join(root, 'outside'),
      path.join(root, directory),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    media = [
      { path: `${directory}/sentinel.txt`, chaptersPath: null },
      { path: '../outside.txt', chaptersPath: null }
    ]
    const report = await run()
    expect(report.counts.media).toBe(0)
    expect(report.entries.filter((entry) => entry.code === 'UNSAFE_PATH')).toHaveLength(2)
    expect(await fs.readFile(path.join(root, 'outside/sentinel.txt'), 'utf8')).toBe('keep')
  })
  it('reports URL archive submission without physical deletion', async () => {
    artwork.createdVia = 'URL_ARCHIVE'
    const report = await run()
    expect(report).toMatchObject({
      mode: 'ARCHIVE_TRASH',
      outcome: 'QUEUED',
      archive: { jobId: 'job-1', lifecycleState: 'TRASHING' }
    })
    expect(report.database).toMatchObject({ artwork: 'RETAINED', media: 'RETAINED' })
    expect(report.entries).toEqual([])
    expect(mocks.findImages).not.toHaveBeenCalled()
    expect(mocks.deleteArtwork).not.toHaveBeenCalled()
    expect(mocks.maintenance).toHaveBeenCalledWith({
      artworkId: 1,
      action: 'TRASH_ARCHIVE',
      requestedByUserId: 'admin-1'
    })
  })
  it('reports rejected archive maintenance without claiming success', async () => {
    artwork.createdVia = 'URL_ARCHIVE'
    mocks.maintenance.mockRejectedValue(new Error('State conflict'))
    const report = await run()
    expect(report.outcome).toBe('FAILED')
    expect(report.archive).toBeNull()
  })
})

describe('directory and report boundaries', () => {
  it.each([
    '/',
    'artist',
    'local-imports',
    'local-imports/artist',
    'sources/provider/work',
    '.trash/work',
    '../outside'
  ])('protects %s', (storagePath) => {
    expect(determineDeleteDirectory({ ...artwork, storagePath, images: [] })).toBeNull()
  })
  it('normalizes separators without guessing a common ancestor', () => {
    expect(normalizeDeletePath('\\local-imports\\artist\\work')).toBe(directory)
    expect(
      determineDeleteDirectory({ ...artwork, images: [{ path: 'other/work/file.jpg', chaptersPath: null }] })
    ).toBeNull()
    expect(() => normalizeDeletePath('C:\\outside')).toThrow()
  })
  it('exports all actual results, safely quoting filename newlines', async () => {
    await write(media[0]!.path)
    const report = await run()
    report.entries.push({ path: 'manual\n[DELETED] forged.txt', kind: 'OTHER', status: 'RETAINED', reason: 'unknown' })
    report.counts = countArtworkDeleteEntries(report.entries)
    const text = formatArtworkDeleteReport(report)
    expect(text).toContain('manual\\n[DELETED] forged.txt')
    expect(text).toContain('已删除媒体 1')
    expect(text).toContain('数据库结果')
  })
  it('does not delete a sidecar changed after inspection', async () => {
    artwork.metaSource = `${directory}/42-meta.json`
    await write(artwork.metaSource, metadata)
    const report: ArtworkDeleteReport = {
      reportId: 'test',
      artwork: { id: 1, title: 'work', createdVia: 'LOCAL_DIRECTORY', directory },
      startedAt: '',
      finishedAt: '',
      mode: 'DIRECT_DELETE',
      outcome: 'COMPLETED',
      entries: [],
      database: { artwork: 'DELETED', media: 'DELETED', deletedMediaCount: 0, relatedRecords: [] },
      counts: countArtworkDeleteEntries([]),
      inspectionComplete: false,
      warnings: [],
      archive: null
    }
    const files = new ArtworkFileDeletion(report, {
      scanRoot: root,
      directory,
      media: [],
      metaSource: artwork.metaSource
    })
    await files.prepare([])
    await write(artwork.metaSource, '{"modified":true}')
    await files.deleteSelected([artwork.metaSource])
    expect(report.entries).toContainEqual(
      expect.objectContaining({ path: artwork.metaSource, status: 'FAILED', code: 'FILE_CHANGED' })
    )
    expect(await exists(artwork.metaSource)).toBe(true)
  })
})

describe('explicit deletion selection', () => {
  it('previews and deletes links.txt, nested and hidden files without matching filenames', async () => {
    await write(media[0]!.path)
    for (const file of ['133479323-简介-links.txt', 'nested/notes.txt', '.hidden']) await write(`${directory}/${file}`)
    const preview = await previewDeleteArtwork(1)
    expect(preview.canDelete).toBe(true)
    expect(await exists(media[0]!.path)).toBe(true)
    expect(mocks.deleteImages).not.toHaveBeenCalled()
    expect(preview.entries).toContainEqual(
      expect.objectContaining({ path: `${directory}/133479323-简介-links.txt`, selection: 'OPTIONAL' })
    )
    expect(preview.entries).toContainEqual(expect.objectContaining({ path: media[0]!.path, selection: 'REQUIRED' }))
    const report = await run()
    expect(report.counts).toMatchObject({ media: 1, sidecars: 3, directories: 2 })
    expect(await exists(directory)).toBe(false)
    expect(mocks.lockCatalog.mock.invocationCallOrder[0]).toBeLessThan(mocks.lockArtwork.mock.invocationCallOrder[0]!)
  })

  it.each(['../outside.txt', '/absolute/file', 'other/work/file.txt', directory])(
    'rejects selection %s before deleting any file',
    async (extra) => {
      await write(media[0]!.path)
      const result = await run([media[0]!.path, extra])
      expect(result.outcome).toBe('FAILED')
      expect(await exists(media[0]!.path)).toBe(true)
      expect(mocks.deleteImages).not.toHaveBeenCalled()
    }
  )

  it('requires a selection and all safe registered media', async () => {
    await write(media[0]!.path)
    expect((await deleteArtwork({ artworkId: 1 }, { requestedByUserId: 'admin-1' })).outcome).toBe('FAILED')
    expect((await run([])).outcome).toBe('FAILED')
    expect(await exists(media[0]!.path)).toBe(true)
    expect(mocks.deleteArtwork).not.toHaveBeenCalled()
  })

  it('does not add a newly discovered optional file to the submitted selection', async () => {
    await write(media[0]!.path)
    const preview = await previewDeleteArtwork(1)
    await write(`${directory}/new.txt`)
    const result = await run(
      preview.entries.filter((entry) => entry.selection === 'REQUIRED').map((entry) => entry.path)
    )
    expect(result.outcome).toBe('COMPLETED')
    expect(await exists(`${directory}/new.txt`)).toBe(true)
    expect(result.entries).toContainEqual(
      expect.objectContaining({ path: `${directory}/new.txt`, reason: '用户选择保留' })
    )
  })

  it('preserves system markers and symlinks even when extra files are selected', async () => {
    await write(media[0]!.path)
    await write(`${directory}/.pixishelf-root`)
    await write('other/work/sentinel.txt')
    await fs.symlink(path.join(root, 'other/work/sentinel.txt'), path.join(root, directory, 'link.txt'))
    const preview = await previewDeleteArtwork(1)
    for (const name of ['.pixishelf-root', 'link.txt']) {
      expect(preview.entries).toContainEqual(
        expect.objectContaining({ path: `${directory}/${name}`, selection: 'BLOCKED' })
      )
    }
    expect((await run([media[0]!.path, `${directory}/link.txt`])).outcome).toBe('FAILED')
    expect(await exists(media[0]!.path)).toBe(true)
    await run()
    expect(await exists(`${directory}/.pixishelf-root`)).toBe(true)
    expect(await exists('other/work/sentinel.txt')).toBe(true)
  })

  it('lists shared directories but rejects selecting their extra files', async () => {
    await write(media[0]!.path)
    await write(`${directory}/notes.txt`)
    mocks.otherArtworks.mockResolvedValue([{ storagePath: directory, metaSource: null }])
    const preview = await previewDeleteArtwork(1)
    expect(preview).toMatchObject({ directoryMode: 'SHARED_DIRECTORY', inspectionComplete: true, canDelete: true })
    expect(preview.entries).toContainEqual(
      expect.objectContaining({ path: `${directory}/notes.txt`, selection: 'BLOCKED' })
    )
    expect((await run([`${directory}/notes.txt`])).outcome).toBe('FAILED')
    expect(mocks.deleteArtwork).not.toHaveBeenCalled()
  })

  it('limits artist directories to registered media', async () => {
    artwork.storagePath = 'artist'
    media = [{ path: 'artist/1.jpg', chaptersPath: null }]
    await write(media[0]!.path)
    await write('artist/other.txt')
    const preview = await previewDeleteArtwork(1)
    expect(preview.directoryMode).toBe('REGISTERED_ONLY')
    expect(preview.entries.map((entry) => entry.path)).toEqual([media[0]!.path])
    expect((await run()).database.artwork).toBe('DELETED')
    expect(await exists('artist/other.txt')).toBe(true)
  })

  it.each(['permission', 'depth'])(
    'blocks incomplete %s inspection without touching files or records',
    async (failure) => {
      await write(media[0]!.path)
      if (failure === 'depth') await write(`${directory}/${Array(14).fill('nested').join('/')}/notes.txt`)
      else vi.spyOn(fs, 'opendir').mockRejectedValue(Object.assign(new Error('Denied'), { code: 'EACCES' }))
      const preview = await previewDeleteArtwork(1)
      expect(preview).toMatchObject({ canDelete: false, inspectionComplete: false })
      const result = await run([media[0]!.path])
      expect(result.outcome).toBe('FAILED')
      expect(await exists(media[0]!.path)).toBe(true)
      expect(mocks.deleteArtwork).not.toHaveBeenCalled()
    }
  )

  it('blocks deletion when directory enumeration exceeds the entry limit', async () => {
    await write(media[0]!.path)
    vi.spyOn(fs, 'opendir').mockImplementation(
      async () =>
        ({
          async *[Symbol.asyncIterator]() {
            for (let index = 0; index <= 100_000; index++) yield { name: '1.jpg' }
          }
        }) as unknown as Awaited<ReturnType<typeof fs.opendir>>
    )
    const preview = await previewDeleteArtwork(1)
    expect(preview).toMatchObject({ canDelete: false, inspectionComplete: false })
    expect(preview.entries).toContainEqual(expect.objectContaining({ path: directory, code: 'INSPECTION_LIMIT' }))
    expect(mocks.deleteArtwork).not.toHaveBeenCalled()
    expect(await exists(media[0]!.path)).toBe(true)
  })

  it('retains records on an optional file failure and supports missing-media retries', async () => {
    await write(media[0]!.path)
    const sidecar = `${directory}/133479323-简介-links.txt`
    await write(sidecar)
    const originalUnlink = fs.unlink.bind(fs)
    const spy = vi.spyOn(fs, 'unlink').mockImplementation(async (file) => {
      if (String(file).endsWith('links.txt')) throw Object.assign(new Error('Denied'), { code: 'EACCES' })
      return originalUnlink(file)
    })
    const result = await run()
    expect(result).toMatchObject({ outcome: 'PARTIAL', database: { artwork: 'RETAINED', media: 'RETAINED' } })
    expect(mocks.deleteImages).not.toHaveBeenCalled()
    expect(await exists(media[0]!.path)).toBe(false)
    spy.mockRestore()
    const retry = await run()
    expect(retry).toMatchObject({
      outcome: 'COMPLETED',
      counts: { missing: 1, media: 0, sidecars: 1 },
      database: { artwork: 'DELETED' }
    })
    expect(await exists(directory)).toBe(false)
  })
})
