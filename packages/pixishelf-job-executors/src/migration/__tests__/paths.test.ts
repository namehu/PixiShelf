import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertSafePathSegment,
  buildCanonicalTargetDirectory,
  isExternalIdOwnedFilename,
  isPathInExactDirectory,
  normalizeStoredRelativePath,
  resolveSafeExistingDirectory,
  resolveSafeExistingFile
} from '../paths.js'
import { MemoryMigrationFileSystem } from './memory-file-system.js'

describe('migration path policy', () => {
  it('requires artist and external ids to be one strict safe segment', () => {
    expect(buildCanonicalTargetDirectory('artist-1', '123')).toBe('artist-1/123')
    for (const value of ['../artist', 'artist/name', 'artist\\name', 'CON', 'name.', 'C:']) {
      expect(() => assertSafePathSegment(value, 'segment')).toThrow('safe path segment')
    }
    expect(() => normalizeStoredRelativePath('../outside.jpg')).toThrow('unsafe segment')
    expect(() => normalizeStoredRelativePath('C:\\outside.jpg')).toThrow('Absolute')
  })

  it('does not confuse artwork 123 with canonical directory or filenames for 1234', () => {
    expect(isPathInExactDirectory('/artist/123/page.jpg', 'artist/123')).toBe(true)
    expect(isPathInExactDirectory('/artist/1234/page.jpg', 'artist/123')).toBe(false)
    expect(isExternalIdOwnedFilename('123_p0.jpg', '123')).toBe(true)
    expect(isExternalIdOwnedFilename('1234_p0.jpg', '123')).toBe(false)
  })

  it('rejects a symlink source even when its real target exists', async () => {
    const fileSystem = new MemoryMigrationFileSystem()
    const root = path.resolve('/scan')
    fileSystem.addDirectory(root)
    fileSystem.addDirectory(path.join(root, 'source'))
    fileSystem.addDirectory(path.resolve('/outside'))
    fileSystem.addFile(path.resolve('/outside/secret.jpg'), 'secret')
    fileSystem.addSymlink(path.join(root, 'source', 'secret.jpg'), path.resolve('/outside/secret.jpg'))

    await expect(resolveSafeExistingFile(fileSystem, root, 'source/secret.jpg')).rejects.toThrow('non-symlink')
  })

  it('rejects a symlink or junction-like parent before bounded sidecar enumeration', async () => {
    const fileSystem = new MemoryMigrationFileSystem()
    const root = path.resolve('/scan')
    fileSystem.addDirectory(root)
    fileSystem.addDirectory(path.resolve('/outside'))
    fileSystem.addSymlink(path.join(root, 'source'), path.resolve('/outside'))

    await expect(resolveSafeExistingDirectory(fileSystem, root, 'source')).rejects.toThrow('non-symlink')
  })
})
