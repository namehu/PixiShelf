import { describe, expect, it, vi } from 'vitest'
import {
  ArchivePreviewStore,
  getArchivePreviewImage,
  getArchivePreviewPage,
  isSafePreviewImageUrl,
  openArchivePreview,
  reloadArchivePreview,
  type ArchivePreviewServiceDependencies
} from '../archive-preview-service'

const canonicalUrl = 'https://e-hentai.org/g/123/token/'
function harness(options: { now?: () => number; image?: () => Promise<{ ordinal: number; url: string }> } = {}) {
  const previewImage = vi.fn(
    options.image ?? (async () => ({ ordinal: 0, url: 'https://a.hath.network/h/token/page.jpg?key=signed' }))
  )
  const previewPage = vi.fn(async ({ page }: { page: number }) => ({
    providerKey: 'e-hentai',
    externalId: '123',
    canonicalUrl,
    title: 'Gallery',
    total: 2,
    page,
    items: [
      {
        ordinal: page,
        sourcePageUrl: `https://e-hentai.org/s/hash/123-${page + 1}`,
        url: 'https://ehgt.org/t.jpg',
        width: 100,
        height: 150
      }
    ],
    nextPage: page === 0 ? 1 : null
  }))
  let id = 0
  const provider = { key: 'e-hentai', previewPage, previewImage }
  const dependencies = {
    providers: { getForUrl: () => provider },
    store: new ArchivePreviewStore({ now: options.now }),
    createId: () => `preview-${++id}`
  } as unknown as ArchivePreviewServiceDependencies
  const open = (userId = 'owner') =>
    openArchivePreview({ source: { kind: 'url', url: canonicalUrl } }, userId, dependencies)
  const image = (previewId: string, ordinal = 0, refresh = false, userId = 'owner') =>
    getArchivePreviewImage({ previewId, ordinal, refresh }, userId, dependencies)
  return { open, image, dependencies, previewImage, previewPage }
}

describe('display image preview', () => {
  it('keeps locators private and refuses foreign sessions or unloaded ordinals before IO', async () => {
    const h = harness()
    const opened = await h.open()
    expect(JSON.stringify(opened)).not.toContain('/s/')
    expect(JSON.stringify(opened)).not.toContain('locators')
    await expect(h.image(opened.previewId, 0, false, 'other')).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    await expect(h.image(opened.previewId, 1)).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(h.previewImage).not.toHaveBeenCalled()
    await expect(h.image(opened.previewId)).resolves.toEqual({
      ordinal: 0,
      url: 'https://a.hath.network/h/token/page.jpg?key=signed'
    })
    expect(h.previewImage).toHaveBeenCalledWith(
      { canonicalUrl, sourcePageUrl: 'https://e-hentai.org/s/hash/123-1', ordinal: 0 },
      expect.any(Object)
    )
  })

  it('shares results, expires after five minutes and refreshes only the requested image', async () => {
    let now = 0
    const h = harness({ now: () => now })
    const a = await h.open()
    const b = await h.open('second')
    await Promise.all([h.image(a.previewId), h.image(b.previewId, 0, false, 'second')])
    expect(h.previewImage).toHaveBeenCalledTimes(1)
    now += 5 * 60_000 + 1
    await h.image(a.previewId)
    expect(h.previewImage).toHaveBeenCalledTimes(2)
    await h.image(a.previewId, 0, true)
    expect(h.previewImage).toHaveBeenCalledTimes(3)
    expect(h.previewPage).toHaveBeenCalledTimes(1)
  })

  it('serializes pagination behind an image and ignores stale completion after reload', async () => {
    let finish!: (result: { ordinal: number; url: string }) => void
    const h = harness({
      image: () =>
        new Promise((resolve) => {
          finish = resolve
        })
    })
    const a = await h.open()
    const loading = h.image(a.previewId)
    await vi.waitFor(() => expect(h.previewImage).toHaveBeenCalledOnce())
    const next = getArchivePreviewPage({ previewId: a.previewId, page: 1 }, 'owner', h.dependencies)
    expect(h.previewPage).toHaveBeenCalledTimes(1)
    finish({ ordinal: 0, url: 'https://ehgt.org/large.jpg' })
    await loading
    await next
    expect(h.previewPage).toHaveBeenCalledTimes(2)
    const stale = h.image(a.previewId, 0, true)
    const rejected = expect(stale).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    await vi.waitFor(() => expect(h.previewImage).toHaveBeenCalledTimes(2))
    const reload = reloadArchivePreview({ previewId: a.previewId }, 'owner', h.dependencies)
    finish({ ordinal: 0, url: 'https://ehgt.org/stale.jpg' })
    await rejected
    await reload
  })

  it('does not cache failures or return the provider error locator', async () => {
    const h = harness()
    const a = await h.open()
    h.previewImage.mockRejectedValueOnce(new Error('https://e-hentai.org/s/secret/123-1'))
    await expect(h.image(a.previewId)).rejects.toMatchObject({ message: '无法读取原站缩略图，请稍后重试' })
    await h.image(a.previewId)
    expect(h.previewImage).toHaveBeenCalledTimes(2)
  })

  it('rejects mismatched image identities and unsafe provider URLs', async () => {
    const h = harness()
    const a = await h.open()
    h.previewImage.mockResolvedValueOnce({ ordinal: 1, url: 'https://ehgt.org/large.jpg' })
    await expect(h.image(a.previewId)).rejects.toMatchObject({ code: 'REMOTE_RESPONSE_INVALID' })
    h.previewImage.mockResolvedValueOnce({ ordinal: 0, url: 'https://attacker.test/large.jpg' })
    await expect(h.image(a.previewId)).rejects.toMatchObject({ code: 'REMOTE_RESPONSE_INVALID' })
  })

  it.each([
    'http://ehgt.org/a.jpg',
    'https://evil.test/a.jpg',
    'https://ehgt.org.evil.test/a.jpg',
    'https://user:password@ehgt.org/a.jpg',
    'https://ehgt.org:8080/a.jpg',
    'https://e-hentai.org/s/hash/a.jpg',
    'https://e-hentai.org/fullimg.php?x=1',
    'https://ehgt.org/a.jpg#secret'
  ])('rejects unsafe display address %s', (url) => {
    expect(isSafePreviewImageUrl(url)).toBe(false)
  })
})
