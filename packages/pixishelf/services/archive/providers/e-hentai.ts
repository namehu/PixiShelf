import { createHash } from 'node:crypto'
import { getEhentaiVersionNotice } from '@pixishelf/job-contracts'
import path from 'node:path'
import { ArchiveError, withArchiveErrorContext } from '../errors'
import { SafeHttpClient, assertSuccessStatus, remoteHostForUrl } from '../safe-http'
import type {
  ArchiveDownloadContext,
  ArchiveProvider,
  ArchiveProviderContext,
  RemoteMedia,
  ResolvedArchive,
  ResolvedMedia,
  SourceTagValue
} from '../types'

const PROVIDER_KEY = 'e-hentai'
const GALLERY_HOST = 'e-hentai.org'
const API_URL = 'https://api.e-hentai.org/api.php'
const MAX_GALLERY_PAGES = 500
const HATH_NETWORK_SUFFIX = 'hath.network'

interface EhGalleryMetadata {
  gid: number
  token: string
  title: string
  title_jpn?: string
  category?: string
  thumb?: string
  uploader?: string
  posted?: string
  filecount?: string
  filesize?: number
  expunged?: boolean
  rating?: string
  tags?: string[]
  error?: string
  parent_gid?: string
  parent_key?: string
  current_gid?: string
  current_key?: string
  [key: string]: unknown
}

interface EhApiResponse {
  gmetadata?: EhGalleryMetadata[]
  error?: string
}

interface EhTokenResponse {
  tokenlist?: Array<{ gid: number; token?: string }>
  error?: string
}

export class EHentaiProvider implements ArchiveProvider {
  readonly key = PROVIDER_KEY

  constructor(
    private readonly http = new SafeHttpClient(['e-hentai.org', 'ehgt.org', HATH_NETWORK_SUFFIX], process.env, [
      HATH_NETWORK_SUFFIX
    ])
  ) {}

  accepts(url: URL): boolean {
    return url.protocol === 'https:' && url.hostname.toLowerCase() === GALLERY_HOST && /^\/(?:g|s)\//.test(url.pathname)
  }

  async resolve(input: string, context: ArchiveProviderContext = {}): Promise<ResolvedArchive> {
    const submitted = parseSupportedUrl(input)
    const gallery = await this.resolveGalleryIdentity(submitted, context)
    const canonicalUrl = `https://${GALLERY_HOST}/g/${gallery.gid}/${gallery.token}/`
    const metadata = await this.fetchMetadata(gallery.gid, gallery.token, context)
    const fileCount = parsePositiveInteger(metadata.filecount, 'filecount')
    const sourcePages = await this.fetchSourcePages(canonicalUrl, gallery.gid, fileCount, context)
    const tags = normalizeTags(metadata.tags ?? [])
    const title = cleanText(metadata.title_jpn) || cleanText(metadata.title) || `E-Hentai ${gallery.gid}`
    const aliases = Array.from(
      new Set([cleanText(metadata.title), cleanText(metadata.title_jpn)].filter(Boolean))
    ).filter((value) => value !== title)
    const postedAt = parseUnixTimestamp(metadata.posted)
    const creatorBucket = chooseCreatorBucket(tags)
    const relationships = normalizeRelationships(metadata, gallery.gid)
    const normalizedMetadata = {
      schemaVersion: 1,
      gid: String(gallery.gid),
      titles: { display: title, aliases },
      category: cleanText(metadata.category) || null,
      uploader: cleanText(metadata.uploader) || null,
      thumbnailUrl: cleanText(metadata.thumb) || null,
      postedAt: postedAt?.toISOString() ?? null,
      fileCount,
      fileSize: typeof metadata.filesize === 'number' ? metadata.filesize : null,
      rating: cleanText(metadata.rating) || null,
      expunged: metadata.expunged === true,
      tags,
      relationships,
      mediaPlan: sourcePages.map((sourcePageUrl, index) => ({ index, sourcePageUrl }))
    }
    const warnings = metadata.expunged ? ['该画廊已被远端标记为删除，媒体内容可能不完整'] : []
    const versionNotice = getEhentaiVersionNotice(String(gallery.gid), relationships)
    if (versionNotice) warnings.push(versionNotice)

    return {
      providerKey: PROVIDER_KEY,
      externalId: String(gallery.gid),
      canonicalUrl,
      locator: { gid: String(gallery.gid), token: gallery.token },
      title,
      titleAliases: aliases,
      description: null,
      category: cleanText(metadata.category) || null,
      uploader: cleanText(metadata.uploader) || null,
      thumbnailUrl: cleanText(metadata.thumb) || null,
      postedAt,
      tags,
      relationships,
      media: sourcePages.map((sourcePageUrl, index) => ({
        index,
        sourcePageUrl,
        locator: { gid: String(gallery.gid), pageIndex: index, sourcePageUrl },
        expectedFilename: `${String(index + 1).padStart(4, '0')}`
      })),
      normalizedMetadata,
      rawMetadata: metadata,
      warnings,
      creatorBucket
    }
  }

  async openMedia(item: ResolvedMedia, context: ArchiveDownloadContext): Promise<RemoteMedia> {
    let html: string
    try {
      html = await this.http.text(item.sourcePageUrl, {
        signal: context.signal,
        maxBytes: 4 * 1024 * 1024,
        headers: { referer: item.sourcePageUrl }
      })
    } catch (error) {
      throw withArchiveErrorContext(error, {
        stage: 'SOURCE_PAGE',
        remoteHost: remoteHostForUrl(new URL(item.sourcePageUrl))
      })
    }
    const originalUrl = findLink(html, /fullimg\.php/i, item.sourcePageUrl)
    const displayUrl = findImageById(html, 'img', item.sourcePageUrl)
    let selectedUrl: string | null = null
    let selectedQuality: 'ORIGINAL' | 'DISPLAY' = context.quality

    if (context.quality === 'ORIGINAL') {
      // 若不存在 fullimg 链接，则 E-Hentai 已在展示原始文件。
      selectedUrl = originalUrl ?? displayUrl
      selectedQuality = 'ORIGINAL'
    } else {
      selectedUrl = displayUrl
      selectedQuality = 'DISPLAY'
    }

    if (!selectedUrl) {
      throw new ArchiveError('REMOTE_RESPONSE_INVALID', '无法从 E-Hentai 图片页解析媒体地址', {
        recoverable: true,
        stage: 'SOURCE_PAGE',
        remoteHost: remoteHostForUrl(new URL(item.sourcePageUrl))
      })
    }

    try {
      const response = await this.http.request(selectedUrl, {
        signal: context.signal,
        headers: { referer: item.sourcePageUrl }
      })
      assertSuccessStatus(response)
      return {
        stream: response.stream,
        mimeType: headerValue(response.headers['content-type'])?.split(';')[0]?.trim() || null,
        contentLength: parseContentLength(response.headers['content-length']),
        originalFilename: extractOriginalFilename(html),
        quality: selectedQuality,
        remoteHost: remoteHostForUrl(new URL(response.url))
      }
    } catch (error) {
      if (
        context.quality === 'ORIGINAL' &&
        error instanceof ArchiveError &&
        ['REMOTE_FORBIDDEN', 'REMOTE_QUOTA_EXCEEDED'].includes(error.code)
      ) {
        throw new ArchiveError('ORIGINAL_UNAVAILABLE', '原图当前不可用；请明确选择展示质量后继续', {
          cause: error,
          recoverable: true,
          pause: true,
          decisionCode: 'USE_DISPLAY_QUALITY',
          stage: error.stage,
          remoteHost: error.remoteHost
        })
      }
      throw error
    }
  }

  private async resolveGalleryIdentity(url: URL, context: ArchiveProviderContext) {
    const galleryMatch = url.pathname.match(/^\/g\/(\d+)\/([a-z0-9]+)(?:\/|$)/i)
    if (galleryMatch) return { gid: Number(galleryMatch[1]), token: galleryMatch[2]! }

    const pageMatch = url.pathname.match(/^\/s\/([a-z0-9]+)\/(\d+)-(\d+)(?:\/|$)/i)
    if (!pageMatch) throw new ArchiveError('INVALID_URL', '不支持的 E-Hentai 链接格式')
    const gid = Number(pageMatch[2])
    const pageNumber = Number(pageMatch[3])
    const response = await this.http.json<EhTokenResponse>(API_URL, {
      method: 'POST',
      signal: context.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'gtoken', pagelist: [[gid, pageMatch[1], pageNumber]] }),
      maxBytes: 4 * 1024 * 1024
    })
    if (response.error) {
      throw new ArchiveError('REMOTE_RESPONSE_INVALID', 'E-Hentai API 返回错误', {
        cause: new Error(response.error)
      })
    }
    const token = response.tokenlist?.find((value) => Number(value.gid) === gid)?.token
    if (!token) throw new ArchiveError('REMOTE_NOT_FOUND', '无法从 E-Hentai API 定位图片所属画廊')
    return { gid, token }
  }

  private async fetchMetadata(gid: number, token: string, context: ArchiveProviderContext) {
    const response = await this.http.json<EhApiResponse>(API_URL, {
      method: 'POST',
      signal: context.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'gdata', gidlist: [[gid, token]], namespace: 1 }),
      maxBytes: 4 * 1024 * 1024
    })
    if (response.error) {
      throw new ArchiveError('REMOTE_RESPONSE_INVALID', 'E-Hentai API 返回错误', {
        cause: new Error(response.error)
      })
    }
    const metadata = response.gmetadata?.[0]
    if (!metadata || Number(metadata.gid) !== gid) {
      throw new ArchiveError('REMOTE_NOT_FOUND', 'E-Hentai API 未返回目标画廊')
    }
    if (metadata.error) {
      throw new ArchiveError('REMOTE_NOT_FOUND', 'E-Hentai API 返回的目标画廊不可用', {
        cause: new Error(metadata.error)
      })
    }
    return metadata
  }

  private async fetchSourcePages(
    canonicalUrl: string,
    gid: number,
    fileCount: number,
    context: ArchiveProviderContext
  ): Promise<string[]> {
    const pages = new Map<number, string>()
    let previousSize = -1
    for (let page = 0; page < MAX_GALLERY_PAGES && pages.size < fileCount; page += 1) {
      const galleryPage = new URL(canonicalUrl)
      if (page > 0) galleryPage.searchParams.set('p', String(page))
      const html = await this.http.text(galleryPage.toString(), {
        signal: context.signal,
        maxBytes: 8 * 1024 * 1024
      })
      for (const href of findAllLinks(html, galleryPage.toString())) {
        const match = new URL(href).pathname.match(new RegExp(`^/s/[a-z0-9]+/${gid}-(\\d+)(?:/|$)`, 'i'))
        if (match) pages.set(Number(match[1]), href)
      }
      if (pages.size === previousSize) break
      previousSize = pages.size
    }

    const ordered = Array.from(pages.entries())
      .sort((left, right) => left[0] - right[0])
      .map((entry) => entry[1])
    if (ordered.length !== fileCount) {
      throw new ArchiveError(
        'REMOTE_RESPONSE_INVALID',
        `画廊声明有 ${fileCount} 个媒体，但只解析到 ${ordered.length} 个；未创建不完整任务`,
        { recoverable: true }
      )
    }
    return ordered
  }
}

function normalizeRelationships(metadata: EhGalleryMetadata, selfGid: number) {
  const relationships: ResolvedArchive['relationships'] = []
  const parentGid = positiveIntegerOrNull(metadata.parent_gid)
  const parentKey = cleanText(metadata.parent_key)
  if (parentGid && parentGid !== selfGid && parentKey) {
    relationships.push({
      type: 'REPLACES',
      direction: 'OUTBOUND',
      providerKey: PROVIDER_KEY,
      externalId: String(parentGid),
      canonicalUrl: `https://${GALLERY_HOST}/g/${parentGid}/${parentKey}/`,
      locator: { gid: String(parentGid), token: parentKey }
    })
  }
  const currentGid = positiveIntegerOrNull(metadata.current_gid)
  const currentKey = cleanText(metadata.current_key)
  if (currentGid && currentGid !== selfGid && currentKey) {
    relationships.push({
      type: 'REPLACES',
      direction: 'INBOUND',
      providerKey: PROVIDER_KEY,
      externalId: String(currentGid),
      canonicalUrl: `https://${GALLERY_HOST}/g/${currentGid}/${currentKey}/`,
      locator: { gid: String(currentGid), token: currentKey }
    })
  }
  return relationships
}

export function hashResolvedMetadata(value: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

export function chooseCreatorBucket(tags: SourceTagValue[]): string {
  const artists = tags.filter((tag) => tag.namespace === 'artist')
  if (artists.length === 1) return `artist--${safeSegment(artists[0]!.name)}`
  const groups = tags.filter((tag) => tag.namespace === 'group')
  if (artists.length === 0 && groups.length === 1) return `group--${safeSegment(groups[0]!.name)}`
  return artists.length + groups.length > 1 ? '_multiple' : '_unknown'
}

function parseSupportedUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch (error) {
    throw new ArchiveError('INVALID_URL', 'E-Hentai 链接格式无效', { cause: error })
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== GALLERY_HOST || url.username || url.password) {
    throw new ArchiveError('INVALID_URL', '仅支持 https://e-hentai.org 的公开画廊或图片页链接')
  }
  if (!/^\/(?:g|s)\//.test(url.pathname)) {
    throw new ArchiveError('INVALID_URL', '仅支持 /g/... 画廊链接和 /s/... 图片页链接')
  }
  url.hash = ''
  return url
}

function normalizeTags(values: string[]): SourceTagValue[] {
  const unique = new Map<string, SourceTagValue>()
  for (const raw of values) {
    const separator = raw.indexOf(':')
    const namespace = safeNamespace(separator > 0 ? raw.slice(0, separator) : 'general')
    const name = cleanText(separator > 0 ? raw.slice(separator + 1) : raw)
    if (!name) continue
    unique.set(`${namespace}\u0000${name}`, { namespace, name })
  }
  return Array.from(unique.values())
}

function safeNamespace(value: string): string {
  const normalized = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
  return normalized.slice(0, 50) || 'general'
}

function safeSegment(value: string): string {
  const normalized = value.normalize('NFKC').trim().toLowerCase()
  const safe = normalized
    // oxlint-disable-next-line no-control-regex -- 文件路径片段必须去除 C0 控制字符
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 120)
  return safe || '_unknown'
}

function findAllLinks(html: string, baseUrl: string): string[] {
  const values: string[] = []
  const matcher = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi
  for (const match of html.matchAll(matcher)) {
    try {
      values.push(new URL(decodeHtml(match[2]!), baseUrl).toString())
    } catch {
      // 忽略来自远端标记中的格式错误链接。
    }
  }
  return values
}

function findLink(html: string, pattern: RegExp, baseUrl: string): string | null {
  return findAllLinks(html, baseUrl).find((value) => pattern.test(value)) ?? null
}

function findImageById(html: string, id: string, baseUrl: string): string | null {
  const imageTags = html.match(/<img\b[^>]*>/gi) ?? []
  for (const tag of imageTags) {
    const attributes = parseAttributes(tag)
    if (attributes.id !== id || !attributes.src) continue
    try {
      return new URL(decodeHtml(attributes.src), baseUrl).toString()
    } catch {
      return null
    }
  }
  return null
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const matcher = /([a-zA-Z_:][\w:.-]*)\s*=\s*(["'])(.*?)\2/g
  for (const match of tag.matchAll(matcher)) attributes[match[1]!.toLowerCase()] = match[3]!
  return attributes
}

function extractOriginalFilename(html: string): string | null {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const value = cleanText(decodeHtml(title ?? ''))
    .split(' :: ')[0]
    ?.trim()
  if (!value || value.length > 240) return null
  const base = path.basename(value.replace(/[\\/]/g, '-'))
  return base && base !== '.' ? base : null
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function parsePositiveInteger(value: unknown, field: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) {
    const fieldName = field === 'gid' ? '画廊编号' : field === 'filecount' ? '媒体数量' : '必要字段'
    throw new ArchiveError('REMOTE_RESPONSE_INVALID', `E-Hentai 返回的${fieldName}无效`)
  }
  return number
}

function parseUnixTimestamp(value: unknown): Date | null {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null
}

function positiveIntegerOrNull(value: unknown): number | null {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function parseContentLength(value: string | string[] | undefined): number | null {
  const raw = headerValue(value)
  if (!raw) return null
  const length = Number(raw)
  return Number.isSafeInteger(length) && length >= 0 ? length : null
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
