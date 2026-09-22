import { describe, expect, it, vi } from 'vitest'
import { fetchPixivArtistMetadata } from '../client.ts'
import { storePixivArtistImage } from '../storage.ts'
import { fetchPixivArtworkMetadata } from '../../pixiv-artwork/client.ts'
import { fetchPixivTagMetadata } from '../../pixiv-tag/client.ts'
import { storePixivTagImage } from '../../pixiv-tag/storage.ts'
import { PixivProxyConfigurationError } from '../../shared/pixiv-proxy-error.ts'

const signal = new AbortController().signal
const cases = [
  {
    name: 'artist metadata',
    image: false,
    run: (fetchImpl: typeof fetch) => fetchPixivArtistMetadata({ pixivUserId: '123', signal, fetchImpl })
  },
  {
    name: 'artwork metadata',
    image: false,
    run: (fetchImpl: typeof fetch) => fetchPixivArtworkMetadata({ pixivArtworkId: '123', signal, fetchImpl })
  },
  {
    name: 'tag metadata',
    image: false,
    run: (fetchImpl: typeof fetch) => fetchPixivTagMetadata({ tagName: 'tag', signal, fetchImpl })
  },
  {
    name: 'artist image',
    image: true,
    run: (fetchImpl: typeof fetch) =>
      storePixivArtistImage({
        imageUrl: 'https://i.pximg.net/a.png',
        pixivUserId: '123',
        kind: 'avatar',
        pixivDataRoot: '/unused',
        signal,
        fetchImpl
      })
  },
  {
    name: 'tag image',
    image: true,
    run: (fetchImpl: typeof fetch) =>
      storePixivTagImage({ imageUrl: 'https://i.pximg.net/a.png', pixivDataRoot: '/unused', signal, fetchImpl })
  }
]

for (const entry of cases) {
  describe(entry.name + ' response lifecycle', () => {
    it.each([404, 429, 500, 403])('discards status %s even when cancellation fails', async (status) => {
      const cancel = vi.fn(() => {
        throw new Error('cleanup failure')
      })
      const response = new Response(new ReadableStream({ cancel }), { status })
      const outcome = await entry.run((async () => response) as typeof fetch).catch((error) => error)
      expect(cancel).toHaveBeenCalledOnce()
      expect(response.body?.locked).toBe(false)
      if (entry.image) expect(outcome).toMatchObject({ code: 'PIXIV_IMAGE_DOWNLOAD_FAILED' })
      else if (status !== 404)
        expect(outcome).toMatchObject({
          code:
            status === 429 ? 'PIXIV_RATE_LIMITED' : status === 500 ? 'PIXIV_UPSTREAM_ERROR' : 'PIXIV_REQUEST_REJECTED'
        })
      else expect(outcome).not.toBeInstanceOf(Error)
    })

    it('discards redirects before rejecting credentials without a second fetch', async () => {
      const cancel = vi.fn()
      const host = entry.image ? 'i.pximg.net' : 'www.pixiv.net'
      const response = new Response(new ReadableStream({ cancel }), {
        status: 302,
        headers: { location: `https://user:password@${host}/next` }
      })
      const fetchImpl = vi.fn(async () => response)
      await expect(entry.run(fetchImpl as typeof fetch)).rejects.toMatchObject({
        code: entry.image ? 'PIXIV_IMAGE_HOST_REJECTED' : 'PIXIV_INVALID_REDIRECT'
      })
      expect(cancel).toHaveBeenCalledOnce()
      expect(fetchImpl).toHaveBeenCalledOnce()
    })

    it('discards oversized declared bodies before reading', async () => {
      const cancel = vi.fn()
      const response = new Response(new ReadableStream({ cancel }), { headers: { 'content-length': '99999999' } })
      await expect(entry.run((async () => response) as typeof fetch)).rejects.toMatchObject({
        code: entry.image ? 'PIXIV_IMAGE_TOO_LARGE' : 'PIXIV_RESPONSE_TOO_LARGE'
      })
      expect(cancel).toHaveBeenCalledOnce()
      expect(response.body?.locked).toBe(false)
    })

    it('cancels oversized streamed bodies and releases the reader despite cleanup failure', async () => {
      const cancel = vi.fn(() => {
        throw new Error('cleanup failure')
      })
      const response = new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(entry.image ? 8 * 1024 * 1024 + 1 : 1_000_001))
          },
          cancel
        })
      )
      await expect(entry.run((async () => response) as typeof fetch)).rejects.toMatchObject({
        code: entry.image ? 'PIXIV_IMAGE_TOO_LARGE' : 'PIXIV_RESPONSE_TOO_LARGE'
      })
      expect(cancel).toHaveBeenCalledOnce()
      expect(response.body?.locked).toBe(false)
    })

    it('releases an errored reader and preserves its error or existing wrapper', async () => {
      const error = new Error('read failure')
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(error)
        }
      })
      const response = new Response(body)
      const outcome = await entry.run((async () => response) as typeof fetch).catch((caught) => caught)
      expect(body.locked).toBe(false)
      if (entry.name === 'tag image') expect(outcome).toMatchObject({ code: 'PIXIV_IMAGE_NETWORK_ERROR', cause: error })
      else expect(outcome).toBe(error)
    })

    it('releases the reader after fully consuming a body, before validation', async () => {
      const response = new Response('invalid payload')
      await expect(entry.run((async () => response) as typeof fetch)).rejects.toMatchObject({
        code: entry.image ? 'PIXIV_IMAGE_INVALID' : 'PIXIV_SCHEMA_CHANGED'
      })
      expect(response.bodyUsed).toBe(true)
      expect(response.body?.locked).toBe(false)
    })

    it('maps proxy configuration failure to the existing domain error', async () => {
      const error = new PixivProxyConfigurationError()
      const outcome = await entry
        .run((async () => {
          throw error
        }) as typeof fetch)
        .catch((caught) => caught)
      expect(outcome).toMatchObject({ code: 'PIXIV_PROXY_CONFIG_INVALID', message: error.message })
      if (!entry.image) expect(outcome.retryable).toBe(false)
    })
  })
}
