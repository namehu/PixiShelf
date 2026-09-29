import { describe, expect, it, vi } from 'vitest'
import { ArchiveError } from '../errors.js'
import { EHentaiProvider } from '../providers/e-hentai.js'

const galleryUrl = 'https://e-hentai.org/g/123/gallerytoken/'

function pageHtml(body: string, options: { next?: string; total?: number; title?: string } = {}) {
  return [
    `<div id="gn">English title</div><div id="gj">${options.title ?? '日本語タイトル'}</div>`,
    options.total ? `<div id="gdd"><table><tr><td class="gdt2">${options.total} pages</td></tr></table></div>` : '',
    '<div id="gdt">',
    body,
    '</div>',
    options.next ? `<a rel="next" href="${options.next}">Next</a>` : ''
  ].join('')
}

function ordinaryThumbnail(
  page: number,
  source = `https://t1.ehgt.org/t/123-${page}.jpg?nl=private#fragment`,
  dimensions = 'width: 120px; height: 180px'
) {
  return [
    '<div class="gdtl">',
    `<a href="https://e-hentai.org/s/page${page}/123-${page}">`,
    `<img alt="Page ${page}: image-${page}.jpg" src="${source}" style="${dimensions}">`,
    '</a></div>'
  ].join('')
}

function spriteThumbnail(page: number, position = '-200px -300px') {
  return [
    '<div class="gdtm" style="height:154px">',
    `<div style="width:100px;height:150px;background:transparent url('https://cdn.hath.network/t/sprite.jpg?token=private') ${position} no-repeat">`,
    `<a href="/s/spritetoken/123-${page}"><img alt="Page ${page}: image-${page}.jpg"></a>`,
    '</div></div>'
  ].join('')
}

describe('EHentaiProvider gallery thumbnail preview', () => {
  it('parses legacy image and modern sprite thumbnails in source order without resolving image pages', async () => {
    const http = {
      text: vi.fn(async (_url: string) =>
        pageHtml([ordinaryThumbnail(2), spriteThumbnail(3), ordinaryThumbnail(1), ordinaryThumbnail(2)].join(''), {
          next: '/g/123/gallerytoken/?p=1',
          total: 43
        })
      ),
      json: vi.fn(),
      request: vi.fn()
    }
    const resolveRequestSpy = vi.fn()
    const runResolveRequest = <T>(operation: () => Promise<T>) => {
      resolveRequestSpy()
      return operation()
    }

    const result = await new EHentaiProvider(http as never).previewPage(
      { url: `${galleryUrl}?ignored=1#fragment`, page: 0 },
      { runResolveRequest }
    )

    expect(result).toEqual({
      providerKey: 'e-hentai',
      externalId: '123',
      canonicalUrl: galleryUrl,
      title: '日本語タイトル',
      total: 43,
      page: 0,
      items: [
        { ordinal: 0, url: 'https://t1.ehgt.org/t/123-1.jpg', width: 120, height: 180 },
        { ordinal: 1, url: 'https://t1.ehgt.org/t/123-2.jpg', width: 120, height: 180 },
        {
          ordinal: 2,
          url: 'https://cdn.hath.network/t/sprite.jpg',
          width: 100,
          height: 150,
          crop: { x: 200, y: 300, width: 100, height: 150 }
        }
      ],
      nextPage: 1
    })
    expect(http.text).toHaveBeenCalledOnce()
    expect(http.text).toHaveBeenCalledWith(galleryUrl, expect.objectContaining({ maxBytes: 8 * 1024 * 1024 }))
    expect(http.json).not.toHaveBeenCalled()
    expect(http.request).not.toHaveBeenCalled()
    expect(resolveRequestSpy).toHaveBeenCalledOnce()
    expect(http.text.mock.calls.every(([url]) => !String(url).includes('/s/') && !String(url).includes('fullimg'))).toBe(
      true
    )
  })

  it('uses only gtoken for an image-page input and keeps the recovered gallery identity exact', async () => {
    const http = {
      json: vi.fn(async () => ({ tokenlist: [{ gid: 123, token: 'exacttoken' }] })),
      text: vi.fn(async (_url: string) =>
        pageHtml(ordinaryThumbnail(41), {
          next: 'https://e-hentai.org/g/123/exacttoken/?p=2',
          total: 80,
          title: ''
        })
      ),
      request: vi.fn()
    }
    const resolveRequestSpy = vi.fn()
    const runResolveRequest = <T>(operation: () => Promise<T>) => {
      resolveRequestSpy()
      return operation()
    }

    const result = await new EHentaiProvider(http as never).previewPage(
      { url: 'https://e-hentai.org/s/pagetoken/123-41', page: 1 },
      { runResolveRequest }
    )

    expect(result.canonicalUrl).toBe('https://e-hentai.org/g/123/exacttoken/')
    expect(result.externalId).toBe('123')
    expect(result.items[0]?.ordinal).toBe(40)
    expect(result.nextPage).toBe(2)
    expect(http.json).toHaveBeenCalledOnce()
    expect(http.json).toHaveBeenCalledWith(
      'https://api.e-hentai.org/api.php',
      expect.objectContaining({
        body: JSON.stringify({ method: 'gtoken', pagelist: [[123, 'pagetoken', 41]] })
      })
    )
    expect(http.text).toHaveBeenCalledOnce()
    expect(http.text.mock.calls[0]?.[0]).toBe('https://e-hentai.org/g/123/exacttoken/?p=1')
    expect(http.request).not.toHaveBeenCalled()
    expect(resolveRequestSpy).toHaveBeenCalledTimes(2)
  })

  it('accepts flexible source ranges and ends only without an exact same-gallery next link', async () => {
    const http = {
      text: vi.fn(async (_url: string) =>
        pageHtml([ordinaryThumbnail(91), ordinaryThumbnail(92)].join(''), {
          next: 'https://e-hentai.org/g/999/othertoken/?p=4',
          total: 92
        })
      )
    }
    const result = await new EHentaiProvider(http as never).previewPage({ url: galleryUrl, page: 3 })

    expect(result.items.map(({ ordinal }) => ordinal)).toEqual([90, 91])
    expect(result.nextPage).toBeNull()
    expect(http.text).toHaveBeenCalledWith('https://e-hentai.org/g/123/gallerytoken/?p=3', expect.any(Object))
  })

  it('parses the modern direct #gdt anchor form and sprite positions placed before url()', async () => {
    const html = [
      '<div id="gdt">',
      '<a href="/s/modern/123-1">',
      '<div style="width:110px;height:160px;background:-220px 0 url(https://t.ehgt.org/t/modern-sprite.jpg) no-repeat"></div>',
      '</a>',
      '</div>'
    ].join('')
    const result = await new EHentaiProvider({ text: vi.fn(async () => html) } as never).previewPage({
      url: galleryUrl,
      page: 0
    })

    expect(result.title).toBe('原站作品 #123')
    expect(result.items).toEqual([
      {
        ordinal: 0,
        url: 'https://t.ehgt.org/t/modern-sprite.jpg',
        width: 110,
        height: 160,
        crop: { x: 220, y: 0, width: 110, height: 160 }
      }
    ])
  })

  it.each([
    ['untrusted host', 'https://evil-ehgt.org/t/thumb.jpg'],
    ['credentials', 'https://user@ehgt.org/t/thumb.jpg'],
    ['non-standard port', 'https://ehgt.org:444/t/thumb.jpg'],
    ['plain HTTP', 'http://ehgt.org/t/thumb.jpg'],
    ['full image endpoint', 'https://e-hentai.org/fullimg.php?gid=123&page=1'],
    ['image page endpoint', 'https://e-hentai.org/s/token/123-1']
  ])('rejects a thumbnail URL attack: %s', async (_label, source) => {
    const http = { text: vi.fn(async () => pageHtml(ordinaryThumbnail(1, source))) }
    const preview = new EHentaiProvider(http as never).previewPage({ url: galleryUrl, page: 0 })
    await expect(preview).rejects.toMatchObject({ code: 'REMOTE_RESPONSE_INVALID', recoverable: true })
  })

  it.each([
    ['missing dimensions', ordinaryThumbnail(1, undefined, '')],
    ['missing interior ordinal', ordinaryThumbnail(1) + ordinaryThumbnail(3)],
    [
      'orphan interior thumbnail container',
      ordinaryThumbnail(1) +
        '<div class="gdtl"><img src="https://ehgt.org/t/orphan.jpg" width="10" height="10"></div>' +
        ordinaryThumbnail(3)
    ],
    ['malformed source href', '<div class="gdtl"><a href="/s/token/123-x"><img src="https://ehgt.org/t/a.jpg" width="10" height="10"></a></div>'],
    [
      'conflicting duplicate ordinal',
      ordinaryThumbnail(1, 'https://ehgt.org/t/a.jpg') + ordinaryThumbnail(1, 'https://ehgt.org/t/b.jpg')
    ],
    ['invalid positive sprite offset', spriteThumbnail(1, '20px -30px')],
    ['unsupported percentage sprite offset', spriteThumbnail(1, '-20% 0')]
  ])('fails the whole page instead of presenting malformed partial output: %s', async (_label, body) => {
    const http = { text: vi.fn(async () => pageHtml(body, { total: 3 })) }
    await expect(new EHentaiProvider(http as never).previewPage({ url: galleryUrl, page: 0 })).rejects.toMatchObject({
      code: 'REMOTE_RESPONSE_INVALID',
      recoverable: true
    })
  })

  it('bounds input pages, URLs, totals, and per-page output', async () => {
    const provider = new EHentaiProvider({ text: vi.fn() } as never)
    for (const page of [-1, 0.5, 500]) {
      await expect(provider.previewPage({ url: galleryUrl, page })).rejects.toMatchObject({ code: 'INVALID_URL' })
    }
    await expect(provider.previewPage({ url: `https://e-hentai.org/g/123/${'x'.repeat(2_100)}/`, page: 0 })).rejects.toMatchObject(
      { code: 'INVALID_URL' }
    )

    const oversized = Array.from({ length: 201 }, (_, index) => ordinaryThumbnail(index + 1)).join('')
    const outputProvider = new EHentaiProvider({ text: vi.fn(async () => pageHtml(oversized)) } as never)
    await expect(outputProvider.previewPage({ url: galleryUrl, page: 0 })).rejects.toMatchObject({
      code: 'REMOTE_RESPONSE_INVALID'
    })

    const badTotal = new EHentaiProvider({
      text: vi.fn(async () => pageHtml(ordinaryThumbnail(2), { total: 1 }))
    } as never)
    await expect(badTotal.previewPage({ url: galleryUrl, page: 0 })).rejects.toMatchObject({
      code: 'REMOTE_RESPONSE_INVALID'
    })

    const oversizedTotal = new EHentaiProvider({
      text: vi.fn(async () => pageHtml(ordinaryThumbnail(1)).replace('</div><div id="gdt">', '</div><div>1,000,001 pages</div><div id="gdt">'))
    } as never)
    await expect(oversizedTotal.previewPage({ url: galleryUrl, page: 0 })).rejects.toMatchObject({
      code: 'REMOTE_RESPONSE_INVALID'
    })
  })

  it.each([
    ['missing next page before the declared end', pageHtml(ordinaryThumbnail(1), { total: 2 })],
    [
      'next page after the declared end',
      pageHtml(ordinaryThumbnail(1), { total: 1, next: '/g/123/gallerytoken/?p=1' })
    ]
  ])('rejects contradictory pagination: %s', async (_label, html) => {
    const provider = new EHentaiProvider({ text: vi.fn(async () => html) } as never)
    await expect(provider.previewPage({ url: galleryUrl, page: 0 })).rejects.toMatchObject({
      code: 'REMOTE_RESPONSE_INVALID',
      recoverable: true
    })
  })

  it('classifies an HTTP 200 throttle page from inside the governed operation', async () => {
    const http = { text: vi.fn(async () => '<html>Your IP address has been temporarily banned for excessive pageloads.</html>') }
    const operationErrors: unknown[] = []
    const resolveRequestSpy = vi.fn()
    const runResolveRequest = async <T>(operation: () => Promise<T>) => {
      resolveRequestSpy()
      try {
        return await operation()
      } catch (error) {
        operationErrors.push(error)
        throw error
      }
    }

    await expect(
      new EHentaiProvider(http as never).previewPage({ url: galleryUrl, page: 0 }, { runResolveRequest })
    ).rejects.toMatchObject({
      code: 'REMOTE_RATE_LIMITED',
      recoverable: true,
      retryAfterMs: 30_000,
      stage: 'SOURCE_PAGE'
    } satisfies Partial<ArchiveError>)
    expect(operationErrors).toHaveLength(1)
    expect(operationErrors[0]).toMatchObject({ code: 'REMOTE_RATE_LIMITED' })
    expect(resolveRequestSpy).toHaveBeenCalledOnce()
  })

  it('does not mistake ordinary gallery title or text for an HTTP 200 throttle page', async () => {
    const html = pageHtml(ordinaryThumbnail(1), {
      total: 1,
      title: 'A story about temporarily banned automated access'
    })
    const result = await new EHentaiProvider({ text: vi.fn(async () => html) } as never).previewPage({
      url: galleryUrl,
      page: 0
    })
    expect(result.title).toContain('temporarily banned')
    expect(result.items).toHaveLength(1)
  })
})
