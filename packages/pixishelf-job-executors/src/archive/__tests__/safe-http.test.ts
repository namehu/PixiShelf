import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { assertSafeResolvedAddresses, resolveArchiveProxyUrl, SafeHttpClient } from '../safe-http.js'

describe('archive safe HTTP network policy', () => {
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
})
