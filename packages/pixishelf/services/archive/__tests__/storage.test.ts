import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { buildArchiveStoragePaths, prepareStagingDirectory, storeRemoteMedia, validateStoredMedia, writeManifest } from '../storage'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('archive storage', () => {
  it('uses an immutable directory for every publication attempt and permits creator bucket changes', () => {
    const first = buildArchiveStoragePaths({
      scanRoot: 'D:/archive', importId: 'revision-1', providerKey: 'e-hentai', creatorBucket: '_unknown', externalId: '42'
    })
    const second = buildArchiveStoragePaths({
      scanRoot: 'D:/archive', importId: 'revision-2', providerKey: 'e-hentai', creatorBucket: 'artist--alice', externalId: '42'
    })

    expect(first.finalRelativePath).toBe('sources/e-hentai/_unknown/42/revisions/revision-1')
    expect(second.finalRelativePath).toBe('sources/e-hentai/artist-alice/42/revisions/revision-2')
    expect(second.finalAbsolutePath).not.toBe(first.finalAbsolutePath)
  })

  it('streams, hashes, decodes and validates media before writing a manifest', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-archive-'))
    temporaryDirectories.push(root)
    const staging = await prepareStagingDirectory(root, '.archive-staging/task-1')
    const result = await storeRemoteMedia({
      remote: {
        stream: Readable.from([PNG_1X1.subarray(0, 20), PNG_1X1.subarray(20)]),
        mimeType: 'image/png',
        contentLength: PNG_1X1.length,
        originalFilename: 'source.png',
        quality: 'ORIGINAL'
      },
      stagingDirectory: staging,
      index: 0,
      expectedFilename: '0001'
    })

    expect(result.filename).toBe('0001-source.png')
    expect(result.width).toBe(1)
    expect(result.height).toBe(1)
    expect(result.sha256).toBe(createHash('sha256').update(PNG_1X1).digest('hex'))
    await validateStoredMedia(staging, [
      { stagedPath: result.relativePath, sha256: result.sha256, byteCount: result.byteCount }
    ])
    await writeManifest(staging, { manifestVersion: 1, bytes: result.byteCount })
    const manifest = JSON.parse(await readFile(path.join(staging, 'manifest.json'), 'utf8'))
    expect(manifest).toEqual({ manifestVersion: 1, bytes: String(PNG_1X1.length) })

    const retried = await storeRemoteMedia({
      remote: {
        stream: Readable.from([PNG_1X1]),
        mimeType: 'image/png',
        contentLength: PNG_1X1.length,
        originalFilename: 'source.png',
        quality: 'ORIGINAL'
      },
      stagingDirectory: staging,
      index: 0,
      expectedFilename: '0001'
    })
    expect(retried.filename).toBe(result.filename)
  })
})
