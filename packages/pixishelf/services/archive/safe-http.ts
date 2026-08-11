import dns from 'node:dns/promises'
import https from 'node:https'
import net from 'node:net'
import { Buffer } from 'node:buffer'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import { ArchiveError } from './errors'

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

export class SafeHttpClient {
  constructor(private readonly allowedHostSuffixes: readonly string[]) {}

  async request(url: string, options: SafeHttpRequestOptions = {}): Promise<SafeHttpResponse> {
    return this.requestFollowingRedirects(url, options, 0)
  }

  async text(url: string, options: SafeHttpRequestOptions & { maxBytes?: number } = {}): Promise<string> {
    const response = await this.request(url, options)
    assertSuccessStatus(response)
    return (await readResponseBuffer(response, options.maxBytes ?? DEFAULT_BODY_LIMIT)).toString('utf8')
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

    const url = validateArchiveUrl(input, this.allowedHostSuffixes)
    const addresses = await resolvePublicAddresses(url.hostname)
    const selected = addresses[0]!
    const response = await sendPinnedRequest(url, selected, options)

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
  if (response.status === 404) throw new ArchiveError('REMOTE_NOT_FOUND', '远端作品或媒体不存在')
  if (response.status === 429) {
    throw new ArchiveError('REMOTE_RATE_LIMITED', '远端要求降低请求频率，任务已暂停', {
      recoverable: true,
      pause: true,
      retryAfterMs
    })
  }
  if (response.status === 509) {
    throw new ArchiveError('REMOTE_QUOTA_EXCEEDED', 'E-Hentai 图片额度不足，任务已暂停', {
      recoverable: true,
      pause: true,
      retryAfterMs
    })
  }
  if (response.status === 403) {
    throw new ArchiveError('REMOTE_FORBIDDEN', '远端拒绝了下载请求，任务已暂停', {
      recoverable: true,
      pause: true,
      retryAfterMs
    })
  }
  throw new ArchiveError('REMOTE_RESPONSE_INVALID', `远端返回 HTTP ${response.status}`, {
    recoverable: response.status >= 500
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

export function validateArchiveUrl(input: string, allowedSuffixes: readonly string[]): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch (error) {
    throw new ArchiveError('INVALID_URL', '链接格式无效', { cause: error })
  }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password) {
    throw new ArchiveError('SSRF_BLOCKED', '只允许不含账号信息的标准 HTTPS 链接')
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!allowedSuffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))) {
    throw new ArchiveError('SSRF_BLOCKED', '链接主机不在归档 Provider 的允许列表中')
  }
  return url
}

async function resolvePublicAddresses(hostname: string) {
  const literalFamily = net.isIP(hostname)
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await dns.lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicNetworkAddress(address))) {
    throw new ArchiveError('SSRF_BLOCKED', '链接解析到了私有、保留或不可路由地址')
  }
  return addresses
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

function sendPinnedRequest(
  url: URL,
  selected: { address: string; family: number },
  options: SafeHttpRequestOptions
): Promise<Omit<SafeHttpResponse, 'url'>> {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body)
    const request = https.request(
      url,
      {
        method: options.method ?? 'GET',
        headers: {
          'user-agent': 'PixiShelf-Archive/1.0',
          accept: '*/*',
          ...(body ? { 'content-length': String(body.length) } : {}),
          ...options.headers
        },
        lookup: (_hostname, _lookupOptions, callback) => {
          callback(null, selected.address, selected.family)
        }
      },
      (response) => resolve({ status: response.statusCode ?? 0, headers: response.headers, stream: response })
    )
    const onAbort = () => request.destroy(new ArchiveError('CANCELLED', '请求已取消', { recoverable: true }))
    options.signal?.addEventListener('abort', onAbort, { once: true })
    request.setTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => {
      request.destroy(new ArchiveError('REMOTE_RESPONSE_INVALID', '远端请求超时', { recoverable: true }))
    })
    request.on('error', (error) => reject(error))
    request.on('close', () => options.signal?.removeEventListener('abort', onAbort))
    if (body) request.write(body)
    request.end()
  })
}

function parseRetryAfter(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(raw)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}
