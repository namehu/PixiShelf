import { describe, expect, it } from 'vitest'
import { fetchPixivArtistMetadata, PixivArtistRequestError } from '../client.ts'

describe('Pixiv artist client', () => {
  it('normalizes the source name and image fields', async () => {
    await expect(
      fetchPixivArtistMetadata({
        pixivUserId: '123',
        signal: new AbortController().signal,
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({
              error: false,
              body: {
                userId: '123',
                name: ' Artist ',
                image: 'https://i.pximg.net/avatar-small.jpg',
                imageBig: 'https://i.pximg.net/avatar.jpg',
                background: { url: 'https://i.pximg.net/background.jpg' }
              }
            }),
            { status: 200 }
          )) as typeof fetch
      })
    ).resolves.toEqual({
      sourceName: 'Artist',
      avatarUrl: 'https://i.pximg.net/avatar.jpg',
      backgroundUrl: 'https://i.pximg.net/background.jpg'
    })
  })

  it('treats 404 as checked with no data', async () => {
    await expect(
      fetchPixivArtistMetadata({
        pixivUserId: '123',
        signal: new AbortController().signal,
        fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch
      })
    ).resolves.toEqual({ sourceName: null, avatarUrl: null, backgroundUrl: null })
  })

  it('honors Retry-After for 429 responses', async () => {
    const now = new Date('2026-08-25T00:00:00.000Z')
    const error = await fetchPixivArtistMetadata({
      pixivUserId: '123',
      signal: new AbortController().signal,
      now: () => now,
      fetchImpl: (async () => new Response(null, { status: 429, headers: { 'retry-after': '120' } })) as typeof fetch
    }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      code: 'PIXIV_RATE_LIMITED',
      retryable: true,
      retryAt: new Date('2026-08-25T00:02:00.000Z')
    })
  })

  it('rejects an identity mismatch as non-retryable', async () => {
    const error = await fetchPixivArtistMetadata({
      pixivUserId: '123',
      signal: new AbortController().signal,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: false, body: { userId: '456', name: 'Other' } }), {
          status: 200
        })) as typeof fetch
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(PixivArtistRequestError)
    expect(error).toMatchObject({ code: 'PIXIV_IDENTITY_MISMATCH', retryable: false })
  })
})
