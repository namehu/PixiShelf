import { describe, expect, it, vi } from 'vitest'
import { fetchPixivArtworkMetadata, PixivArtworkRequestError } from '../client.ts'

describe('Pixiv artwork client', () => {
  it('normalizes a complete response without sending Cookie credentials', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).has('cookie')).toBe(false)
      return response({
        id: '123',
        title: '  Source title  ',
        description: ' Description ',
        userId: '456',
        userName: 'Artist',
        createDate: '2026-08-01T12:00:00+09:00',
        pageCount: 2,
        width: 1200,
        height: 800,
        bookmarkCount: 99,
        likeCount: 77,
        viewCount: 321,
        xRestrict: 1,
        aiType: 2,
        illustType: 0,
        sl: 6,
        urls: {
          original: 'https://i.pximg.net/img-original/example.jpg',
          regular: 'https://i.pximg.net/img-master/example.jpg'
        },
        tags: {
          tags: [
            { tag: '初音ミク', translation: { en: 'Hatsune Miku' } },
            { tag: '初音ミク', translation: 'duplicate' },
            { tag: 'VOCALOID', translation: 'Vocaloid' }
          ]
        },
        seriesNavData: { seriesId: '9', title: '  Manga series  ', order: '4' }
      })
    }) as typeof fetch

    const result = await fetchPixivArtworkMetadata({
      pixivArtworkId: '123',
      signal: new AbortController().signal,
      fetchImpl
    })

    expect(result?.normalized).toMatchObject({
      id: '123',
      title: 'Source title',
      description: 'Description',
      tags: ['初音ミク', 'VOCALOID'],
      tagTranslations: { 初音ミク: 'Hatsune Miku', VOCALOID: 'Vocaloid' },
      canonicalUrl: 'https://www.pixiv.net/artworks/123',
      size: '1200x800',
      remoteLikeCount: 77,
      aiType: 2,
      createDate: '2026-08-01T03:00:00.000Z',
      series: { state: 'PRESENT', id: '9', title: 'Manga series', order: 4 }
    })
  })

  it.each([
    ['explicit no-series', null, { state: 'NONE' }],
    ['invalid series payload', { seriesId: 'invalid' }, { state: 'UNKNOWN' }]
  ])('distinguishes %s from a valid series declaration', async (_name, seriesNavData, expected) => {
    const result = await fetchPixivArtworkMetadata({
      pixivArtworkId: '123',
      signal: new AbortController().signal,
      fetchImpl: (async () => response({ id: '123', tags: { tags: [] }, seriesNavData })) as typeof fetch
    })

    expect(result?.normalized.series).toEqual(expected)
  })

  it('keeps a missing series field unknown so it cannot remove membership', async () => {
    const result = await fetchPixivArtworkMetadata({
      pixivArtworkId: '123',
      signal: new AbortController().signal,
      fetchImpl: (async () => response({ id: '123', tags: { tags: [] } })) as typeof fetch
    })

    expect(result?.normalized.series).toEqual({ state: 'UNKNOWN' })
  })

  it('returns no data for 404', async () => {
    await expect(
      fetchPixivArtworkMetadata({
        pixivArtworkId: '123',
        signal: new AbortController().signal,
        fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch
      })
    ).resolves.toBeNull()
  })

  it('honors Retry-After for 429 and retries 5xx/network failures', async () => {
    const now = new Date('2026-08-25T00:00:00.000Z')
    const limited = await fetchPixivArtworkMetadata({
      pixivArtworkId: '123',
      signal: new AbortController().signal,
      now: () => now,
      fetchImpl: (async () => new Response(null, { status: 429, headers: { 'retry-after': '120' } })) as typeof fetch
    }).catch((error: unknown) => error)
    expect(limited).toMatchObject({
      code: 'PIXIV_RATE_LIMITED',
      retryable: true,
      retryAt: new Date('2026-08-25T00:02:00.000Z')
    })

    for (const fetchImpl of [
      (async () => new Response(null, { status: 503 })) as typeof fetch,
      (async () => Promise.reject(new Error('network'))) as typeof fetch
    ]) {
      const error = await fetchPixivArtworkMetadata({
        pixivArtworkId: '123',
        signal: new AbortController().signal,
        fetchImpl
      }).catch((caught: unknown) => caught)
      expect(error).toMatchObject({ retryable: true })
    }
  })

  it.each([
    ['identity mismatch', response({ id: '999', tags: { tags: [] } }), 'PIXIV_IDENTITY_MISMATCH'],
    ['missing tag snapshot', response({ id: '123' }), 'PIXIV_SCHEMA_CHANGED'],
    ['invalid JSON', new Response('{', { status: 200 }), 'PIXIV_SCHEMA_CHANGED'],
    [
      'oversized response',
      new Response('x', { status: 200, headers: { 'content-length': '1000001' } }),
      'PIXIV_RESPONSE_TOO_LARGE'
    ]
  ])('rejects %s without a retry', async (_name, upstream, code) => {
    const error = await fetchPixivArtworkMetadata({
      pixivArtworkId: '123',
      signal: new AbortController().signal,
      fetchImpl: (async () => upstream) as typeof fetch
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(PixivArtworkRequestError)
    expect(error).toMatchObject({ code, retryable: false })
  })

  it('rejects redirects outside the exact Pixiv API host', async () => {
    const error = await fetchPixivArtworkMetadata({
      pixivArtworkId: '123',
      signal: new AbortController().signal,
      fetchImpl: (async () =>
        new Response(null, { status: 302, headers: { location: 'https://evil.invalid/metadata' } })) as typeof fetch
    }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'PIXIV_INVALID_REDIRECT', retryable: false })
  })

  it('times out stalled requests and marks them retryable', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
    ) as typeof fetch

    const error = await fetchPixivArtworkMetadata({
      pixivArtworkId: '123',
      signal: new AbortController().signal,
      fetchImpl,
      requestTimeoutMs: 5
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'PIXIV_REQUEST_TIMEOUT', retryable: true })
  })
})

function response(body: Record<string, unknown>) {
  return new Response(JSON.stringify({ error: false, body }), { status: 200 })
}
