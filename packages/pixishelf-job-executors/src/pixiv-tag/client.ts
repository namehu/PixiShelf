import { z } from 'zod'

const MAX_RESPONSE_BYTES = 1_000_000
const REQUEST_TIMEOUT_MS = 12_000
const PIXIV_API_HOST = 'www.pixiv.net'

// 该接口是公开标签页接口；执行器刻意不携带 Cookie，避免把用户会话带入后台 Worker。

const translationSchema = z
  .object({
    zh: z.string().nullable().optional(),
    en: z.string().nullable().optional()
  })
  .passthrough()

const responseSchema = z
  .object({
    error: z.boolean(),
    message: z.string().optional(),
    body: z
      .object({
        // Pixiv uses [] (not {}) when a tag has no translations. Accept only the
        // empty tuple so a future non-empty array still fails closed as a schema change.
        tagTranslation: z.union([z.record(z.string(), translationSchema), z.tuple([])]).nullable().optional(),
        pixpedia: z
          .object({
            abstract: z.string().nullable().optional(),
            image: z.string().nullable().optional()
          })
          .passthrough()
          .nullable()
          .optional()
      })
      .passthrough()
      .nullable()
      .optional()
  })
  .passthrough()

export interface NormalizedPixivTagMetadata {
  nameZh: string | null
  nameEn: string | null
  abstract: string | null
  imageUrl: string | null
}

export class PixivTagRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAt?: Date
  ) {
    super(message)
    this.name = 'PixivTagRequestError'
  }
}

export async function fetchPixivTagMetadata(input: {
  tagName: string
  signal: AbortSignal
  fetchImpl?: typeof fetch
  now?: () => Date
}): Promise<NormalizedPixivTagMetadata> {
  const fetchImpl = input.fetchImpl ?? fetch
  const now = input.now ?? (() => new Date())
  let url = new URL(`https://${PIXIV_API_HOST}/ajax/search/tags/${encodeURIComponent(input.tagName)}?lang=zh`)

  for (let redirect = 0; redirect <= 3; redirect += 1) {
    // 手动跟随重定向，才能在每一跳都重新执行 Pixiv 主站域名校验。
    assertPixivApiUrl(url)
    const response = await fetchWithTimeout(fetchImpl, url, input.signal)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirect === 3) {
        throw new PixivTagRequestError('Pixiv 标签接口重定向无效', 'PIXIV_INVALID_REDIRECT', false)
      }
      url = new URL(location, url)
      continue
    }
    if (response.status === 404) return emptyMetadata()
    if (response.status === 429) {
      throw new PixivTagRequestError(
        'Pixiv 标签接口触发限流',
        'PIXIV_RATE_LIMITED',
        true,
        parseRetryAfter(response.headers.get('retry-after'), now())
      )
    }
    if (response.status >= 500) {
      throw new PixivTagRequestError(`Pixiv 标签接口暂时不可用（${response.status}）`, 'PIXIV_UPSTREAM_ERROR', true)
    }
    if (!response.ok) {
      throw new PixivTagRequestError(`Pixiv 标签接口请求失败（${response.status}）`, 'PIXIV_REQUEST_REJECTED', false)
    }

    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new PixivTagRequestError('Pixiv 标签接口响应体过大', 'PIXIV_RESPONSE_TOO_LARGE', false)
    }
    const text = await readBoundedText(response, MAX_RESPONSE_BYTES)

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new PixivTagRequestError('Pixiv 标签接口返回了无效 JSON', 'PIXIV_SCHEMA_CHANGED', false)
    }
    const parsed = responseSchema.safeParse(json)
    if (!parsed.success) {
      throw new PixivTagRequestError('Pixiv 标签接口响应结构不符合预期', 'PIXIV_SCHEMA_CHANGED', false)
    }
    if (parsed.data.error) {
      const message = parsed.data.message?.trim() || 'Pixiv 标签接口返回错误'
      throw new PixivTagRequestError(message, 'PIXIV_API_ERROR', false)
    }
    if (!parsed.data.body) {
      throw new PixivTagRequestError('Pixiv 标签接口响应缺少 body', 'PIXIV_SCHEMA_CHANGED', false)
    }

    const translations = parsed.data.body.tagTranslation
    const translation = Array.isArray(translations) ? undefined : translations?.[input.tagName]
    const pixpedia = parsed.data.body.pixpedia
    return {
      nameZh: normalizeText(translation?.zh),
      nameEn: normalizeText(translation?.en),
      abstract: normalizeText(pixpedia?.abstract),
      imageUrl: normalizeText(pixpedia?.image)
    }
  }

  throw new PixivTagRequestError('Pixiv 标签接口重定向次数过多', 'PIXIV_INVALID_REDIRECT', false)
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
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
      throw new PixivTagRequestError('Pixiv 标签接口响应体过大', 'PIXIV_RESPONSE_TOO_LARGE', false)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, total).toString('utf8')
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: URL, signal: AbortSignal) {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const requestSignal = AbortSignal.any([signal, timeoutSignal])
  try {
    return await fetchImpl(url, {
      redirect: 'manual',
      signal: requestSignal,
      headers: {
        accept: 'application/json',
        referer: 'https://www.pixiv.net/'
      }
    })
  } catch (error) {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : error
    if (timeoutSignal.aborted) {
      throw new PixivTagRequestError('Pixiv 标签接口请求超时', 'PIXIV_REQUEST_TIMEOUT', true)
    }
    throw new PixivTagRequestError(
      error instanceof Error ? error.message : 'Pixiv 标签接口网络请求失败',
      'PIXIV_NETWORK_ERROR',
      true
    )
  }
}

function assertPixivApiUrl(url: URL) {
  if (url.protocol !== 'https:' || url.hostname !== PIXIV_API_HOST || (url.port && url.port !== '443')) {
    throw new PixivTagRequestError('Pixiv 标签接口重定向到了未允许的地址', 'PIXIV_INVALID_REDIRECT', false)
  }
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function emptyMetadata(): NormalizedPixivTagMetadata {
  return { nameZh: null, nameEn: null, abstract: null, imageUrl: null }
}

function parseRetryAfter(value: string | null, now: Date): Date {
  if (value) {
    const seconds = Number(value)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return new Date(now.getTime() + Math.min(seconds * 1_000, 6 * 60 * 60_000))
    }
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime()) && parsed > now) return parsed
  }
  return new Date(now.getTime() + 60_000)
}
