import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { EHentaiProvider, chooseCreatorBucket, hashResolvedMetadata } from '../providers/e-hentai'
import type { SafeHttpClient } from '../safe-http'

function createHttpMock() {
  return {
    json: vi.fn(),
    text: vi.fn(),
    request: vi.fn()
  }
}

describe('E-Hentai archive provider', () => {
  it('normalizes gallery metadata, namespaced tags and ordered pages', async () => {
    const http = createHttpMock()
    http.json.mockResolvedValue({
      gmetadata: [
        {
          gid: 123,
          token: 'abcdef1234',
          title: 'English title',
          title_jpn: '日本語タイトル',
          category: 'Manga',
          uploader: 'someone',
          posted: '1700000000',
          filecount: '2',
          tags: ['artist:Alice Smith', 'language:english', 'female:glasses'],
          parent_gid: '122',
          parent_key: 'parent1234'
        }
      ]
    })
    http.text.mockResolvedValue(`
      <div><a href="https://e-hentai.org/s/bbbbbbbbbb/123-2">two</a></div>
      <div><a href="/s/aaaaaaaaaa/123-1">one</a></div>
    `)
    const provider = new EHentaiProvider(http as unknown as SafeHttpClient)
    const result = await provider.resolve('https://e-hentai.org/g/123/abcdef1234/')

    expect(result.externalId).toBe('123')
    expect(result.title).toBe('日本語タイトル')
    expect(result.titleAliases).toEqual(['English title'])
    expect(result.creatorBucket).toBe('artist--alice-smith')
    expect(result.tags).toContainEqual({ namespace: 'female', name: 'glasses' })
    expect(result.relationships).toEqual([
      expect.objectContaining({ type: 'REPLACES', direction: 'OUTBOUND', externalId: '122' })
    ])
    expect(result.media.map((item) => item.sourcePageUrl)).toEqual([
      'https://e-hentai.org/s/aaaaaaaaaa/123-1',
      'https://e-hentai.org/s/bbbbbbbbbb/123-2'
    ])
    expect(hashResolvedMetadata(result.normalizedMetadata)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('resolves an image-page URL through the documented gtoken API', async () => {
    const http = createHttpMock()
    http.json
      .mockResolvedValueOnce({ tokenlist: [{ gid: 123, token: 'gallery1234' }] })
      .mockResolvedValueOnce({
        gmetadata: [
          {
            gid: 123,
            token: 'gallery1234',
            title: 'Gallery',
            filecount: '1',
            tags: []
          }
        ]
      })
    http.text.mockResolvedValue('<a href="https://e-hentai.org/s/page123456/123-1">one</a>')
    const provider = new EHentaiProvider(http as unknown as SafeHttpClient)

    const result = await provider.resolve('https://e-hentai.org/s/page123456/123-1')

    expect(result.canonicalUrl).toBe('https://e-hentai.org/g/123/gallery1234/')
    expect(http.json).toHaveBeenNthCalledWith(
      1,
      'https://api.e-hentai.org/api.php',
      expect.objectContaining({ body: JSON.stringify({ method: 'gtoken', pagelist: [[123, 'page123456', 1]] }) })
    )
  })

  it('uses the original media link and preserves the source filename', async () => {
    const http = createHttpMock()
    http.text.mockResolvedValue(`
      <title>source file.png :: E-Hentai</title>
      <a href="/fullimg.php?gid=123&page=1&key=abc">Download original</a>
      <img id="img" src="https://i1.e-hentai.org/display.jpg">
    `)
    http.request.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': '3' },
      stream: Readable.from([Buffer.from('png')]),
      url: 'https://e-hentai.org/fullimg.php?gid=123&page=1&key=abc'
    })
    const provider = new EHentaiProvider(http as unknown as SafeHttpClient)
    const remote = await provider.openMedia(
      { index: 0, sourcePageUrl: 'https://e-hentai.org/s/a/123-1', locator: {}, expectedFilename: '0001' },
      { quality: 'ORIGINAL' }
    )

    expect(http.request).toHaveBeenCalledWith(expect.stringContaining('fullimg.php'), expect.any(Object))
    expect(remote.originalFilename).toBe('source file.png')
    expect(remote.quality).toBe('ORIGINAL')
  })

  it('pauses for explicit display-quality fallback when original access is forbidden', async () => {
    const http = createHttpMock()
    http.text.mockResolvedValue(`
      <title>source.jpg :: E-Hentai</title>
      <a href="/fullimg.php?gid=123&page=1&key=abc">Download original</a>
      <img id="img" src="https://i1.e-hentai.org/display.jpg">
    `)
    http.request.mockResolvedValue({
      status: 403,
      headers: {},
      stream: Readable.from([]),
      url: 'https://e-hentai.org/fullimg.php?gid=123&page=1&key=abc'
    })
    const provider = new EHentaiProvider(http as unknown as SafeHttpClient)

    await expect(
      provider.openMedia(
        { index: 0, sourcePageUrl: 'https://e-hentai.org/s/a/123-1', locator: {}, expectedFilename: '0001' },
        { quality: 'ORIGINAL' }
      )
    ).rejects.toMatchObject({
      code: 'ORIGINAL_UNAVAILABLE',
      pause: true,
      decisionCode: 'USE_DISPLAY_QUALITY'
    })
  })

  it('keeps an original-media 404 as an item failure instead of pausing the gallery', async () => {
    const http = createHttpMock()
    http.text.mockResolvedValue(`
      <a href="/fullimg.php?gid=123&page=1&key=abc">Download original</a>
      <img id="img" src="https://i1.e-hentai.org/display.jpg">
    `)
    http.request.mockResolvedValue({
      status: 404,
      headers: {},
      stream: Readable.from([]),
      url: 'https://e-hentai.org/fullimg.php?gid=123&page=1&key=abc'
    })
    const provider = new EHentaiProvider(http as unknown as SafeHttpClient)

    await expect(
      provider.openMedia(
        { index: 0, sourcePageUrl: 'https://e-hentai.org/s/a/123-1', locator: {}, expectedFilename: '0001' },
        { quality: 'ORIGINAL' }
      )
    ).rejects.toMatchObject({ code: 'REMOTE_NOT_FOUND', pause: false })
  })

  it('uses immutable creator bucket fallback rules', () => {
    expect(chooseCreatorBucket([{ namespace: 'group', name: 'Circle' }])).toBe('group--circle')
    expect(
      chooseCreatorBucket([
        { namespace: 'artist', name: 'One' },
        { namespace: 'artist', name: 'Two' }
      ])
    ).toBe('_multiple')
    expect(chooseCreatorBucket([{ namespace: 'language', name: 'english' }])).toBe('_unknown')
  })
})
