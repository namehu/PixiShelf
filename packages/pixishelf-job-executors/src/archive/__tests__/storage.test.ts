import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildArchiveStoragePaths, prepareArchiveStagingDirectory } from '../storage.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('archive executor storage safety', () => {
  it('normalizes untrusted identity segments into deterministic paths below the scan root', () => {
    const paths = buildArchiveStoragePaths({
      scanRoot: 'D:/archive',
      archiveImportId: '../import:1',
      providerKey: 'e-hentai',
      creatorBucket: '../../creator',
      externalId: '42/../../escape'
    })

    expect(paths.stagingRelativePath).toBe('.archive-staging/import-1')
    expect(paths.finalRelativePath).toBe('sources/e-hentai/creator/42-..-..-escape/revisions/import-1')
    expect(path.relative(path.resolve('D:/archive'), paths.finalAbsolutePath)).not.toMatch(/^\.\./)
  })

  it('rejects a stored staging path that escapes the configured root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-archive-storage-'))
    temporaryDirectories.push(root)
    await mkdir(path.join(root, '.archive-staging'), { recursive: true })

    await expect(prepareArchiveStagingDirectory(root, '../outside')).rejects.toThrow('escapes')
  })
})
