import { createHash } from 'node:crypto'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cleanupPublishedSource,
  publishMigrationFile,
  stageMigrationFile,
  verifyPreparedMigrationFile
} from '../transfer.js'
import type { MigrationFilePlan } from '../types.js'
import { MemoryMigrationFileSystem } from './memory-file-system.js'

const HASH = createHash('sha256').update('source-content').digest('hex')

describe('migration file transfer recovery', () => {
  it('reuses content-matching attempt staging after a crash without overwriting it', async () => {
    const { fileSystem, file, config } = fixture()

    await expect(stageMigrationFile({ fileSystem, file, config })).resolves.toMatchObject({ sha256: HASH })
    await expect(stageMigrationFile({ fileSystem, file, config })).resolves.toMatchObject({ sha256: HASH })

    expect(fileSystem.copyCount).toBe(1)
    expect(fileSystem.operations.some((operation) => operation.startsWith('fsync-file:'))).toBe(true)
  })

  it('reuses matching canonical content but never overwrites a conflict', async () => {
    const matching = fixture()
    await stageMigrationFile(matching)
    matching.fileSystem.addDirectory(path.resolve('/scan/artist'))
    matching.fileSystem.addDirectory(path.resolve('/scan/artist/123'))
    matching.fileSystem.addFile(path.resolve('/scan/artist/123/123_p0.jpg'), 'source-content')
    const copiesBeforePublish = matching.fileSystem.copyCount
    await expect(publishMigrationFile({ ...matching, expectedSha256: HASH })).resolves.toBeUndefined()
    expect(matching.fileSystem.copyCount).toBe(copiesBeforePublish)

    const conflict = fixture()
    await stageMigrationFile(conflict)
    conflict.fileSystem.addDirectory(path.resolve('/scan/artist'))
    conflict.fileSystem.addDirectory(path.resolve('/scan/artist/123'))
    conflict.fileSystem.addFile(path.resolve('/scan/artist/123/123_p0.jpg'), 'different')
    await expect(publishMigrationFile({ ...conflict, expectedSha256: HASH })).rejects.toMatchObject({
      code: 'TARGET_CONFLICT'
    })
  })

  it('removes a source only when its exact persisted fingerprint still matches', async () => {
    const matching = fixture()
    addPublishedTarget(matching.fileSystem)
    await expect(
      cleanupPublishedSource({
        ...matching,
        expected: { size: 'source-content'.length, mtimeMs: 7, sha256: HASH }
      })
    ).resolves.toBe('REMOVED')
    expect(matching.fileSystem.has(path.resolve('/scan/source/123_p0.jpg'))).toBe(false)

    const changed = fixture()
    addPublishedTarget(changed.fileSystem)
    changed.fileSystem.addFile(path.resolve('/scan/source/123_p0.jpg'), 'changed', 8)
    await expect(
      cleanupPublishedSource({
        ...changed,
        expected: { size: 'source-content'.length, mtimeMs: 7, sha256: HASH }
      })
    ).rejects.toMatchObject({ code: 'SOURCE_CHANGED_AFTER_PUBLISH' })
    expect(changed.fileSystem.has(path.resolve('/scan/source/123_p0.jpg'))).toBe(true)
  })

  it('normalizes fractional Node mtime values to the persisted integer representation', async () => {
    const state = fixture()
    state.fileSystem.addFile(path.resolve('/scan/source/123_p0.jpg'), 'source-content', 7.875)
    addPublishedTarget(state.fileSystem)

    await expect(stageMigrationFile(state)).resolves.toMatchObject({ mtimeMs: 7, sha256: HASH })
    await expect(
      cleanupPublishedSource({ ...state, expected: { size: 'source-content'.length, mtimeMs: 7, sha256: HASH } })
    ).resolves.toBe('REMOVED')
  })

  it('classifies an initially missing source as failed but a post-staging disappearance as action required', async () => {
    const initial = fixture()
    await initial.fileSystem.unlink(path.resolve('/scan/source/123_p0.jpg'))
    await expect(stageMigrationFile(initial)).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' })

    const recovery = fixture()
    recovery.file.sourceSha256 = HASH
    await recovery.fileSystem.unlink(path.resolve('/scan/source/123_p0.jpg'))
    await expect(stageMigrationFile(recovery)).rejects.toMatchObject({ code: 'FILESYSTEM_RECOVERY_FAILED' })
  })

  it('refuses cleanup when target is missing, changed, or the same physical file', async () => {
    const missing = fixture()
    await expect(
      cleanupPublishedSource({ ...missing, expected: { size: 14, mtimeMs: 7, sha256: HASH } })
    ).rejects.toMatchObject({ code: 'FILESYSTEM_RECOVERY_FAILED' })
    expect(missing.fileSystem.has(path.resolve('/scan/source/123_p0.jpg'))).toBe(true)

    const changed = fixture()
    addPublishedTarget(changed.fileSystem)
    changed.fileSystem.addFile(path.resolve('/scan/artist/123/123_p0.jpg'), 'changed-target')
    await expect(
      cleanupPublishedSource({ ...changed, expected: { size: 14, mtimeMs: 7, sha256: HASH } })
    ).rejects.toMatchObject({ code: 'TARGET_CONFLICT' })

    const same = fixture()
    same.fileSystem.addDirectory(path.resolve('/scan/artist'))
    same.fileSystem.addDirectory(path.resolve('/scan/artist/123'))
    same.fileSystem.addHardlink(path.resolve('/scan/artist/123/123_p0.jpg'), path.resolve('/scan/source/123_p0.jpg'))
    await expect(
      cleanupPublishedSource({ ...same, expected: { size: 14, mtimeMs: 7, sha256: HASH } })
    ).rejects.toMatchObject({ code: 'TARGET_CONFLICT' })
    expect(same.fileSystem.has(path.resolve('/scan/source/123_p0.jpg'))).toBe(true)
  })

  it.each(['source', 'staging', 'target'] as const)(
    'revalidates %s immediately before the database publication fence',
    async (changedPart) => {
      const state = fixture()
      const expected = await stageMigrationFile(state)
      await publishMigrationFile({ ...state, expectedSha256: expected.sha256 })
      const changedPath =
        changedPart === 'source'
          ? '/scan/source/123_p0.jpg'
          : changedPart === 'staging'
            ? `/scan/${state.file.stagedRelativePath}`
            : '/scan/artist/123/123_p0.jpg'
      state.fileSystem.addFile(path.resolve(changedPath), 'tampered', 9)

      await expect(verifyPreparedMigrationFile({ ...state, expected })).rejects.toMatchObject({
        code:
          changedPart === 'staging'
            ? 'STAGING_CONFLICT'
            : changedPart === 'target'
              ? 'TARGET_CONFLICT'
              : 'FILESYSTEM_RECOVERY_FAILED'
      })
    }
  )
})

function fixture() {
  const fileSystem = new MemoryMigrationFileSystem()
  const root = path.resolve('/scan')
  fileSystem.addDirectory(root)
  fileSystem.addDirectory(path.resolve('/scan/source'))
  fileSystem.addFile(path.resolve('/scan/source/123_p0.jpg'), 'source-content', 7)
  const file: MigrationFilePlan = {
    id: 'file-1',
    ordinal: 0,
    imageId: 11,
    sourceStoredPath: '/source/123_p0.jpg',
    sourceRelativePath: 'source/123_p0.jpg',
    targetStoredPath: '/artist/123/123_p0.jpg',
    targetRelativePath: 'artist/123/123_p0.jpg',
    stagedRelativePath: '.pixishelf-migration-staging/job/attempt-1/artwork-1/0-123_p0.jpg',
    status: 'PENDING',
    attempt: 1,
    sourceSize: null,
    sourceMtimeMs: null,
    sourceSha256: null,
    stagedSha256: null
  }
  return {
    fileSystem,
    config: { scanRoot: root },
    file
  }
}

function addPublishedTarget(fileSystem: MemoryMigrationFileSystem) {
  fileSystem.addDirectory(path.resolve('/scan/artist'))
  fileSystem.addDirectory(path.resolve('/scan/artist/123'))
  fileSystem.addFile(path.resolve('/scan/artist/123/123_p0.jpg'), 'source-content')
}
