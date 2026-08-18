import { describe, expect, it, vi } from 'vitest'
import { EHentaiProvider } from '../providers/e-hentai.js'

describe('EHentaiProvider resolution', () => {
  it('resolves all gallery pages in order and governs every remote request', async () => {
    const http = {
      json: vi.fn(async () => ({
        gmetadata: [{ gid: 123, token: 'gallerytoken', title: 'Gallery', filecount: '2', tags: [] }]
      })),
      text: vi.fn(async (url: string) =>
        url.includes('p=1')
          ? '<a href="https://e-hentai.org/s/secondtoken/123-2">second</a>'
          : '<a href="https://e-hentai.org/s/firsttoken/123-1">first</a>'
      )
    }
    const requestSpy = vi.fn()
    const runResolveRequest = <T>(operation: () => Promise<T>) => {
      requestSpy()
      return operation()
    }

    const result = await new EHentaiProvider(http as never).resolve('https://e-hentai.org/g/123/gallerytoken/', {
      runResolveRequest
    })

    expect(result.media.map(({ sourcePageUrl }) => sourcePageUrl)).toEqual([
      'https://e-hentai.org/s/firsttoken/123-1',
      'https://e-hentai.org/s/secondtoken/123-2'
    ])
    expect(http.json).toHaveBeenCalledOnce()
    expect(http.text).toHaveBeenCalledTimes(2)
    expect(requestSpy).toHaveBeenCalledTimes(3)
  })

  it('cooperatively aborts an in-flight later page and does not request another page', async () => {
    const controller = new AbortController()
    const http = {
      json: vi.fn(async () => ({
        gmetadata: [{ gid: 123, token: 'gallerytoken', title: 'Gallery', filecount: '3', tags: [] }]
      })),
      text: vi.fn(async (url: string, options: { signal?: AbortSignal }) => {
        if (!url.includes('p=1')) {
          return '<a href="https://e-hentai.org/s/firsttoken/123-1">first</a>'
        }
        return new Promise<string>((_resolve, reject) => {
          const rejectAbort = () => reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'))
          if (options.signal?.aborted) rejectAbort()
          else options.signal?.addEventListener('abort', rejectAbort, { once: true })
        })
      })
    }
    const provider = new EHentaiProvider(http as never)
    const resolution = provider.resolve('https://e-hentai.org/g/123/gallerytoken/', { signal: controller.signal })
    await vi.waitFor(() => expect(http.text).toHaveBeenCalledTimes(2))

    controller.abort(new DOMException('Aborted', 'AbortError'))

    await expect(resolution).rejects.toMatchObject({ code: 'CANCELLED', recoverable: true })
    expect(http.text).toHaveBeenCalledTimes(2)
  })
})
