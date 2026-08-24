import { describe, expect, it } from 'vitest'
import { fetchPixivTagMetadata, PixivTagRequestError } from '../client.ts'

describe('Pixiv tag client', () => {
  it('normalizes translations and Pixpedia fields from the public Ajax response', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          error: false,
          body: {
            tagTranslation: { original: { zh: ' 中文 ', en: ' English ' } },
            pixpedia: { abstract: ' summary ', image: 'https://i.pximg.net/tag.png' }
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )

    await expect(
      fetchPixivTagMetadata({
        tagName: 'original',
        signal: new AbortController().signal,
        fetchImpl: fetchImpl as typeof fetch
      })
    ).resolves.toEqual({
      nameZh: '中文',
      nameEn: 'English',
      abstract: 'summary',
      imageUrl: 'https://i.pximg.net/tag.png'
    })
  })

  it('treats a legitimate 404 as checked with no data', async () => {
    await expect(
      fetchPixivTagMetadata({
        tagName: 'missing',
        signal: new AbortController().signal,
        fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch
      })
    ).resolves.toEqual({ nameZh: null, nameEn: null, abstract: null, imageUrl: null })
  })

  it('stops safely when the provider schema changes', async () => {
    const error = await fetchPixivTagMetadata({
      tagName: 'tag',
      signal: new AbortController().signal,
      fetchImpl: (async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 })) as typeof fetch
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PixivTagRequestError)
    expect(error).toMatchObject({ code: 'PIXIV_SCHEMA_CHANGED', retryable: false })
  })

  it('bounds a streamed response even when content-length is absent', async () => {
    const error = await fetchPixivTagMetadata({
      tagName: 'tag',
      signal: new AbortController().signal,
      fetchImpl: (async () => new Response('x'.repeat(1_000_001), { status: 200 })) as typeof fetch
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'PIXIV_RESPONSE_TOO_LARGE', retryable: false })
  })

  it('honors Retry-After on rate limiting', async () => {
    const now = new Date('2026-08-24T00:00:00.000Z')
    const error = await fetchPixivTagMetadata({
      tagName: 'tag',
      signal: new AbortController().signal,
      now: () => now,
      fetchImpl: (async () => new Response(null, { status: 429, headers: { 'retry-after': '120' } })) as typeof fetch
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      code: 'PIXIV_RATE_LIMITED',
      retryable: true,
      retryAt: new Date('2026-08-24T00:02:00.000Z')
    })
  })
})
