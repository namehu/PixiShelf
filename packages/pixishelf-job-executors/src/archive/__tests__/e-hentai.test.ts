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

describe('EHentaiProvider uploader scan', () => {
  it('keeps a mid-page cursor and continues without repeating the previous gallery', async () => {
    const http = {
      text: vi.fn(async () =>
        [
          '<a href="https://e-hentai.org/g/300/token300/">Gallery 300</a>',
          '<a href="https://e-hentai.org/g/200/token200/">Gallery 200</a>'
        ].join('')
      ),
      json: vi.fn(async (_url: string, options: { body: string }) => {
        const request = JSON.parse(options.body) as { gidlist: Array<[number, string]> }
        return {
          gmetadata: request.gidlist.map(([gid, token]) => ({
            gid,
            token,
            title: `Gallery ${gid}`,
            uploader: 'alice',
            filecount: '1',
            tags: []
          }))
        }
      })
    }
    const provider = new EHentaiProvider(http as never)
    const first = await provider.scanUploader({
      identityKind: 'NAME',
      identityValue: 'Alice',
      cursor: null,
      stopAtExternalId: null,
      limit: 1
    })
    const second = await provider.scanUploader({
      identityKind: 'NAME',
      identityValue: 'Alice',
      cursor: first.nextCursor,
      stopAtExternalId: null,
      limit: 1
    })

    expect(first.items.map(({ externalId }) => externalId)).toEqual(['300'])
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(second.items.map(({ externalId }) => externalId)).toEqual(['200'])
    expect(second.nextCursor).toBeNull()
    expect(http.text).toHaveBeenCalledTimes(2)
  })

  it('stops before the known latest gallery and governs both search and metadata requests', async () => {
    const http = {
      text: vi.fn(async () =>
        [
          '<a href="https://e-hentai.org/g/300/token300/">Gallery 300</a>',
          '<a href="https://e-hentai.org/g/200/token200/">Gallery 200</a>',
          '<a href="https://e-hentai.org/g/100/token100/">Gallery 100</a>'
        ].join('')
      ),
      json: vi.fn(async () => ({
        gmetadata: [{ gid: 300, token: 'token300', title: 'Gallery 300', uploader: 'alice', filecount: '1', tags: [] }]
      }))
    }
    const searchRequestSpy = vi.fn()
    const runSearchRequest = <T>(operation: () => Promise<T>) => {
      searchRequestSpy()
      return operation()
    }

    const result = await new EHentaiProvider(http as never).scanUploader(
      {
        identityKind: 'NAME',
        identityValue: 'alice',
        cursor: null,
        stopAtExternalId: '200',
        limit: 100
      },
      { runSearchRequest }
    )

    expect(result.items.map(({ externalId }) => externalId)).toEqual(['300'])
    expect(result.reachedStop).toBe(true)
    expect(result.nextCursor).toBeNull()
    expect(searchRequestSpy).toHaveBeenCalledTimes(2)
  })

  it('rejects an unrecognized search response instead of treating it as an empty result', async () => {
    const http = { text: vi.fn(async () => '<html><body>challenge</body></html>'), json: vi.fn() }

    await expect(
      new EHentaiProvider(http as never).scanUploader({
        identityKind: 'UID',
        identityValue: '123',
        cursor: null,
        stopAtExternalId: null,
        limit: 100
      })
    ).rejects.toMatchObject({ code: 'REMOTE_RESPONSE_INVALID', stage: 'UPLOADER_SEARCH' })
    expect(http.json).not.toHaveBeenCalled()
  })
})
