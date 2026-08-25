import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PixivArtistImageError, storePixivArtistImage } from '../storage.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('Pixiv artist image storage', () => {
  it('validates and atomically publishes an avatar under the Pixiv user directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-pixiv-artist-'))
    temporaryRoots.push(root)
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#224466' } })
      .png()
      .toBuffer()
    const fileName = await storePixivArtistImage({
      imageUrl: 'https://i.pximg.net/avatar.png',
      pixivUserId: '123',
      kind: 'avatar',
      pixivDataRoot: root,
      signal: new AbortController().signal,
      fetchImpl: (async () => new Response(Uint8Array.from(image), { status: 200 })) as typeof fetch
    })
    expect(fileName).toBe('avatar.png')
    await expect(fs.readFile(path.join(root, 'artists', '123', 'avatar.png'))).resolves.toEqual(image)
  })

  it('rejects non-allowlisted image hosts before fetching', async () => {
    const fetchImpl = vi.fn()
    const error = await storePixivArtistImage({
      imageUrl: 'https://example.com/avatar.jpg',
      pixivUserId: '123',
      kind: 'avatar',
      pixivDataRoot: 'unused',
      signal: new AbortController().signal,
      fetchImpl: fetchImpl as typeof fetch
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(PixivArtistImageError)
    expect(error).toMatchObject({ code: 'PIXIV_IMAGE_HOST_REJECTED' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects invalid image bytes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-pixiv-artist-'))
    temporaryRoots.push(root)
    await expect(
      storePixivArtistImage({
        imageUrl: 'https://i.pximg.net/avatar.jpg',
        pixivUserId: '123',
        kind: 'avatar',
        pixivDataRoot: root,
        signal: new AbortController().signal,
        fetchImpl: (async () => new Response('not-an-image', { status: 200 })) as typeof fetch
      })
    ).rejects.toMatchObject({ code: 'PIXIV_IMAGE_INVALID' })
  })
})
