import { extractJobDiagnostic } from '@pixishelf/job-contracts'
import type { ArchiveRemoteMedia } from '../types.js'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { EHentaiProvider } from '../providers/e-hentai.js'
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

async function storeImageFixture(
  image: Buffer,
  filename: string,
  mimeType: string,
  remoteOptions: Partial<Pick<ArchiveRemoteMedia, 'expectedSha1' | 'httpStatus' | 'contentLength' | 'stream'>> = {}
) {
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
        remoteHost: 'example.test',
        ...remoteOptions
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
  it.each([false, true])('validates a derived WebP using its own hash (corrupt=%s)', async (corrupt) => {
    const image = await sharp({ create: { width: 4, height: 3, channels: 3, background: 'blue' } })
      .webp()
      .toBuffer()
    const digest = createHash('sha1').update(image).digest('hex')
    const url = `https://example.hath.network/om/123/${'a'.repeat(40)}-1000-8-6-jpg/${digest}-${image.length}-4-3-wbp/4/key/image.webp`
    const provider = new EHentaiProvider({
      text: async () => `<img id="img" src="${url}">`,
      request: async () => ({ status: 200, headers: {}, stream: Readable.from([]), url })
    } as never)
    const remote = await provider.openMedia(
      { index: 0, sourcePageUrl: 'https://e-hentai.org/s/token/123-1', locator: {}, expectedFilename: '0001' },
      { quality: 'DISPLAY' }
    )
    expect(remote.expectedSha1).toBe(digest)
    if (!remote.expectedSha1) throw new Error('Missing derived representation hash')
    const body = corrupt ? Buffer.alloc(image.length) : image
    const { root, store } = await storeImageFixture(body, 'derived.webp', 'image/webp', {
      expectedSha1: remote.expectedSha1
    })
    if (corrupt) {
      await expect(store()).rejects.toMatchObject({ code: 'MEDIA_INVALID', message: expect.stringContaining('SHA-1') })
    } else {
      const stored = await store()
      expect(await readFile(path.join(root, stored.relativePath))).toEqual(image)
      expect(stored).toMatchObject({ width: 4, height: 3 })
    }
  })

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
      message: '归档图片单帧像素数超过安全上限',
      cause: expect.objectContaining({ message: 'Input image exceeds pixel limit' })
    })
    expect(await pathExists(path.join(root, 'media', '0001-large.svg'))).toBe(false)
    expect(await pathExists(path.join(root, 'media', '0001-large.svg.part-attempt-1'))).toBe(false)
  })

  it('rejects same-length zero-filled content with bounded digest and header evidence', async () => {
    const original = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
      .png()
      .toBuffer()
    const damaged = Buffer.alloc(original.length)
    const expectedSha1 = createHash('sha1').update(original).digest('hex')
    const { root, store } = await storeImageFixture(damaged, 'zero.png', 'image/png', { expectedSha1, httpStatus: 200 })
    const error = await store().catch((error) => error)
    expect(error).toMatchObject({
      code: 'MEDIA_INVALID',
      recoverable: true,
      stage: 'MEDIA_VALIDATION',
      httpStatus: 200,
      mediaEvidence: {
        headHex: '00'.repeat(32),
        receivedBytes: original.length,
        contentLength: original.length,
        mimeType: 'image/png',
        expectedSha1,
        actualSha1: createHash('sha1').update(damaged).digest('hex'),
        hashComplete: true
      }
    })
    expect(error.message).toContain('SHA-1')
    expect(await pathExists(path.join(root, 'media', '0001-zero.png'))).toBe(false)
    const diagnostic = extractJobDiagnostic(error)
    expect(diagnostic.reasonKey).toBe('code:MEDIA_INVALID')
    expect(diagnostic.message).toContain('下载内容已损坏')
    expect(diagnostic.evidence[0]?.media?.headHex).toHaveLength(64)
  })

  it.each([true, false])('preserves correct image bytes when expected SHA-1 is supplied=%s', async (supplyHash) => {
    const original = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'blue' } })
      .png()
      .toBuffer()
    const expectedSha1 = createHash('sha1').update(original).digest('hex')
    const { root, store } = await storeImageFixture(
      original,
      'valid.png',
      'image/png',
      supplyHash ? { expectedSha1 } : {}
    )
    const result = await store()
    expect(await readFile(path.join(root, result.relativePath))).toEqual(original)
    expect(result.sha256).toBe(createHash('sha256').update(original).digest('hex'))
  })

  it('retains partial-file evidence and root errno when the stream fails', async () => {
    const body = Buffer.from('prefix bytes from media')
    const reset = Object.assign(new Error('socket connection reset'), { code: 'ECONNRESET' })
    const stream = Readable.from(
      (async function* () {
        yield body
        throw reset
      })()
    )
    const { store } = await storeImageFixture(Buffer.alloc(100), 'broken.png', 'image/png', { stream, httpStatus: 200 })
    const error = await store().catch((error) => error)
    expect(error).toMatchObject({
      code: 'REMOTE_RESPONSE_INVALID',
      stage: 'MEDIA_STREAM',
      mediaEvidence: {
        receivedBytes: body.length,
        contentLength: 100,
        headHex: body.toString('hex'),
        hashComplete: false,
        actualSha1: createHash('sha1').update(body).digest('hex')
      }
    })
    const diagnostic = extractJobDiagnostic(error)
    expect(diagnostic.reasonKey).toBe('errno:ECONNRESET')
    expect(diagnostic.evidence.some((entry) => entry.media?.hashComplete === false)).toBe(true)
    expect(JSON.stringify(diagnostic)).not.toContain(body.toString())
  })

  it('retains the stable Chinese unsupported-format explanation above the Sharp cause', async () => {
    const { store } = await storeImageFixture(Buffer.from('unsupported binary'), 'unsupported.webp', 'image/webp', {
      httpStatus: 200
    })
    const error = await store().catch((error) => error)
    const diagnostic = extractJobDiagnostic(error)
    expect(diagnostic.message).toContain('可能是不支持的图片格式或内容不完整')
    expect(diagnostic.message).not.toContain('内容已损坏')
    expect(diagnostic.message).not.toContain('Input file contains unsupported')
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
