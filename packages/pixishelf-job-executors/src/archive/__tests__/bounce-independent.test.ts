import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { EHentaiProvider } from '../providers/e-hentai.js'

const source = 'https://e-hentai.org/s/fixture/1-1'
const original = 'https://e-hentai.org/fullimg/1/key/1/source'
const bounce = 'https://e-hentai.org/bounce_login.php?b=ds&bt=fixture'
const item = { index: 0, sourcePageUrl: source, locator: {}, expectedFilename: '0001' }

describe('anonymous original login bounce', () => {
  it('pauses when the original request returns a 200 login bounce directly', async () => {
    const stream = Readable.from(['<form action="https://forums.e-hentai.org/index.php?act=Login">'])
    const http = {
      text: vi.fn(async () => `<a href="${original}">Download original 2 x 3 100 B</a>`),
      request: vi.fn(async () => ({ status: 200, headers: { 'content-type': 'text/html' }, stream, url: bounce }))
    }
    const provider = new EHentaiProvider(http as never, { getCookie: async () => null })
    await expect(provider.openMedia(item, { quality: 'ORIGINAL' })).rejects.toMatchObject({
      code: 'ORIGINAL_UNAVAILABLE',
      pause: true,
      stage: 'MEDIA_REQUEST'
    })
    expect(http.request).toHaveBeenCalledOnce()
    expect(stream.destroyed || stream.readableFlowing === true).toBe(true)
  })

  it.each([
    [403, 'REMOTE_FORBIDDEN'],
    [509, 'REMOTE_QUOTA_EXCEEDED']
  ])('preserves HTTP %i classification for a bounce URL', async (status, code) => {
    const http = {
      text: vi.fn(async () => `<a href="${original}">Download original 2 x 3 100 B</a>`),
      request: vi.fn(async () => ({ status, headers: {}, stream: Readable.from([]), url: bounce }))
    }
    const provider = new EHentaiProvider(http as never, { getCookie: async () => null })
    await expect(provider.openMedia(item, { quality: 'ORIGINAL' })).rejects.toMatchObject({ code, pause: true })
  })
})
