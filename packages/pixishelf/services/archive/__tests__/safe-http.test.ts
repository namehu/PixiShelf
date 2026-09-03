import http from 'node:http'
import net from 'node:net'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  assertSafeResolvedAddresses,
  assertSuccessStatus,
  createPinnedLookup,
  isPublicNetworkAddress,
  readResponseBuffer,
  resolveArchiveProxyUrl,
  SafeHttpClient,
  validateArchiveUrl
} from '../safe-http'

describe('archive safe HTTP network policy', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '192.0.2.1',
    '198.18.0.53',
    '198.51.100.2',
    '203.0.113.3',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1'
  ])('rejects non-public address %s', (address) => {
    expect(isPublicNetworkAddress(address)).toBe(false)
  })

  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])('accepts public address %s', (address) => {
    expect(isPublicNetworkAddress(address)).toBe(true)
  })

  it('accepts only credential-free HTTPS URLs on an exact allowed suffix', () => {
    expect(validateArchiveUrl('https://api.e-hentai.org/api.php', ['e-hentai.org']).hostname).toBe('api.e-hentai.org')
    expect(() => validateArchiveUrl('http://e-hentai.org/', ['e-hentai.org'])).toThrowError(
      expect.objectContaining({ code: 'SSRF_BLOCKED' })
    )
    expect(() => validateArchiveUrl('https://e-hentai.org.evil.test/', ['e-hentai.org'])).toThrowError(
      expect.objectContaining({ code: 'SSRF_BLOCKED' })
    )
    expect(() => validateArchiveUrl('https://user:secret@e-hentai.org/', ['e-hentai.org'])).toThrowError(
      expect.objectContaining({ code: 'SSRF_BLOCKED', message: '链接不能包含账号或密码' })
    )
  })

  it('allows non-standard HTTPS ports only for an explicitly configured host suffix', () => {
    expect(
      validateArchiveUrl(
        'https://node.hath.network:8472/media.webp',
        ['e-hentai.org', 'hath.network'],
        ['hath.network']
      ).port
    ).toBe('8472')
    expect(() =>
      validateArchiveUrl('https://e-hentai.org:8472/', ['e-hentai.org', 'hath.network'], ['hath.network'])
    ).toThrowError(expect.objectContaining({ code: 'SSRF_BLOCKED', message: '链接端口不在归档来源站点的允许列表中' }))
    expect(() =>
      validateArchiveUrl('https://node.hath.network.evil.test:8472/', ['hath.network'], ['hath.network'])
    ).toThrowError(expect.objectContaining({ code: 'SSRF_BLOCKED', message: '链接主机不在归档来源站点的允许列表中' }))
  })

  it('routes Clash and Mihomo fake IPs only through an explicitly configured HTTP proxy', () => {
    const target = new URL('https://e-hentai.org/g/123/token/')
    const proxy = resolveArchiveProxyUrl(target, { HTTPS_PROXY: 'http://127.0.0.1:7890' })
    const fakeIps = [
      { address: '198.18.0.53', family: 4 },
      { address: 'fdfe:dcba:9876::3c', family: 6 }
    ]

    expect(proxy?.origin).toBe('http://127.0.0.1:7890')
    expect(() => assertSafeResolvedAddresses(fakeIps, proxy)).not.toThrow()
    expect(() => assertSafeResolvedAddresses(fakeIps, null)).toThrowError(
      expect.objectContaining({ code: 'SSRF_BLOCKED' })
    )
    expect(() => assertSafeResolvedAddresses([{ address: '127.0.0.1', family: 4 }], proxy)).toThrowError(
      expect.objectContaining({ code: 'SSRF_BLOCKED' })
    )
    expect(() => assertSafeResolvedAddresses([{ address: 'fdfe:dcba:9876:1::1', family: 6 }], proxy)).toThrowError(
      expect.objectContaining({ code: 'SSRF_BLOCKED' })
    )
  })

  it('returns an address array when Node requests all addresses for automatic family selection', async () => {
    const selected = { address: '1.1.1.1', family: 4 }
    const lookup = createPinnedLookup(selected)

    await expect(
      new Promise((resolve, reject) => {
        lookup('e-hentai.org', { all: true }, (error, addresses) => {
          if (error) reject(error)
          else resolve(addresses)
        })
      })
    ).resolves.toEqual([selected])
  })

  it('honors an archive proxy override and NO_PROXY for standard proxy variables', () => {
    const target = new URL('https://api.e-hentai.org/api.php')

    expect(
      resolveArchiveProxyUrl(target, {
        ARCHIVE_HTTPS_PROXY: 'http://127.0.0.1:7891',
        HTTPS_PROXY: 'http://127.0.0.1:7890',
        NO_PROXY: 'e-hentai.org'
      })?.port
    ).toBe('7891')
    expect(
      resolveArchiveProxyUrl(target, {
        HTTPS_PROXY: 'http://127.0.0.1:7890',
        NO_PROXY: '.e-hentai.org'
      })
    ).toBeNull()
  })

  it('rejects malformed proxy configuration without retaining credentials', () => {
    let thrown: unknown
    try {
      resolveArchiveProxyUrl(new URL('https://e-hentai.org/'), {
        ARCHIVE_HTTPS_PROXY: 'http://user:do-not-log@['
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({ code: 'INTERNAL', message: '归档代理地址格式无效' })
    expect(thrown).not.toHaveProperty('cause')
    expect(String(thrown)).not.toContain('do-not-log')
  })

  it('rejects proxy URL credentials without echoing them', () => {
    expect(() =>
      resolveArchiveProxyUrl(new URL('https://e-hentai.org/'), {
        ARCHIVE_HTTPS_PROXY: 'http://proxy-user:do-not-log@127.0.0.1:7890'
      })
    ).toThrowError(expect.objectContaining({ code: 'INTERNAL', message: '归档代理暂不支持 URL 中的账号或密码' }))
  })

  it('keeps CONNECT tunnels open for legacy HTTP proxies', async () => {
    const proxy = await createRejectingProxy()
    try {
      const client = new SafeHttpClient(['198.18.0.53'], { ARCHIVE_HTTPS_PROXY: proxy.url })

      await expect(client.request('https://198.18.0.53/')).rejects.toMatchObject({
        code: 'REMOTE_RESPONSE_INVALID'
      })
      await expect(proxy.requestHeaders).resolves.toMatchObject({
        connection: 'keep-alive',
        'proxy-connection': 'keep-alive'
      })
    } finally {
      await proxy.close()
    }
  })

  it('times out a stalled proxy CONNECT and closes its socket', async () => {
    const proxy = await createHangingProxy()
    try {
      const client = new SafeHttpClient(['198.18.0.53'], { ARCHIVE_HTTPS_PROXY: proxy.url })
      const startedAt = Date.now()

      await expect(client.request('https://198.18.0.53/', { timeoutMs: 100 })).rejects.toMatchObject({
        code: 'REMOTE_RESPONSE_INVALID',
        message: '远端请求超时'
      })
      await expect(closesWithin(proxy.socketClosed, 1_000)).resolves.toBe(true)
      expect(Date.now() - startedAt).toBeLessThan(1_000)
    } finally {
      await proxy.close()
    }
  })

  it('aborts a stalled proxy CONNECT and closes its socket', async () => {
    const proxy = await createHangingProxy()
    try {
      const controller = new AbortController()
      const client = new SafeHttpClient(['198.18.0.53'], { ARCHIVE_HTTPS_PROXY: proxy.url })
      const request = client.request('https://198.18.0.53/', {
        signal: controller.signal,
        timeoutMs: 5_000
      })
      await proxy.connected
      controller.abort()

      await expect(request).rejects.toMatchObject({ code: 'CANCELLED' })
      await expect(closesWithin(proxy.socketClosed, 1_000)).resolves.toBe(true)
    } finally {
      await proxy.close()
    }
  })

  it.each([
    [403, 'REMOTE_FORBIDDEN'],
    [429, 'REMOTE_RATE_LIMITED'],
    [509, 'REMOTE_QUOTA_EXCEEDED']
  ])('classifies HTTP %s as a paused response', (status, code) => {
    expect(() =>
      assertSuccessStatus({
        status: Number(status),
        headers: {},
        stream: Readable.from([]) as unknown as IncomingMessage,
        url: 'https://example.test'
      })
    ).toThrowError(expect.objectContaining({ code, pause: true }))
  })

  it.each([
    [404, 'REMOTE_NOT_FOUND', false],
    [503, 'REMOTE_RESPONSE_INVALID', true]
  ])('classifies HTTP %s with item-level retry semantics and safe diagnostics', (status, code, recoverable) => {
    expect(() =>
      assertSuccessStatus({
        status: Number(status),
        headers: {},
        stream: Readable.from([]) as unknown as IncomingMessage,
        url: 'https://node.hath.network:2333/media?temporary=secret'
      })
    ).toThrowError(
      expect.objectContaining({
        code,
        recoverable,
        stage: 'MEDIA_REQUEST',
        remoteHost: 'node.hath.network:2333'
      })
    )
  })

  it('rejects a buffered response that exceeds its configured limit', async () => {
    await expect(
      readResponseBuffer(
        {
          status: 200,
          headers: {},
          stream: Readable.from([Buffer.alloc(5)]) as unknown as IncomingMessage,
          url: 'https://example.test'
        },
        4
      )
    ).rejects.toMatchObject({ code: 'DOWNLOAD_TOO_LARGE' })
  })
})

async function createHangingProxy(): Promise<{
  url: string
  connected: Promise<void>
  socketClosed: Promise<void>
  close: () => Promise<void>
}> {
  const sockets = new Set<Socket>()
  let markConnected!: () => void
  let markSocketClosed!: () => void
  const connected = new Promise<void>((resolve) => {
    markConnected = resolve
  })
  const socketClosed = new Promise<void>((resolve) => {
    markSocketClosed = resolve
  })
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.resume()
    markConnected()
    socket.once('close', () => {
      sockets.delete(socket)
      markSocketClosed()
    })
  })
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      resolve()
    })
  })
  const address = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${address.port}`,
    connected,
    socketClosed,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  }
}

async function createRejectingProxy(): Promise<{
  url: string
  requestHeaders: Promise<IncomingHttpHeaders>
  close: () => Promise<void>
}> {
  let captureHeaders!: (headers: IncomingHttpHeaders) => void
  const requestHeaders = new Promise<IncomingHttpHeaders>((resolve) => {
    captureHeaders = resolve
  })
  const server = http.createServer()
  server.on('connect', (request, socket) => {
    captureHeaders(request.headers)
    socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
  })
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      resolve()
    })
  })
  const address = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${address.port}`,
    requestHeaders,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  }
}

async function closesWithin(closed: Promise<void>, timeoutMs: number): Promise<boolean> {
  return Promise.race([closed.then(() => true), delay(timeoutMs).then(() => false)])
}
