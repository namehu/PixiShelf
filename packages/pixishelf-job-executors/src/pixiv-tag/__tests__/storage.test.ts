import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PixivTagImageError, storePixivTagImage } from '../storage.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('Pixiv tag image storage', () => {
  it('validates an image and publishes it under a content-hash filename', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-pixiv-tag-'))
    temporaryRoots.push(root)
    const image = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } }
    })
      .png()
      .toBuffer()

    const fileName = await storePixivTagImage({
      imageUrl: 'https://i.pximg.net/tag.png',
      pixivDataRoot: root,
      signal: new AbortController().signal,
      fetchImpl: (async () => new Response(Uint8Array.from(image), { status: 200 })) as typeof fetch
    })

    expect(fileName).toMatch(/^[a-f0-9]{64}\.png$/)
    await expect(fs.readFile(path.join(root, 'tags', fileName))).resolves.toEqual(image)
  })

  it('rejects non-allowlisted image hosts before making a request', async () => {
    const fetchImpl = vi.fn()
    const error = await storePixivTagImage({
      imageUrl: 'https://example.com/tag.png',
      pixivDataRoot: 'unused',
      signal: new AbortController().signal,
      fetchImpl: fetchImpl as typeof fetch
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PixivTagImageError)
    expect(error).toMatchObject({ code: 'PIXIV_IMAGE_HOST_REJECTED' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects bytes that Sharp cannot validate as an image', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-pixiv-tag-'))
    temporaryRoots.push(root)
    await expect(
      storePixivTagImage({
        imageUrl: 'https://i.pximg.net/tag.png',
        pixivDataRoot: root,
        signal: new AbortController().signal,
        fetchImpl: (async () => new Response('not-an-image', { status: 200 })) as typeof fetch
      })
    ).rejects.toMatchObject({ code: 'PIXIV_IMAGE_INVALID' })
  })

  it('classifies response-body timeout failures as image network errors', async () => {
    const body = new ReadableStream({
      pull(controller) {
        controller.error(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
      }
    })

    await expect(
      storePixivTagImage({
        imageUrl: 'https://i.pximg.net/tag.png',
        pixivDataRoot: 'unused',
        signal: new AbortController().signal,
        fetchImpl: (async () => new Response(body, { status: 200 })) as typeof fetch
      })
    ).rejects.toMatchObject({
      code: 'PIXIV_IMAGE_NETWORK_ERROR',
      message: 'Pixiv 标签封面下载超时或网络异常'
    })
  })
})
