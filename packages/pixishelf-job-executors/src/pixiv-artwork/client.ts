import { z } from 'zod'

const MAX_RESPONSE_BYTES = 1_000_000
const REQUEST_TIMEOUT_MS = 12_000
const PIXIV_API_HOST = 'www.pixiv.net'

const nullableText = z.string().nullable().optional()
const nullableNumber = z.number().finite().nullable().optional()
const numericId = z.union([z.string(), z.number()])

const seriesNavSchema = z
  .object({
    seriesId: numericId,
    title: nullableText,
    order: z.union([z.string(), z.number()]).nullable().optional()
  })
  .passthrough()

const tagSchema = z
  .object({
    tag: z.string(),
    translation: z.union([z.string(), z.record(z.string(), z.string().nullable())]).nullable().optional()
  })
  .passthrough()

const responseSchema = z
  .object({
    error: z.boolean(),
    message: z.string().optional(),
    body: z
      .object({
        id: numericId,
        title: nullableText,
        description: nullableText,
        userId: numericId.nullable().optional(),
        userName: nullableText,
        createDate: nullableText,
        uploadDate: nullableText,
        pageCount: nullableNumber,
        width: nullableNumber,
        height: nullableNumber,
        bookmarkCount: nullableNumber,
        likeCount: nullableNumber,
        viewCount: nullableNumber,
        xRestrict: nullableNumber,
        aiType: nullableNumber,
        illustType: nullableNumber,
        sl: nullableNumber,
        urls: z.record(z.string(), z.string().nullable()).optional(),
        tags: z.object({ tags: z.array(tagSchema) }).passthrough(),
        seriesNavData: z.unknown().nullable().optional()
      })
      .passthrough()
      .nullable()
      .optional()
  })
  .passthrough()

type PixivArtworkBody = NonNullable<z.infer<typeof responseSchema>['body']>

export interface NormalizedPixivArtworkMetadata {
  id: string
  title: string | null
  description: string | null
  userId: string | null
  userName: string | null
  tags: string[]
  tagTranslations: Record<string, string>
  canonicalUrl: string
  originalUrl: string | null
  thumbnailUrl: string | null
  width: number | null
  height: number | null
  size: string | null
  pageCount: number | null
  bookmarkCount: number | null
  remoteLikeCount: number | null
  viewCount: number | null
  xRestrict: number | null
  aiType: number | null
  illustType: number | null
  sanityLevel: number | null
  createDate: string | null
  uploadDate: string | null
  series: NormalizedPixivArtworkSeries
}

export type NormalizedPixivArtworkSeries =
  | { state: 'PRESENT'; id: string; title: string | null; order: number | null }
  | { state: 'NONE' }
  | { state: 'UNKNOWN' }

export interface PixivArtworkMetadataResponse {
  raw: unknown
  normalized: NormalizedPixivArtworkMetadata
}

export class PixivArtworkRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAt?: Date
  ) {
    super(message)
    this.name = 'PixivArtworkRequestError'
  }
}

export async function fetchPixivArtworkMetadata(input: {
  pixivArtworkId: string
  signal: AbortSignal
  fetchImpl?: typeof fetch
  now?: () => Date
  requestTimeoutMs?: number
}): Promise<PixivArtworkMetadataResponse | null> {
  assertNumericId(input.pixivArtworkId)
  const fetchImpl = input.fetchImpl ?? fetch
  const now = input.now ?? (() => new Date())
  let url = new URL(`https://${PIXIV_API_HOST}/ajax/illust/${input.pixivArtworkId}?lang=zh`)

  for (let redirect = 0; redirect <= 3; redirect += 1) {
    assertPixivApiUrl(url)
    const response = await fetchWithTimeout(fetchImpl, url, input.signal, input.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirect === 3) {
        throw new PixivArtworkRequestError('Pixiv 作品接口重定向无效', 'PIXIV_INVALID_REDIRECT', false)
      }
      url = new URL(location, url)
      continue
    }
    if (response.status === 404) return null
    if (response.status === 429) {
      throw new PixivArtworkRequestError(
        'Pixiv 作品接口触发限流',
        'PIXIV_RATE_LIMITED',
        true,
        parseRetryAfter(response.headers.get('retry-after'), now())
      )
    }
    if (response.status >= 500) {
      throw new PixivArtworkRequestError(`Pixiv 作品接口暂时不可用（${response.status}）`, 'PIXIV_UPSTREAM_ERROR', true)
    }
    if (!response.ok) {
      throw new PixivArtworkRequestError(
        `Pixiv 作品接口请求失败（${response.status}）`,
        'PIXIV_REQUEST_REJECTED',
        false
      )
    }

    const text = await readBoundedText(response)
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new PixivArtworkRequestError('Pixiv 作品接口返回了无效 JSON', 'PIXIV_SCHEMA_CHANGED', false)
    }
    const parsed = responseSchema.safeParse(raw)
    if (!parsed.success) {
      throw new PixivArtworkRequestError('Pixiv 作品接口响应结构不符合预期', 'PIXIV_SCHEMA_CHANGED', false)
    }
    if (parsed.data.error) {
      if (/not found|不存在|削除/i.test(parsed.data.message ?? '')) return null
      throw new PixivArtworkRequestError(
        parsed.data.message || 'Pixiv 作品接口拒绝了请求',
        'PIXIV_REQUEST_REJECTED',
        false
      )
    }
    if (!parsed.data.body) {
      throw new PixivArtworkRequestError('Pixiv 作品接口响应缺少作品数据', 'PIXIV_SCHEMA_CHANGED', false)
    }
    if (String(parsed.data.body.id) !== input.pixivArtworkId) {
      throw new PixivArtworkRequestError('Pixiv 作品接口返回了其他作品身份', 'PIXIV_IDENTITY_MISMATCH', false)
    }

    return { raw, normalized: normalizeBody(parsed.data.body, input.pixivArtworkId) }
  }

  throw new PixivArtworkRequestError('Pixiv 作品接口重定向次数过多', 'PIXIV_INVALID_REDIRECT', false)
}

function normalizeBody(body: PixivArtworkBody, pixivArtworkId: string): NormalizedPixivArtworkMetadata {
  const tags: string[] = []
  const tagTranslations: Record<string, string> = {}
  const seenTags = new Set<string>()
  for (const item of body.tags?.tags ?? []) {
    const tag = normalizeText(item.tag)
    if (!tag || seenTags.has(tag)) continue
    seenTags.add(tag)
    tags.push(tag)
    const translation = normalizeTagTranslation(item.translation)
    if (translation) tagTranslations[tag] = translation
  }

  const width = normalizeInteger(body.width)
  const height = normalizeInteger(body.height)
  return {
    id: pixivArtworkId,
    title: normalizeText(body.title),
    description: normalizeText(body.description),
    userId: normalizeId(body.userId),
    userName: normalizeText(body.userName),
    tags,
    tagTranslations,
    canonicalUrl: `https://www.pixiv.net/artworks/${pixivArtworkId}`,
    originalUrl: normalizeUrl(body.urls?.original),
    thumbnailUrl:
      normalizeUrl(body.urls?.regular) ?? normalizeUrl(body.urls?.small) ?? normalizeUrl(body.urls?.thumb_mini),
    width,
    height,
    size: width !== null && height !== null ? `${width}x${height}` : null,
    pageCount: normalizeInteger(body.pageCount),
    bookmarkCount: normalizeInteger(body.bookmarkCount),
    remoteLikeCount: normalizeInteger(body.likeCount),
    viewCount: normalizeInteger(body.viewCount),
    xRestrict: normalizeInteger(body.xRestrict),
    aiType: normalizeInteger(body.aiType),
    illustType: normalizeInteger(body.illustType),
    sanityLevel: normalizeInteger(body.sl),
    createDate: normalizeDate(body.createDate),
    uploadDate: normalizeDate(body.uploadDate),
    series: normalizePixivArtworkSeries(body.seriesNavData)
  }
}

export function normalizePixivArtworkSeries(value: unknown): NormalizedPixivArtworkSeries {
  if (value === undefined) return { state: 'UNKNOWN' }
  if (value === null) return { state: 'NONE' }
  const parsed = seriesNavSchema.safeParse(value)
  if (!parsed.success) return { state: 'UNKNOWN' }
  const id = normalizeId(parsed.data.seriesId)
  if (!id) return { state: 'UNKNOWN' }
  return {
    state: 'PRESENT',
    id,
    title: normalizeText(parsed.data.title),
    order: normalizeIntegerLike(parsed.data.order)
  }
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: URL, signal: AbortSignal, requestTimeoutMs: number) {
  const timeoutSignal = AbortSignal.timeout(requestTimeoutMs)
  try {
    return await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.any([signal, timeoutSignal]),
      headers: { accept: 'application/json', referer: 'https://www.pixiv.net/' }
    })
  } catch (error) {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : error
    if (timeoutSignal.aborted) {
      throw new PixivArtworkRequestError('Pixiv 作品接口请求超时', 'PIXIV_REQUEST_TIMEOUT', true)
    }
    throw new PixivArtworkRequestError('Pixiv 作品接口网络请求失败', 'PIXIV_NETWORK_ERROR', true)
  }
}

async function readBoundedText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new PixivArtworkRequestError('Pixiv 作品接口响应体过大', 'PIXIV_RESPONSE_TOO_LARGE', false)
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new PixivArtworkRequestError('Pixiv 作品接口响应体过大', 'PIXIV_RESPONSE_TOO_LARGE', false)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, total).toString('utf8')
}

function assertPixivApiUrl(url: URL) {
  if (url.protocol !== 'https:' || url.hostname !== PIXIV_API_HOST || (url.port && url.port !== '443')) {
    throw new PixivArtworkRequestError('Pixiv 作品接口重定向到了未允许的地址', 'PIXIV_INVALID_REDIRECT', false)
  }
}

function assertNumericId(value: string) {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new PixivArtworkRequestError('Pixiv 作品 ID 无效', 'PIXIV_IDENTITY_INVALID', false)
  }
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized || null
}

function normalizeTagTranslation(value: string | Record<string, string | null> | null | undefined): string | null {
  if (typeof value === 'string') return normalizeText(value)
  if (!value) return null
  for (const translation of Object.values(value)) {
    const normalized = normalizeText(translation)
    if (normalized) return normalized
  }
  return null
}

function normalizeId(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const normalized = String(value)
  return /^[1-9][0-9]*$/.test(normalized) ? normalized : null
}

function normalizeInteger(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function normalizeIntegerLike(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return normalizeInteger(value)
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) return null
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) ? numeric : null
}

function normalizeDate(value: string | null | undefined): string | null {
  const normalized = normalizeText(value)
  if (!normalized) return null
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeUrl(value: string | null | undefined): string | null {
  const normalized = normalizeText(value)
  if (!normalized) return null
  try {
    const url = new URL(normalized)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
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
