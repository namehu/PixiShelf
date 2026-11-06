import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { EHentaiProvider } from '../providers/e-hentai.js'
import { storeArchiveRemoteMedia } from '../storage.js'

it('stores an anonymous original only after its actual bytes satisfy the source declaration', async () => {
  const image = await sharp({ create: { width: 2, height: 3, channels: 3, background: 'blue' } })
    .png()
    .toBuffer()
  const originalUrl = 'https://e-hentai.org/fullimg/123/key/1/source'
  const getCookie = vi.fn(async () => null)
  const http = {
    text: vi.fn(
      async () =>
        `<title>source.png :: Gallery</title><a href="${originalUrl}">Download original 2 x 3 ${image.length} B</a>`
    ),
    request: vi.fn(async () => ({
      status: 200,
      headers: { 'content-type': 'image/png' },
      stream: Readable.from([image]),
      url: originalUrl
    }))
  }
  const provider = new EHentaiProvider(http as never, { getCookie })
  const remote = await provider.openMedia(
    { index: 0, sourcePageUrl: 'https://e-hentai.org/s/key/123-1', locator: {}, expectedFilename: '0001' },
    { quality: 'ORIGINAL' }
  )
  const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-anonymous-original-'))
  try {
    await mkdir(path.join(root, 'media'))
    const stored = await storeArchiveRemoteMedia({
      remote,
      stagingDirectory: root,
      index: 0,
      expectedFilename: '0001',
      signal: new AbortController().signal,
      partialKey: randomUUID()
    })
    expect(getCookie).toHaveBeenCalledOnce()
    expect(http.request).toHaveBeenCalledOnce()
    expect(stored).toMatchObject({
      quality: 'ORIGINAL',
      deliveryEvidence: { quality: 'ORIGINAL', reason: 'EH_EXPLICIT_ORIGINAL_METADATA_MATCH' }
    })
    expect(await readFile(path.join(root, stored.relativePath))).toEqual(image)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
