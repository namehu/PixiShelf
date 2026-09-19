import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { Duplex } from 'node:stream'
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fetchPixivArtistMetadata } from '../../pixiv-artist/client.ts'
import { storePixivArtistImage } from '../../pixiv-artist/storage.ts'
import { fetchPixivArtworkMetadata } from '../../pixiv-artwork/client.ts'
import { fetchPixivTagMetadata } from '../../pixiv-tag/client.ts'
import { storePixivTagImage } from '../../pixiv-tag/storage.ts'
import { createPixivFetchTransport, type PixivFetchTransport } from '../pixiv-fetch.ts'

const trust = vi.hoisted(() => ({ ca: '', directAttempts: 0 }))
// Trust only the ephemeral fixture certificate, keeping hostname and TLS verification enabled.
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>()
  return {
    ...actual,
    Agent: class {
      constructor() {
        trust.directAttempts += 1
        throw new Error('Direct networking is forbidden in this proxy-only fixture')
      }
    },
    ProxyAgent: class extends actual.ProxyAgent {
      constructor(uri: string) {
        super({ uri, requestTls: { ca: trust.ca }, proxyTls: { ca: trust.ca, servername: 'localhost' } })
      }
    }
  }
})

let fixtureRoot: string
let credentials: { key: string; cert: string }
let png: Buffer
beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'pixiv-proxy-integration-'))
  try {
    const keyPath = path.join(fixtureRoot, 'key.pem')
    const certPath = path.join(fixtureRoot, 'cert.pem')
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:www.pixiv.net,DNS:i.pximg.net,DNS:localhost,IP:127.0.0.1'
      ],
      { stdio: 'pipe' }
    )
    credentials = { key: await readFile(keyPath, 'utf8'), cert: await readFile(certPath, 'utf8') }
    trust.ca = credentials.cert
    png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#334455' } })
      .png()
      .toBuffer()
  } catch (error) {
    await rm(fixtureRoot, { recursive: true, force: true })
    throw error
  }
})
afterAll(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true })
})

async function listen(server: http.Server | https.Server) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return (server.address() as net.AddressInfo).port
}

async function startFixture(protocol: 'http' | 'https') {
  const sockets = new Set<Duplex>()
  const connects: string[] = []
  const requests: string[] = []
  let rejectConnect = false
  let notifySlow: (() => void) | undefined
  const slowRequest = new Promise<void>((resolve) => {
    notifySlow = resolve
  })
  const origin = https.createServer(credentials, (req, res) => {
    const pathname = new URL(req.url ?? '/', 'https://www.pixiv.net').pathname
    requests.push(pathname)
    if (pathname === '/slow') {
      notifySlow?.()
      return
    }
    if (pathname === '/stream') {
      res.writeHead(200)
      res.write('pending')
      return
    }
    if (pathname === '/redirect') {
      res.writeHead(302, { location: 'https://localhost/blocked' })
      res.end()
      return
    }
    if (pathname.endsWith('.png')) {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(png)
      return
    }
    let body: unknown = { message: 'fixture data' }
    if (pathname.startsWith('/ajax/user/'))
      body = {
        error: false,
        body: {
          userId: '123',
          name: 'Fixture artist',
          imageBig: 'https://i.pximg.net/avatar.png',
          background: { url: 'https://i.pximg.net/background.png' }
        }
      }
    if (pathname.startsWith('/ajax/illust/'))
      body = {
        error: false,
        body: {
          id: '123',
          title: 'Fixture artwork',
          tags: { tags: [] },
          seriesNavData: null
        }
      }
    if (pathname.startsWith('/ajax/search/tags/'))
      body = {
        error: false,
        body: {
          tagTranslation: { fixture: { en: 'Fixture tag' } },
          pixpedia: { abstract: 'Fixture description', image: 'https://i.pximg.net/tag.png' }
        }
      }
    const plain = Buffer.from(JSON.stringify(body))
    const encoding = pathname.split('/')[2]
    const compressor = { gzip: gzipSync, deflate: deflateSync, br: brotliCompressSync }[encoding ?? '']
    res.writeHead(200, { 'content-type': 'application/json', ...(compressor ? { 'content-encoding': encoding } : {}) })
    res.end(compressor ? compressor(plain) : plain)
  })
  const track = (socket: Duplex) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => {})
  }
  origin.on('connection', track)
  const proxy = protocol === 'https' ? https.createServer(credentials) : http.createServer()
  proxy.on('connection', track)
  let originPort: number
  proxy.on('connect', (req, client, head) => {
    track(client)
    connects.push(req.url ?? '')
    if (rejectConnect || !['www.pixiv.net:443', 'i.pximg.net:443'].includes(req.url ?? '')) {
      client.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n')
      return
    }
    // A fixed loopback mapping prevents this fixture from reaching public DNS or a remote host.
    const upstream = net.connect(originPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      client.pipe(upstream).pipe(client)
    })
    track(upstream)
    client.once('close', () => upstream.destroy())
    upstream.once('close', () => client.destroy())
  })
  const close = async () => {
    for (const socket of sockets) socket.destroy()
    await Promise.all(
      [origin, proxy].map(
        (server) =>
          new Promise<void>((resolve) => {
            if (!server.listening) return resolve()
            server.close(() => resolve())
          })
      )
    )
  }
  try {
    originPort = await listen(origin)
    const proxyPort = await listen(proxy)
    return {
      proxyUrl: `${protocol}://127.0.0.1:${proxyPort}`,
      connects,
      requests,
      sockets,
      slowRequest,
      rejectConnections: () => {
        rejectConnect = true
      },
      close
    }
  } catch (error) {
    await close()
    throw error
  }
}

describe.each(['http', 'https'] as const)('Pixiv real %s CONNECT transport', (protocol) => {
  it('tunnels metadata and Sharp-validated images, decodes compression, and preserves manual redirects', async () => {
    const fixture = await startFixture(protocol)
    const transport = createPixivFetchTransport({ ARCHIVE_HTTPS_PROXY: fixture.proxyUrl })
    try {
      for (const encoding of ['gzip', 'deflate', 'br']) {
        const response = await transport.fetch(`https://www.pixiv.net/compressed/${encoding}`)
        expect(await response.json()).toEqual({ message: 'fixture data' })
      }
      const signal = new AbortController().signal
      const fetchImpl = transport.fetch
      const artist = await fetchPixivArtistMetadata({ pixivUserId: '123', signal, fetchImpl })
      expect(artist.sourceName).toBe('Fixture artist')
      const artwork = await fetchPixivArtworkMetadata({ pixivArtworkId: '123', signal, fetchImpl })
      expect(artwork?.normalized.title).toBe('Fixture artwork')
      const tag = await fetchPixivTagMetadata({ tagName: 'fixture', signal, fetchImpl })
      expect(tag.nameEn).toBe('Fixture tag')
      const pixivDataRoot = path.join(fixtureRoot, protocol)
      for (const kind of ['avatar', 'background'] as const) {
        const imageUrl = kind === 'avatar' ? artist.avatarUrl! : artist.backgroundUrl!
        expect(
          await storePixivArtistImage({ imageUrl, pixivUserId: '123', kind, pixivDataRoot, signal, fetchImpl })
        ).toMatch(/\.png$/)
      }
      expect(await storePixivTagImage({ imageUrl: tag.imageUrl!, pixivDataRoot, signal, fetchImpl })).toMatch(/\.png$/)
      const redirect = await transport.fetch('https://www.pixiv.net/redirect', { redirect: 'follow' })
      expect(redirect.status).toBe(302)
      await redirect.body?.cancel()
      expect(fixture.connects).toContain('www.pixiv.net:443')
      expect(fixture.connects).toContain('i.pximg.net:443')
      expect(fixture.connects.every((target) => ['www.pixiv.net:443', 'i.pximg.net:443'].includes(target))).toBe(true)
      expect(fixture.requests).toContain('/avatar.png')
      expect(fixture.requests).toContain('/background.png')
      expect(fixture.requests).toContain('/tag.png')
      expect(fixture.requests).not.toContain('/blocked')
    } finally {
      await transport.close()
      await fixture.close()
    }
  })

  it('aborts active requests, releases unread bodies on close, and rejects later use', async () => {
    const fixture = await startFixture(protocol)
    const transport = createPixivFetchTransport({ ARCHIVE_HTTPS_PROXY: fixture.proxyUrl })
    try {
      const controller = new AbortController()
      const pending = transport.fetch('https://www.pixiv.net/slow', { signal: controller.signal })
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await fixture.slowRequest
      controller.abort()
      await rejected
      const response = await transport.fetch('https://i.pximg.net/stream')
      const unread = response.text()
      const bodyRejected = expect(unread).rejects.toThrow()
      await transport.close()
      await bodyRejected
      await expect(transport.fetch('https://www.pixiv.net/')).rejects.toThrow('已关闭')
      await vi.waitFor(() => expect(fixture.sockets.size).toBe(0))
    } finally {
      await transport.close()
      await fixture.close()
    }
  })

  it('fails a refused CONNECT without sending an origin request', async () => {
    const fixture = await startFixture(protocol)
    fixture.rejectConnections()
    const transport: PixivFetchTransport = createPixivFetchTransport({ ARCHIVE_HTTPS_PROXY: fixture.proxyUrl })
    try {
      await expect(transport.fetch('https://www.pixiv.net/ajax/illust/123')).rejects.toThrow()
      expect(fixture.connects).toEqual(['www.pixiv.net:443'])
      expect(fixture.requests).toEqual([])
      expect(trust.directAttempts).toBe(0)
    } finally {
      await transport.close()
      await fixture.close()
    }
  })

  it('reports an established proxy tunnel disconnect as a request failure', async () => {
    const fixture = await startFixture(protocol)
    const transport = createPixivFetchTransport({ ARCHIVE_HTTPS_PROXY: fixture.proxyUrl })
    try {
      const pending = transport.fetch('https://www.pixiv.net/slow')
      const rejected = expect(pending).rejects.toThrow()
      await fixture.slowRequest
      for (const socket of fixture.sockets) socket.destroy()
      await rejected
      expect(fixture.connects).toEqual(['www.pixiv.net:443'])
      expect(fixture.requests).toEqual(['/slow'])
      expect(trust.directAttempts).toBe(0)
    } finally {
      await transport.close()
      await fixture.close()
    }
  })
})
