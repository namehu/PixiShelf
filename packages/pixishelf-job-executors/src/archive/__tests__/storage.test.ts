import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildArchiveStoragePaths,
  pathExists,
  prepareArchiveRevisionDirectory,
  prepareArchiveStagingDirectory
} from '../storage.js'

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
    expect(paths.scanRootAbsolutePath).toBe(path.resolve('D:/archive'))
    expect(path.relative(path.resolve('D:/archive'), paths.finalAbsolutePath)).not.toMatch(/^\.\./)
  })

  it('rejects a stored staging path that escapes the configured root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-archive-storage-'))
    temporaryDirectories.push(root)
    await mkdir(path.join(root, '.archive-staging'), { recursive: true })

    await expect(prepareArchiveStagingDirectory(root, '../outside')).rejects.toThrow('escapes')
  })

  it('publishes a new revision when its source hierarchy does not exist yet', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-archive-storage-'))
    temporaryDirectories.push(root)
    const paths = buildArchiveStoragePaths({
      scanRoot: root,
      archiveImportId: 'import-1',
      providerKey: 'e-hentai',
      creatorBucket: '_unknown',
      externalId: '2917276'
    })
    const stagingDirectory = await prepareArchiveStagingDirectory(root, paths.stagingRelativePath)
    await writeFile(path.join(stagingDirectory, 'media', '0001.jpg'), 'image')
    await writeFile(path.join(stagingDirectory, 'manifest.json'), '{}')

    expect(await pathExists(path.dirname(paths.finalAbsolutePath))).toBe(false)

    await prepareArchiveRevisionDirectory(paths)

    expect(await readFile(path.join(paths.finalAbsolutePath, 'media', '0001.jpg'), 'utf8')).toBe('image')
    expect(await readFile(path.join(paths.finalAbsolutePath, 'manifest.json'), 'utf8')).toBe('{}')
    expect(await pathExists(paths.stagingAbsolutePath)).toBe(false)
  })

  it('rejects a tampered final revision path that escapes the scan root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-archive-storage-'))
    temporaryDirectories.push(root)
    const paths = buildArchiveStoragePaths({
      scanRoot: root,
      archiveImportId: 'import-1',
      providerKey: 'e-hentai',
      creatorBucket: '_unknown',
      externalId: '2917276'
    })

    await expect(
      prepareArchiveRevisionDirectory({
        ...paths,
        finalRelativePath: '../outside/import-1',
        finalAbsolutePath: path.resolve(root, '../outside/import-1')
      })
    ).rejects.toThrow('escapes')
  })
})
