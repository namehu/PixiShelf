import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  buildArchiveStoragePaths,
  pathExists,
  prepareArchiveRevisionDirectory,
  prepareArchiveStagingDirectory,
  storeArchiveRemoteMedia
} from '../storage.js'

const temporaryDirectories: string[] = []
const originalCache = sharp.cache()
// libvips' operation cache can keep fixture files open across rename on Windows.
beforeAll(() => {
  sharp.cache(false)
})
afterAll(() => {
  sharp.cache({ memory: originalCache.memory.max, files: originalCache.files.max, items: originalCache.items.max })
})

async function storeImageFixture(image: Buffer, filename: string, mimeType: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-archive-storage-'))
  temporaryDirectories.push(root)
  await mkdir(path.join(root, 'media'))
  const store = () =>
    storeArchiveRemoteMedia({
      remote: {
        stream: Readable.from([image]),
        contentLength: image.length,
        mimeType,
        originalFilename: filename,
        quality: 'ORIGINAL',
        remoteHost: 'example.test'
      },
      stagingDirectory: root,
      index: 0,
      expectedFilename: filename,
      signal: new AbortController().signal,
      partialKey: 'attempt-1'
    })
  return { root, store }
}

async function manyFrameWebp() {
  const twoFrames = Buffer.from(
    'UklGRpQAAABXRUJQVlA4WAoAAAACAAAAAAAAAAAAQU5JTQYAAAD/////AABBTk1GMAAAAAAAAAAAAAAAAAAAAGQAAAJWUDggGAAAADABAJ0BKgEAAQABQCYlpAADcAD+/TZoAEFOTUYwAAAAAAAAAAAAAAAAAAAAZAAAAFZQOCAYAAAANAEAnQEqAQABAAAAJiWkAANwAP789AAA',
    'base64'
  )
  const encoded = await sharp(twoFrames, { animated: true }).resize(1024, 1024).webp({ lossless: true }).toBuffer()
  const frames: Buffer[] = []
  let firstFrame = 0
  for (let offset = 12; offset < encoded.length; ) {
    const size = encoded.readUInt32LE(offset + 4)
    const end = offset + 8 + size + (size % 2)
    if (encoded.toString('ascii', offset, offset + 4) === 'ANMF') {
      if (!firstFrame) firstFrame = offset
      frames.push(encoded.subarray(offset, end))
    }
    offset = end
  }
  expect(frames).toHaveLength(2)
  // Repeat encoded frames without allocating a > 1 GB decoded animation.
  const image = Buffer.concat([encoded.subarray(0, firstFrame), ...Array.from({ length: 129 }, () => frames).flat()])
  image.writeUInt32LE(image.length - 8, 4)
  return image
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('archive executor storage safety', () => {
  it('archives an animated WebP over the cumulative pixel limit without changing any frame bytes', async () => {
    const image = await manyFrameWebp()
    await expect(sharp(image, { animated: true }).metadata()).rejects.toThrow('Input image exceeds pixel limit')
    const { root, store } = await storeImageFixture(image, 'animation.webp', 'image/webp')
    const stored = await store()
    expect(stored).toMatchObject({
      width: 1024,
      height: 1024,
      byteCount: BigInt(image.length),
      sha256: createHash('sha256').update(image).digest('hex')
    })
    const saved = await readFile(path.join(root, stored.relativePath))
    expect(saved).toEqual(image)
    expect(await sharp(saved).metadata()).toMatchObject({ width: 1024, height: 1024, pages: 258 })
  })

  it('still rejects an image exceeding the single-frame pixel limit and removes the partial file', async () => {
    const image = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="20000"><rect width="20000" height="20000"/></svg>'
    )
    const { root, store } = await storeImageFixture(image, 'large.svg', 'image/svg+xml')
    await expect(store()).rejects.toMatchObject({
      code: 'MEDIA_INVALID',
      stage: 'MEDIA_VALIDATION',
      cause: expect.objectContaining({ message: 'Input image exceeds pixel limit' })
    })
    expect(await pathExists(path.join(root, 'media', '0001-large.svg'))).toBe(false)
    expect(await pathExists(path.join(root, 'media', '0001-large.svg.part-attempt-1'))).toBe(false)
  })

  it('still rejects invalid image headers', async () => {
    const { store } = await storeImageFixture(Buffer.from('invalid webp'), 'broken.webp', 'image/webp')
    await expect(store()).rejects.toMatchObject({ code: 'MEDIA_INVALID', stage: 'MEDIA_VALIDATION' })
  })
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

    await expect(prepareArchiveStagingDirectory(root, '../outside')).rejects.toThrow('归档路径超出了配置的根目录')
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
    ).rejects.toThrow('归档路径超出了配置的根目录')
  })
})
