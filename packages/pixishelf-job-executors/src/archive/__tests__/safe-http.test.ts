import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EHentaiProvider } from '../providers/e-hentai.js'

const { lookupMock, requestMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  requestMock: vi.fn()
}))

vi.mock('node:dns/promises', () => ({
  default: { lookup: lookupMock }
}))

vi.mock('node:https', async () => {
  const actual = await vi.importActual<typeof import('node:https')>('node:https')
  return {
    ...actual,
    default: { ...actual, request: requestMock },
    request: requestMock
  }
})

import {
  assertSuccessStatus,
  assertSafeResolvedAddresses,
  destroyArchiveConnectionsWithoutUnhandledErrors,
  resolveArchiveProxyUrl,
  SafeHttpClient
} from '../safe-http.js'

class SyntheticConnection extends EventEmitter {
  constructor(private readonly onDestroy?: () => void) {
    super()
  }

  destroy(error?: Error): this {
    this.onDestroy?.()
    if (error) this.emit('error', error)
    return this
  }
}

const sourcePageUrl = 'https://e-hentai.org/s/key/1-1'
const originalUrl = 'https://e-hentai.org/fullimg/1/key/1/source'
const originalItem = { index: 0, sourcePageUrl, locator: {}, expectedFilename: '0001' }

function mockOriginalRedirects(hops: readonly string[], contentType = 'image/png') {
  lookupMock.mockResolvedValue([{ address: '1.1.1.1', family: 4 }])
  const sent: Array<{ url: string; cookie: string | undefined }> = []
  requestMock.mockImplementation(
    (target: URL, options: { headers: Record<string, string> }, callback: (response: unknown) => void) => {
      const url = target.toString()
      const index = hops.indexOf(url)
      expect(index).toBeGreaterThanOrEqual(0)
      sent.push({ url, cookie: options.headers.cookie })
      const location = hops[index + 1]
      return Object.assign(new EventEmitter(), {
        setTimeout: vi.fn(),
        end: () =>
          queueMicrotask(() =>
            callback(
              Object.assign(Readable.from([]), {
                statusCode: location ? 302 : 200,
                headers: location ? { location } : { 'content-type': contentType }
              })
            )
          )
      })
    }
  )
  const client = new SafeHttpClient(['e-hentai.org', 'hath.network', 'ehgt.org'], { ARCHIVE_HTTPS_PROXY: '' })
  return {
    sent,
    provider: (cookie: string | null) =>
      new EHentaiProvider(
        {
          text: async () => `<a href="${originalUrl}">Download original 2 x 3 100 B</a>`,
          request: client.request.bind(client),
          json: client.json.bind(client)
        },
        { getCookie: async () => cookie }
      )
  }
}

describe('archive safe HTTP network policy', () => {
  it.each([null, 'fixture=secret'])('requests the original and recomputes per-hop credentials: %s', async (cookie) => {
    const hops = [
      originalUrl,
      'https://api.e-hentai.org/fullimg.php?gid=1',
      'https://node.hath.network/h/image',
      'https://ehgt.org/thumbnail.jpg',
      'https://e-hentai.org/g/1/token/',
      'https://e-hentai.org/fullimg.php?gid=1'
    ]
    const { sent, provider } = mockOriginalRedirects(hops)
    const response = await provider(cookie).openMedia(originalItem, { quality: 'ORIGINAL' })
    expect(response).toMatchObject({
      downloadUrl: hops.at(-1),
      quality: 'ORIGINAL',
      ehDelivery: {
        requestedQuality: 'ORIGINAL',
        originalResponse: true,
        originalClaim: { width: 2, height: 3, minBytes: 100, maxBytes: 100 }
      }
    })
    expect(sent.map((hop) => hop.url)).toEqual(hops)
    expect(sent.map((hop) => hop.cookie)).toEqual([
      cookie ?? undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      cookie ?? undefined
    ])
    requestMock.mockReset()
  })

  it.each([
    [null, '配置 EH Cookie'],
    ['fixture=secret', '更新 EH Cookie']
  ])('pauses an explicit EH login redirect without requesting the login page', async (cookie, guidance) => {
    const loginUrl = 'https://forums.e-hentai.org/index.php?act=Login&CODE=00'
    const { sent, provider } = mockOriginalRedirects([originalUrl, loginUrl])
    await expect(provider(cookie).openMedia(originalItem, { quality: 'ORIGINAL' })).rejects.toMatchObject({
      code: 'ORIGINAL_UNAVAILABLE',
      message: expect.stringContaining(guidance),
      pause: true,
      stage: 'MEDIA_REQUEST',
      remoteHost: 'forums.e-hentai.org:443',
      decisionCode: null
    })
    expect(sent).toEqual([{ url: originalUrl, cookie: cookie ?? undefined }])
    requestMock.mockReset()
  })

  it('does not infer login from an unrelated forum page with an HTML response', async () => {
    const profile = 'https://forums.e-hentai.org/index.php?showuser=42'
    const { sent, provider } = mockOriginalRedirects([originalUrl, profile], 'text/html')
    await expect(provider('fixture=secret').openMedia(originalItem, { quality: 'ORIGINAL' })).resolves.toMatchObject({
      downloadUrl: profile,
      mimeType: 'text/html',
      ehDelivery: { originalResponse: false }
    })
    expect(sent).toEqual([
      { url: originalUrl, cookie: 'fixture=secret' },
      { url: profile, cookie: undefined }
    ])
    requestMock.mockReset()
  })

  it('still rejects an out-of-policy host with a login-shaped path', async () => {
    const lookalike = 'https://forums.e-hentai.org.example.test/index.php?act=Login&CODE=00'
    const { sent, provider } = mockOriginalRedirects([originalUrl, lookalike])
    await expect(provider('fixture=secret').openMedia(originalItem, { quality: 'ORIGINAL' })).rejects.toMatchObject({
      code: 'SSRF_BLOCKED'
    })
    expect(sent).toEqual([{ url: originalUrl, cookie: 'fixture=secret' }])
    requestMock.mockReset()
  })

  it('retains HTTP status and host for typed diagnostics', () => {
    expect(() =>
      assertSuccessStatus({
        status: 502,
        headers: {},
        url: 'https://example.test/private?token=secret',
        stream: { resume: vi.fn() } as never
      })
    ).toThrowError(expect.objectContaining({ httpStatus: 502, remoteHost: 'example.test:443' }))
  })
  it('preserves the root network errno through classification', async () => {
    const error = Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' })
    lookupMock.mockRejectedValueOnce(error)
    const client = new SafeHttpClient(['example.test'], { ARCHIVE_HTTPS_PROXY: '' })
    await expect(client.request('https://example.test/media')).rejects.toMatchObject({
      code: 'REMOTE_RESPONSE_INVALID',
      cause: { cause: { cause: { code: 'ENOTFOUND' } } }
    })
  })

  it('allows Mihomo IPv4 and IPv6 fake IPs only when an HTTP proxy is configured', () => {
    const proxy = resolveArchiveProxyUrl(new URL('https://e-hentai.org/'), {
      ARCHIVE_HTTPS_PROXY: 'http://127.0.0.1:7890'
    })
    const fakeIps = [
      { address: '198.18.0.61', family: 4 },
      { address: 'fdfe:dcba:9876::3c', family: 6 }
    ]

    expect(() => assertSafeResolvedAddresses(fakeIps, proxy)).not.toThrow()
    expect(() => assertSafeResolvedAddresses(fakeIps, null)).toThrowError(
      expect.objectContaining({ code: 'SSRF_BLOCKED' })
    )
    expect(() => assertSafeResolvedAddresses([{ address: 'fdfe:dcba:9876:1::1', family: 6 }], proxy)).toThrowError(
      expect.objectContaining({ code: 'SSRF_BLOCKED' })
    )
  })
})

describe('archive safe HTTP cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lookupMock.mockResolvedValue([{ address: '1.1.1.1', family: 4 }])
  })

  it('rejects an already-aborted direct request before opening a socket', async () => {
    const controller = new AbortController()
    controller.abort()
    const client = new SafeHttpClient(['example.test'], { ARCHIVE_HTTPS_PROXY: '' })

    await expect(
      client.request('https://example.test/media.webp', { signal: controller.signal })
    ).rejects.toMatchObject({ code: 'CANCELLED', recoverable: true })
    expect(requestMock).not.toHaveBeenCalled()
  })
  it('does not open a socket when the deadline expires during DNS resolution', async () => {
    const controller = new AbortController()
    let finish!: (value: unknown) => void
    lookupMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const client = new SafeHttpClient(['example.test'], { ARCHIVE_HTTPS_PROXY: '' })
    const request = client.request('https://example.test/media.webp', { signal: controller.signal })
    controller.abort()
    finish([{ address: '1.1.1.1', family: 4 }])
    await expect(request).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(requestMock).not.toHaveBeenCalled()
  })
})

describe('archive safe HTTP connection cleanup', () => {
  it('absorbs a cleanup error after the primary once listener has been consumed', () => {
    const connection = new SyntheticConnection()
    connection.once('error', () => undefined)
    connection.emit('error', Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }))

    expect(() =>
      destroyArchiveConnectionsWithoutUnhandledErrors([{ connection, error: new Error('classified failure') }])
    ).not.toThrow()
  })

  it('guards sibling connections before destroying any connection', () => {
    const sibling = new SyntheticConnection()
    const primary = new SyntheticConnection(() => sibling.emit('error', new Error('propagated reset')))

    expect(() =>
      destroyArchiveConnectionsWithoutUnhandledErrors([
        { connection: primary, error: new Error('primary failure') },
        { connection: sibling }
      ])
    ).not.toThrow()
  })
})
