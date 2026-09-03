import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  compareArchiveUploaderMetadata,
  createArchiveUploaderComparisonSnapshot,
  EHentaiProvider,
  hashArchiveUploaderComparisonMetadata
} from '../providers/e-hentai.js'

const comparableMetadata = {
  gid: '123',
  titles: { display: 'Gallery', aliases: ['Alias A', 'Alias B'] },
  category: 'Doujinshi',
  uploader: 'alice',
  thumbnailUrl: 'https://ehgt.org/old.jpg',
  postedAt: '2026-09-01T00:00:00.000Z',
  fileCount: 1,
  fileSize: 10,
  rating: '4.5',
  expunged: false,
  tags: [
    { namespace: 'artist', name: 'Artist A' },
    { namespace: 'group', name: 'Group A' }
  ],
  relationships: [
    { type: 'REPLACES', direction: 'OUTBOUND', providerKey: 'e-hentai', externalId: '100' },
    { type: 'REPLACES', direction: 'INBOUND', providerKey: 'e-hentai', externalId: '200' }
  ]
}

describe('archive uploader stable metadata comparison', () => {
  it('excludes rating and thumbnail URL and normalizes set ordering', () => {
    const reordered = {
      ...comparableMetadata,
      titles: { ...comparableMetadata.titles, aliases: [...comparableMetadata.titles.aliases].reverse() },
      thumbnailUrl: 'https://ehgt.org/new.jpg',
      rating: '1.0',
      tags: [...comparableMetadata.tags].reverse(),
      relationships: [...comparableMetadata.relationships].reverse()
    }

    expect(createArchiveUploaderComparisonSnapshot(reordered)).toEqual(
      createArchiveUploaderComparisonSnapshot(comparableMetadata)
    )
    expect(hashArchiveUploaderComparisonMetadata(reordered)).toBe(
      hashArchiveUploaderComparisonMetadata(comparableMetadata)
    )
    expect(compareArchiveUploaderMetadata(comparableMetadata, reordered)?.changeReasons).toEqual([])
  })

  it('returns a reason for every stable field that changed', () => {
    const changed = {
      ...comparableMetadata,
      titles: { display: 'Changed gallery', aliases: [] },
      category: 'Manga',
      uploader: 'bob',
      postedAt: '2026-09-02T00:00:00.000Z',
      fileCount: 2,
      fileSize: 20,
      expunged: true,
      tags: [{ namespace: 'artist', name: 'Artist B' }],
      relationships: [{ type: 'REPLACES', direction: 'OUTBOUND', providerKey: 'e-hentai', externalId: '101' }]
    }

    expect(compareArchiveUploaderMetadata(comparableMetadata, changed)?.changeReasons).toEqual([
      { field: 'titles', message: '标题或别名变化' },
      { field: 'category', message: '分类 Doujinshi → Manga' },
      { field: 'uploader', message: '上传者 alice → bob' },
      { field: 'postedAt', message: '发布时间 2026-09-01T00:00:00.000Z → 2026-09-02T00:00:00.000Z' },
      { field: 'fileCount', message: '页数 1 → 2' },
      { field: 'fileSize', message: '文件大小 10 → 20' },
      { field: 'expunged', message: '下架状态 否 → 是' },
      { field: 'tags', message: '标签变化' },
      { field: 'relationships', message: '版本关系变化' }
    ])
  })

  it('rejects incomplete historical metadata as not comparable', () => {
    expect(createArchiveUploaderComparisonSnapshot({ titles: comparableMetadata.titles })).toBeNull()
    expect(compareArchiveUploaderMetadata({ titles: comparableMetadata.titles }, comparableMetadata)).toBeNull()
  })
})

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

  it('reports the source-page and media-response phases without exposing remote addresses in telemetry', async () => {
    const http = {
      text: vi.fn(async () => '<img id="img" src="https://cdn.hath.network/image.jpg">'),
      request: vi.fn(async () => ({
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': '3' },
        stream: Readable.from(Buffer.from('img')),
        url: 'https://cdn.hath.network/image.jpg'
      }))
    }
    const phases: string[] = []
    const provider = new EHentaiProvider(http as never)

    const remote = await provider.openMedia(
      {
        index: 0,
        sourcePageUrl: 'https://e-hentai.org/s/pagetoken/123-1',
        locator: {},
        expectedFilename: '0001'
      },
      {
        quality: 'DISPLAY',
        onPhase: (phase) => phases.push(phase),
        runDownloadRequest: (operation) => operation(),
        runDownloadStreamRequest: (operation) => operation()
      }
    )

    expect(phases).toEqual(['RESOLVING_SOURCE_PAGE', 'WAITING_MEDIA_RESPONSE'])
    expect(remote).toMatchObject({ contentLength: 3, quality: 'DISPLAY' })
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
