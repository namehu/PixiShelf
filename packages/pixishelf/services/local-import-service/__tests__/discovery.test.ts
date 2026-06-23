import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { canonicalizeLocalImportStoragePath } from '@/schemas/local-import.dto'

const { artworkFindManyMock, mappingFindManyMock } = vi.hoisted(() => ({
  artworkFindManyMock: vi.fn(),
  mappingFindManyMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    artwork: { findMany: artworkFindManyMock },
    localImportArtistMapping: { findMany: mappingFindManyMock }
  }
}))

import { discoverLocalImports } from '../discovery'

describe('local import discovery', () => {
  let scanPath: string

  beforeEach(async () => {
    scanPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-local-import-'))
    artworkFindManyMock.mockReset().mockResolvedValue([])
    mappingFindManyMock.mockReset().mockResolvedValue([])
  })

  afterEach(async () => {
    await fs.rm(scanPath, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('canonicalizes storage paths without changing case and rejects escapes', () => {
    expect(canonicalizeLocalImportStoragePath('local-imports\\Artist\\.\\Work')).toBe(
      'local-imports/Artist/Work'
    )
    expect(() => canonicalizeLocalImportStoragePath('../outside')).toThrow()
    expect(() => canonicalizeLocalImportStoragePath('/absolute/path')).toThrow()
  })

  it('discovers only shallow direct media and skips existing work before reading it', async () => {
    const root = path.join(scanPath, 'local-imports')
    const newWork = path.join(root, 'ArtistCase', 'NewWork')
    const existingWork = path.join(root, 'ArtistCase', 'ExistingWork')
    await fs.mkdir(path.join(newWork, 'nested'), { recursive: true })
    await fs.mkdir(existingWork, { recursive: true })
    await fs.mkdir(path.join(root, '.hidden', 'ignored'), { recursive: true })
    await fs.writeFile(path.join(newWork, 'Cover.JPG'), 'image')
    await fs.writeFile(path.join(newWork, '10.jpg'), 'image')
    await fs.writeFile(path.join(newWork, '2.jpg'), 'image')
    await fs.writeFile(path.join(newWork, '00261-2153324271.jpg'), 'image')
    await fs.writeFile(path.join(newWork, 'notes.txt'), 'text')
    await fs.writeFile(path.join(existingWork, 'existing.png'), 'image')
    await fs.symlink(newWork, path.join(root, 'linked-artist'), 'junction')

    artworkFindManyMock.mockResolvedValue([{ storagePath: 'local-imports/ArtistCase/ExistingWork' }])
    mappingFindManyMock.mockResolvedValue([
      { artistDirectory: 'ArtistCase', artistId: 7, artist: { id: 7, name: 'Mapped Artist' } }
    ])
    const readdirSpy = vi.spyOn(fs, 'readdir')

    const result = await discoverLocalImports({ scanPath })

    expect(readdirSpy.mock.calls.some(([target]) => path.resolve(String(target)) === path.resolve(existingWork))).toBe(
      false
    )
    expect(result.importRootDisplay).toBe('scanPath/local-imports')
    expect(result.counts).toEqual({
      artists: 1,
      works: 2,
      new: 1,
      existing: 1,
      invalid: 0,
      media: 4
    })
    expect(result.artists[0]).toMatchObject({
      artistDirectory: 'ArtistCase',
      mapping: { artistId: 7, artistName: 'Mapped Artist' },
      works: [
        {
          workDirectory: 'ExistingWork',
          relativeDirectory: 'ExistingWork',
          storagePath: 'local-imports/ArtistCase/ExistingWork',
          status: 'existing',
          mediaCount: 0
        },
        {
          workDirectory: 'NewWork',
          relativeDirectory: 'NewWork',
          storagePath: 'local-imports/ArtistCase/NewWork',
          status: 'new',
          mediaFiles: ['2.jpg', '10.jpg', '00261-2153324271.jpg', 'Cover.JPG'],
          mediaCount: 4
        }
      ]
    })
  })

  it('discovers multi-level artwork directories and keeps duplicate leaf names distinct', async () => {
    const root = path.join(scanPath, 'local-imports')
    await fs.mkdir(path.join(root, 'Artist', '2024', 'Manga', 'Work'), { recursive: true })
    await fs.mkdir(path.join(root, 'Artist', '2025', 'Novel', 'Work'), { recursive: true })
    await fs.mkdir(path.join(root, 'Artist', 'EmptyCategory', 'LeafWithoutMedia'), { recursive: true })
    await fs.writeFile(path.join(root, 'Artist', '2024', 'Manga', 'Work', '1.jpg'), 'image')
    await fs.writeFile(path.join(root, 'Artist', '2025', 'Novel', 'Work', '2.jpg'), 'image')
    await fs.writeFile(path.join(root, 'Artist', '2025', 'Novel', 'Work', 'notes.txt'), 'text')

    const result = await discoverLocalImports({ scanPath })

    expect(result.counts).toEqual({
      artists: 1,
      works: 2,
      new: 2,
      existing: 0,
      invalid: 0,
      media: 2
    })
    expect(result.artists[0]?.works).toEqual([
      expect.objectContaining({
        workDirectory: 'Work',
        relativeDirectory: '2024/Manga/Work',
        title: 'Work',
        storagePath: 'local-imports/Artist/2024/Manga/Work',
        status: 'new',
        mediaFiles: ['1.jpg'],
        mediaCount: 1
      }),
      expect.objectContaining({
        workDirectory: 'Work',
        relativeDirectory: '2025/Novel/Work',
        title: 'Work',
        storagePath: 'local-imports/Artist/2025/Novel/Work',
        status: 'new',
        mediaFiles: ['2.jpg'],
        mediaCount: 1
      })
    ])
  })

  it('marks an existing multi-level storage path without reading that artwork directory', async () => {
    const root = path.join(scanPath, 'local-imports')
    const existingWork = path.join(root, 'Artist', '2024', 'Manga', 'ExistingWork')
    const newWork = path.join(root, 'Artist', '2024', 'Manga', 'NewWork')
    await fs.mkdir(existingWork, { recursive: true })
    await fs.mkdir(newWork, { recursive: true })
    await fs.writeFile(path.join(existingWork, 'existing.jpg'), 'image')
    await fs.writeFile(path.join(newWork, 'new.jpg'), 'image')
    artworkFindManyMock.mockResolvedValue([{ storagePath: 'local-imports/Artist/2024/Manga/ExistingWork' }])
    const readdirSpy = vi.spyOn(fs, 'readdir')

    const result = await discoverLocalImports({ scanPath })

    expect(readdirSpy.mock.calls.some(([target]) => path.resolve(String(target)) === path.resolve(existingWork))).toBe(
      false
    )
    expect(result.counts).toEqual({
      artists: 1,
      works: 2,
      new: 1,
      existing: 1,
      invalid: 0,
      media: 1
    })
    expect(result.artists[0]?.works).toEqual([
      expect.objectContaining({
        workDirectory: 'ExistingWork',
        relativeDirectory: '2024/Manga/ExistingWork',
        storagePath: 'local-imports/Artist/2024/Manga/ExistingWork',
        status: 'existing',
        mediaCount: 0
      }),
      expect.objectContaining({
        workDirectory: 'NewWork',
        relativeDirectory: '2024/Manga/NewWork',
        storagePath: 'local-imports/Artist/2024/Manga/NewWork',
        status: 'new',
        mediaCount: 1
      })
    ])
  })
})
