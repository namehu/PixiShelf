import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import { Buffer } from 'node:buffer'
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import type { Socket } from 'node:net'
import { ArchiveError, type ArchiveErrorStage, withArchiveErrorContext } from './errors'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_BODY_LIMIT = 8 * 1024 * 1024
const MAX_REDIRECTS = 5

export interface SafeHttpResponse {
  status: number
  headers: IncomingHttpHeaders
  stream: IncomingMessage
  url: string
}

export interface SafeHttpRequestOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string | Buffer
  signal?: AbortSignal
  timeoutMs?: number
}

export type ArchiveProxyEnvironment = Readonly<Record<string, string | undefined>>

export interface ResolvedNetworkAddress {
  address: string
  family: number
}

export class SafeHttpClient {
  constructor(
    private readonly allowedHostSuffixes: readonly string[],
    private readonly proxyEnvironment: ArchiveProxyEnvironment = process.env,
    private readonly nonStandardPortHostSuffixes: readonly string[] = []
  ) {}

  async request(url: string, options: SafeHttpRequestOptions = {}): Promise<SafeHttpResponse> {
    return this.requestFollowingRedirects(url, options, 0)
  }

  async text(url: string, options: SafeHttpRequestOptions & { maxBytes?: number } = {}): Promise<string> {
    const response = await this.request(url, options)
    assertSuccessStatus(response)
    try {
      return (await readResponseBuffer(response, options.maxBytes ?? DEFAULT_BODY_LIMIT)).toString('utf8')
    } catch (error) {
      throw classifyNetworkError(error, 'MEDIA_STREAM', remoteHostForUrl(new URL(response.url)))
    }
  }

  async json<T>(url: string, options: SafeHttpRequestOptions & { maxBytes?: number } = {}): Promise<T> {
    const body = await this.text(url, options)
    try {
      return JSON.parse(body) as T
    } catch (error) {
      throw new ArchiveError('REMOTE_RESPONSE_INVALID', '远端返回的 JSON 无法解析', { cause: error })
    }
  }

  private async requestFollowingRedirects(
    input: string,
    options: SafeHttpRequestOptions,
    redirectCount: number
  ): Promise<SafeHttpResponse> {
    if (redirectCount > MAX_REDIRECTS) {
      throw new ArchiveError('REMOTE_RESPONSE_INVALID', '远端重定向次数过多')
    }

    const url = validateArchiveUrl(input, this.allowedHostSuffixes, this.nonStandardPortHostSuffixes)
    const proxyUrl = resolveArchiveProxyUrl(url, this.proxyEnvironment)
    let addresses: ResolvedNetworkAddress[]
    try {
      addresses = await resolveNetworkAddresses(url.hostname)
      assertSafeResolvedAddresses(addresses, proxyUrl)
    } catch (error) {
      throw classifyNetworkError(error, 'MEDIA_REQUEST', remoteHostForUrl(url))
    }
    const response = proxyUrl
      ? await sendProxiedRequest(url, proxyUrl, options)
      : await sendPinnedRequest(url, addresses[0]!, options)

    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      response.stream.resume()
      const redirected = new URL(response.headers.location, url).toString()
      const nextMethod = response.status === 303 ? 'GET' : options.method
      return this.requestFollowingRedirects(
        redirected,
        {
          ...options,
          method: nextMethod,
          body: nextMethod === 'GET' ? undefined : options.body
        },
        redirectCount + 1
      )
    }

    return { ...response, url: url.toString() }
  }
}

export function assertSuccessStatus(response: SafeHttpResponse): void {
  if (response.status >= 200 && response.status < 300) return
  response.stream.resume()
  const retryAfterMs = parseRetryAfter(response.headers['retry-after'])
  const diagnostic = { stage: 'MEDIA_REQUEST' as const, remoteHost: remoteHostForUrl(new URL(response.url)) }
  if (response.status === 404) {
    throw new ArchiveError('REMOTE_NOT_FOUND', '远端作品或媒体不存在', diagnostic)
  }
  if (response.status === 429) {
    throw new ArchiveError('REMOTE_RATE_LIMITED', '远端要求降低请求频率，任务已暂停', {
      recoverable: true,
      pause: true,
      retryAfterMs,
      ...diagnostic
    })
  }
  if (response.status === 509) {
    throw new ArchiveError('REMOTE_QUOTA_EXCEEDED', 'E-Hentai 图片额度不足，任务已暂停', {
      recoverable: true,
      pause: true,
      retryAfterMs,
      ...diagnostic
    })
  }
  if (response.status === 403) {
    throw new ArchiveError('REMOTE_FORBIDDEN', '远端拒绝了下载请求，任务已暂停', {
      recoverable: true,
      pause: true,
      retryAfterMs,
      ...diagnostic
    })
  }
  throw new ArchiveError('REMOTE_RESPONSE_INVALID', `远端返回 HTTP ${response.status}`, {
    recoverable: response.status >= 500,
    ...diagnostic
  })
}

export async function readResponseBuffer(response: SafeHttpResponse, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response.stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) {
      response.stream.destroy()
      throw new ArchiveError('DOWNLOAD_TOO_LARGE', `远端响应超过 ${maxBytes} 字节限制`)
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

export function validateArchiveUrl(
  input: string,
  allowedSuffixes: readonly string[],
  nonStandardPortSuffixes: readonly string[] = []
): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch (error) {
    throw new ArchiveError('INVALID_URL', '链接格式无效', { cause: error })
  }
  if (url.protocol !== 'https:') throw new ArchiveError('SSRF_BLOCKED', '只允许 HTTPS 链接')
  if (url.username || url.password) throw new ArchiveError('SSRF_BLOCKED', '链接不能包含账号或密码')
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!matchesHostSuffix(hostname, allowedSuffixes)) {
    throw new ArchiveError('SSRF_BLOCKED', '链接主机不在归档 Provider 的允许列表中')
  }
  if (url.port && !matchesHostSuffix(hostname, nonStandardPortSuffixes)) {
    throw new ArchiveError('SSRF_BLOCKED', '链接端口不在归档 Provider 的允许列表中')
  }
  return url
}

function matchesHostSuffix(hostname: string, suffixes: readonly string[]): boolean {
  return suffixes.some((rawSuffix) => {
    const suffix = rawSuffix.toLowerCase().replace(/^\.+|\.$/g, '')
    return suffix.length > 0 && (hostname === suffix || hostname.endsWith(`.${suffix}`))
  })
}

async function resolveNetworkAddresses(hostname: string): Promise<ResolvedNetworkAddress[]> {
  const literalFamily = net.isIP(hostname)
  return literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await dns.lookup(hostname, { all: true, verbatim: true })
}

export function assertSafeResolvedAddresses(addresses: readonly ResolvedNetworkAddress[], proxyUrl: URL | null): void {
  const blocked = addresses.filter(({ address }) => !isPublicNetworkAddress(address))
  const proxyCanResolveFakeIps = proxyUrl !== null && blocked.every(({ address }) => isProxySyntheticAddress(address))
  if (addresses.length === 0 || (blocked.length > 0 && !proxyCanResolveFakeIps)) {
    throw new ArchiveError('SSRF_BLOCKED', '链接解析到了私有、保留或不可路由地址')
  }
}

export function resolveArchiveProxyUrl(target: URL, environment: ArchiveProxyEnvironment = process.env): URL | null {
  const explicitProxy = environment.ARCHIVE_HTTPS_PROXY
  if (explicitProxy === '') return null

  if (explicitProxy === undefined && shouldBypassProxy(target, environment.NO_PROXY ?? environment.no_proxy)) {
    return null
  }

  const rawProxy =
    explicitProxy ??
    environment.HTTPS_PROXY ??
    environment.https_proxy ??
    environment.HTTP_PROXY ??
    environment.http_proxy
  if (!rawProxy?.trim()) return null

  let proxyUrl: URL
  try {
    proxyUrl = new URL(rawProxy)
  } catch {
    // URL parse errors may echo proxy credentials in their cause; do not retain it.
    throw new ArchiveError('INTERNAL', '归档代理地址格式无效')
  }
  if (!['http:', 'https:'].includes(proxyUrl.protocol)) {
    throw new ArchiveError('INTERNAL', '归档下载仅支持 HTTP 或 HTTPS 代理')
  }
  if (proxyUrl.username || proxyUrl.password) {
    throw new ArchiveError('INTERNAL', '归档代理暂不支持 URL 中的账号或密码')
  }
  if ((proxyUrl.pathname && proxyUrl.pathname !== '/') || proxyUrl.search || proxyUrl.hash) {
    throw new ArchiveError('INTERNAL', '归档代理地址不能包含路径、查询参数或片段')
  }
  return proxyUrl
}

export function isPublicNetworkAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a = 0, b = 0, c = 0] = address.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false
    if (a === 100 && b >= 64 && b <= 127) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && (b === 168 || b === 0 || (b === 0 && c === 2))) return false
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false
    if (a === 203 && b === 0 && c === 113) return false
    return true
  }
  if (!net.isIPv6(address)) return false
  const normalized = address.toLowerCase()
  if (normalized === '::' || normalized === '::1') return false
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)) return false
  if (normalized.startsWith('ff') || normalized.startsWith('2001:db8:')) return false
  if (normalized.startsWith('::ffff:')) return isPublicNetworkAddress(normalized.slice('::ffff:'.length))
  return true
}

function isProxySyntheticAddress(address: string): boolean {
  if (!net.isIPv4(address)) return false
  const [a = 0, b = 0] = address.split('.').map(Number)
  return a === 198 && (b === 18 || b === 19)
}

function shouldBypassProxy(target: URL, noProxy: string | undefined): boolean {
  if (!noProxy?.trim()) return false
  const hostname = target.hostname.toLowerCase().replace(/\.$/, '')
  const port = target.port || '443'

  return noProxy.split(',').some((rawEntry) => {
    const entry = rawEntry.trim().toLowerCase()
    if (!entry) return false
    if (entry === '*') return true

    const separator = entry.lastIndexOf(':')
    const hasSingleColon = separator > 0 && entry.indexOf(':') === separator
    const entryPort = hasSingleColon ? entry.slice(separator + 1) : null
    if (entryPort && entryPort !== port) return false

    const entryHost = (hasSingleColon ? entry.slice(0, separator) : entry).replace(/^\*?\./, '')
    return hostname === entryHost || hostname.endsWith(`.${entryHost}`)
  })
}

function sendPinnedRequest(
  url: URL,
  selected: ResolvedNetworkAddress,
  options: SafeHttpRequestOptions
): Promise<Omit<SafeHttpResponse, 'url'>> {
  return sendRequest(url, options, {
    lookup: createPinnedLookup(selected)
  })
}

export function createPinnedLookup(selected: ResolvedNetworkAddress): NonNullable<RequestOptions['lookup']> {
  return (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all) {
      callback(null, [selected], selected.family)
      return
    }
    callback(null, selected.address, selected.family)
  }
}

function sendProxiedRequest(
  url: URL,
  proxyUrl: URL,
  options: SafeHttpRequestOptions
): Promise<Omit<SafeHttpResponse, 'url'>> {
  return new Promise((resolve, reject) => {
    const body =
      options.body === undefined ? undefined : Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body)
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const targetPort = url.port || '443'
    const targetHost = net.isIPv6(url.hostname) ? `[${url.hostname}]:${targetPort}` : `${url.hostname}:${targetPort}`
    const proxyRequestFactory = proxyUrl.protocol === 'https:' ? https.request : http.request
    let proxyRequest: ClientRequest
    let proxySocket: Socket | null = null
    let tunnelSocket: tls.TLSSocket | null = null
    let upstreamRequest: ClientRequest | null = null
    let responseStream: IncomingMessage | null = null
    let settled = false
    let connectionStage: ArchiveErrorStage = 'PROXY_CONNECT'

    const destroyConnections = (error: Error) => {
      upstreamRequest?.destroy(error)
      responseStream?.destroy(error)
      tunnelSocket?.destroy(error)
      // The raw CONNECT socket has no independent error consumer. Passing an
      // error to destroy() can surface as an uncaught socket error after the
      // request promise has already been rejected.
      proxySocket?.destroy()
      proxyRequest.destroy(error)
    }
    const removeAbortListener = () => options.signal?.removeEventListener('abort', onAbort)
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(connectTimer)
      removeAbortListener()
      const classified = classifyNetworkError(error, connectionStage, targetHost)
      destroyConnections(classified)
      reject(classified)
    }
    const onAbort = () => {
      const error = new ArchiveError('CANCELLED', '请求已取消', { recoverable: true })
      if (!settled) {
        fail(error)
        return
      }
      destroyConnections(error)
    }
    const connectTimer = setTimeout(() => {
      fail(new ArchiveError('REMOTE_RESPONSE_INVALID', '远端请求超时', { recoverable: true }))
    }, timeoutMs)

    proxyRequest = proxyRequestFactory({
      protocol: proxyUrl.protocol,
      hostname: proxyUrl.hostname,
      port: proxyUrl.port || (proxyUrl.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT',
      path: targetHost,
      headers: {
        host: targetHost,
        connection: 'keep-alive',
        // Some older HTTP proxies use this de-facto header to decide whether the
        // CONNECT socket may remain open for the subsequent TLS handshake.
        'proxy-connection': 'keep-alive'
      },
      agent: false
    })
    proxyRequest.on('socket', (socket) => {
      if (settled) {
        socket.destroy()
        return
      }
      proxySocket = socket
    })
    proxyRequest.on('connect', (response, socket, head) => {
      proxySocket = socket
      if (response.statusCode !== 200) {
        fail(
          new ArchiveError('REMOTE_RESPONSE_INVALID', `归档代理 CONNECT 返回 HTTP ${response.statusCode ?? 0}`, {
            recoverable: true
          })
        )
        return
      }
      if (head.length > 0) socket.unshift(head)
      connectionStage = 'TLS_HANDSHAKE'

      tunnelSocket = tls.connect({
        socket,
        servername: net.isIP(url.hostname) ? undefined : url.hostname,
        ALPNProtocols: ['http/1.1']
      })
      tunnelSocket.once('error', fail)
      tunnelSocket.once('secureConnect', () => {
        if (settled || !tunnelSocket) return
        connectionStage = 'MEDIA_REQUEST'
        const tunnelAgent = new https.Agent({ keepAlive: false })
        tunnelAgent.createConnection = () => tunnelSocket!
        upstreamRequest = https.request(
          url,
          {
            agent: tunnelAgent,
            method: options.method ?? 'GET',
            headers: {
              'user-agent': 'PixiShelf-Archive/1.0',
              accept: '*/*',
              ...(body ? { 'content-length': String(body.length) } : {}),
              ...options.headers
            }
          },
          (response) => {
            if (settled) {
              response.destroy()
              return
            }
            settled = true
            clearTimeout(connectTimer)
            responseStream = response
            response.once('close', removeAbortListener)
            resolve({ status: response.statusCode ?? 0, headers: response.headers, stream: response })
          }
        )
        upstreamRequest.setTimeout(timeoutMs, () => {
          upstreamRequest?.destroy(new ArchiveError('REMOTE_RESPONSE_INVALID', '远端请求超时', { recoverable: true }))
        })
        upstreamRequest.once('error', fail)
        if (body) upstreamRequest.write(body)
        upstreamRequest.end()
      })
    })
    proxyRequest.once('response', (response) => {
      response.resume()
      fail(
        new ArchiveError('REMOTE_RESPONSE_INVALID', `归档代理未建立 CONNECT 隧道（HTTP ${response.statusCode ?? 0}）`, {
          recoverable: true
        })
      )
    })
    proxyRequest.once('error', fail)

    if (options.signal?.aborted) onAbort()
    else options.signal?.addEventListener('abort', onAbort, { once: true })
    if (!settled) proxyRequest.end()
  })
}

function sendRequest(
  url: URL,
  options: SafeHttpRequestOptions,
  connection: Pick<RequestOptions, 'agent' | 'lookup'>
): Promise<Omit<SafeHttpResponse, 'url'>> {
  return new Promise((resolve, reject) => {
    const body =
      options.body === undefined ? undefined : Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body)
    const targetHost = remoteHostForUrl(url)
    let connectionStage: ArchiveErrorStage = 'TLS_HANDSHAKE'
    const request = https.request(
      url,
      {
        ...connection,
        method: options.method ?? 'GET',
        headers: {
          'user-agent': 'PixiShelf-Archive/1.0',
          accept: '*/*',
          ...(body ? { 'content-length': String(body.length) } : {}),
          ...options.headers
        }
      },
      (response) => {
        connectionStage = 'MEDIA_REQUEST'
        resolve({ status: response.statusCode ?? 0, headers: response.headers, stream: response })
      }
    )
    request.on('socket', (socket) => {
      socket.once('secureConnect', () => {
        connectionStage = 'MEDIA_REQUEST'
      })
    })
    const onAbort = () => request.destroy(new ArchiveError('CANCELLED', '请求已取消', { recoverable: true }))
    options.signal?.addEventListener('abort', onAbort, { once: true })
    request.setTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => {
      request.destroy(new ArchiveError('REMOTE_RESPONSE_INVALID', '远端请求超时', { recoverable: true }))
    })
    request.on('error', (error) => reject(classifyNetworkError(error, connectionStage, targetHost)))
    request.on('close', () => options.signal?.removeEventListener('abort', onAbort))
    if (body) request.write(body)
    request.end()
  })
}

function classifyNetworkError(error: unknown, stage: ArchiveErrorStage, remoteHost: string): ArchiveError {
  const classified = withArchiveErrorContext(error, { stage, remoteHost })
  if (classified.code !== 'INTERNAL') return classified
  return new ArchiveError('REMOTE_RESPONSE_INVALID', networkFailureMessage(stage), {
    cause: classified,
    recoverable: true,
    stage,
    remoteHost
  })
}

function networkFailureMessage(stage: ArchiveErrorStage): string {
  if (stage === 'PROXY_CONNECT') return '归档代理连接失败'
  if (stage === 'TLS_HANDSHAKE') return '远端 TLS 握手失败'
  if (stage === 'MEDIA_STREAM') return '远端媒体传输中断'
  return '远端请求失败'
}

export function remoteHostForUrl(url: URL): string {
  const hostname = net.isIPv6(url.hostname) ? `[${url.hostname}]` : url.hostname.toLowerCase().replace(/\.$/, '')
  return `${hostname}:${url.port || '443'}`
}

function parseRetryAfter(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(raw)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}
