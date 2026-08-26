import { z } from 'zod'

const MAX_RESPONSE_BYTES = 1_000_000
const REQUEST_TIMEOUT_MS = 12_000
const PIXIV_API_HOST = 'www.pixiv.net'
const PIXIV_STATIC_HOST = 's.pximg.net'
const DEFAULT_AVATAR_PATHS = new Set(['/common/images/no_profile.png', '/common/images/no_profile_s.png'])

const responseSchema = z
  .object({
    error: z.boolean(),
    message: z.string().optional(),
    body: z
      .object({
        userId: z.union([z.string(), z.number()]),
        name: z.string().nullable().optional(),
        image: z.string().nullable().optional(),
        imageBig: z.string().nullable().optional(),
        background: z.object({ url: z.string().nullable().optional() }).passthrough().nullable().optional()
      })
      .passthrough()
      .nullable()
      .optional()
  })
  .passthrough()

export interface NormalizedPixivArtistMetadata {
  sourceName: string | null
  avatarUrl: string | null
  backgroundUrl: string | null
}

export class PixivArtistRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAt?: Date
  ) {
    super(message)
    this.name = 'PixivArtistRequestError'
  }
}

export async function fetchPixivArtistMetadata(input: {
  pixivUserId: string
  signal: AbortSignal
  fetchImpl?: typeof fetch
  now?: () => Date
}): Promise<NormalizedPixivArtistMetadata> {
  const fetchImpl = input.fetchImpl ?? fetch
  const now = input.now ?? (() => new Date())
  let url = new URL(`https://${PIXIV_API_HOST}/ajax/user/${input.pixivUserId}?full=1&lang=zh`)

  for (let redirect = 0; redirect <= 3; redirect += 1) {
    assertPixivApiUrl(url)
    const response = await fetchWithTimeout(fetchImpl, url, input.signal)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirect === 3) {
        throw new PixivArtistRequestError('Pixiv 用户接口重定向无效', 'PIXIV_INVALID_REDIRECT', false)
      }
      url = new URL(location, url)
      continue
    }
    if (response.status === 404) return emptyMetadata()
    if (response.status === 429) {
      throw new PixivArtistRequestError(
        'Pixiv 用户接口触发限流',
        'PIXIV_RATE_LIMITED',
        true,
        parseRetryAfter(response.headers.get('retry-after'), now())
      )
    }
    if (response.status >= 500) {
      throw new PixivArtistRequestError(`Pixiv 用户接口暂时不可用（${response.status}）`, 'PIXIV_UPSTREAM_ERROR', true)
    }
    if (!response.ok) {
      throw new PixivArtistRequestError(`Pixiv 用户接口请求失败（${response.status}）`, 'PIXIV_REQUEST_REJECTED', false)
    }

    const text = await readBoundedText(response, MAX_RESPONSE_BYTES)
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new PixivArtistRequestError('Pixiv 用户接口返回了无效 JSON', 'PIXIV_SCHEMA_CHANGED', false)
    }
    const parsed = responseSchema.safeParse(json)
    if (!parsed.success || parsed.data.error || !parsed.data.body) {
      throw new PixivArtistRequestError(
        parsed.success && parsed.data.message ? parsed.data.message : 'Pixiv 用户接口响应结构不符合预期',
        'PIXIV_SCHEMA_CHANGED',
        false
      )
    }
    if (String(parsed.data.body.userId) !== input.pixivUserId) {
      throw new PixivArtistRequestError('Pixiv 用户接口返回了其他用户身份', 'PIXIV_IDENTITY_MISMATCH', false)
    }
    return {
      sourceName: normalizeText(parsed.data.body.name),
      avatarUrl: normalizeAvatarUrl(parsed.data.body.imageBig) ?? normalizeAvatarUrl(parsed.data.body.image),
      backgroundUrl: normalizeText(parsed.data.body.background?.url)
    }
  }

  throw new PixivArtistRequestError('Pixiv 用户接口重定向次数过多', 'PIXIV_INVALID_REDIRECT', false)
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new PixivArtistRequestError('Pixiv 用户接口响应体过大', 'PIXIV_RESPONSE_TOO_LARGE', false)
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maximumBytes) {
      await reader.cancel()
      throw new PixivArtistRequestError('Pixiv 用户接口响应体过大', 'PIXIV_RESPONSE_TOO_LARGE', false)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, total).toString('utf8')
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: URL, signal: AbortSignal) {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  try {
    return await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.any([signal, timeoutSignal]),
      headers: { accept: 'application/json', referer: 'https://www.pixiv.net/' }
    })
  } catch (error) {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : error
    if (timeoutSignal.aborted) {
      throw new PixivArtistRequestError('Pixiv 用户接口请求超时', 'PIXIV_REQUEST_TIMEOUT', true)
    }
    throw new PixivArtistRequestError('Pixiv 用户接口网络请求失败', 'PIXIV_NETWORK_ERROR', true)
  }
}

function assertPixivApiUrl(url: URL) {
  if (url.protocol !== 'https:' || url.hostname !== PIXIV_API_HOST || (url.port && url.port !== '443')) {
    throw new PixivArtistRequestError('Pixiv 用户接口重定向到了未允许的地址', 'PIXIV_INVALID_REDIRECT', false)
  }
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized || null
}

function normalizeAvatarUrl(value: string | null | undefined): string | null {
  const normalized = normalizeText(value)
  if (!normalized) return null
  try {
    const url = new URL(normalized)
    if (
      url.protocol === 'https:' &&
      url.hostname === PIXIV_STATIC_HOST &&
      (!url.port || url.port === '443') &&
      DEFAULT_AVATAR_PATHS.has(url.pathname)
    ) {
      return null
    }
  } catch {
    // 非法 URL 继续交给图片存储层的来源校验统一拒绝。
  }
  return normalized
}

function emptyMetadata(): NormalizedPixivArtistMetadata {
  return { sourceName: null, avatarUrl: null, backgroundUrl: null }
}

function parseRetryAfter(value: string | null, now: Date): Date {
  if (value) {
    const seconds = Number(value)
    if (Number.isFinite(seconds) && seconds >= 0) return new Date(now.getTime() + Math.min(seconds * 1_000, 21_600_000))
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime()) && parsed > now) return parsed
  }
  return new Date(now.getTime() + 60_000)
}
