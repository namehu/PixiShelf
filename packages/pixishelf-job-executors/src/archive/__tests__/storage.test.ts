import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildArchiveStoragePaths,
  pathExists,
  prepareArchiveRevisionDirectory,
  prepareArchiveStagingDirectory,
  storeArchiveRemoteMedia
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

  it('reports streamed byte counts without retaining or rereading media chunks', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-archive-storage-'))
    temporaryDirectories.push(root)
    await mkdir(path.join(root, 'media'))
    const image = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
    const onChunk = vi.fn()
    const onStreamComplete = vi.fn()

    const stored = await storeArchiveRemoteMedia({
      remote: {
        stream: Readable.from([image.subarray(0, 20), image.subarray(20)]),
        contentLength: image.length,
        mimeType: 'image/png',
        originalFilename: 'one.png',
        quality: 'ORIGINAL',
        remoteHost: 'example.test'
      },
      stagingDirectory: root,
      index: 0,
      expectedFilename: 'one.png',
      signal: new AbortController().signal,
      partialKey: 'attempt-1',
      onChunk,
      onStreamComplete
    })

    expect(onChunk.mock.calls.map(([byteLength]) => byteLength)).toEqual([20, image.length - 20])
    expect(onStreamComplete).toHaveBeenCalledOnce()
    expect(onChunk.mock.invocationCallOrder.at(-1)).toBeLessThan(onStreamComplete.mock.invocationCallOrder[0]!)
    expect(stored.byteCount).toBe(BigInt(image.length))
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
