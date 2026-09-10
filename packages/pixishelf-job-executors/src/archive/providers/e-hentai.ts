import { createHash } from 'node:crypto'
import {
  archiveTitleQuerySchema,
  archiveTitleSearchTerm,
  getEhentaiVersionNotice,
  matchesArchiveTitle
} from '@pixishelf/job-contracts'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { ArchiveError, withArchiveErrorContext } from '../errors.ts'
import { SafeHttpClient, assertSuccessStatus, remoteHostForUrl } from '../safe-http.ts'
import type {
  ArchiveDownloadContext,
  ArchiveProviderContext,
  ArchiveThumbnail,
  ArchiveThumbnailPage,
  ArchiveThumbnailPageInput,
  ArchiveUploaderProvider,
  ArchiveUploaderComparisonSnapshot,
  ArchiveUploaderMetadataChangeField,
  ArchiveUploaderMetadataChangeReason,
  ArchiveUploaderMetadataComparison,
  ArchiveUploaderScanContext,
  ArchiveUploaderScanInput,
  ArchiveUploaderScanResult,
  ArchiveTitleScanInput,
  RemoteMedia,
  ResolvedArchive,
  ResolvedMedia,
  SourceTagValue
} from '../types.ts'

const PROVIDER_KEY = 'e-hentai'
const GALLERY_HOST = 'e-hentai.org'
const API_URL = 'https://api.e-hentai.org/api.php'
const MAX_GALLERY_PAGES = 500
const MAX_UPLOADER_SCAN_ITEMS = 100
const MAX_SEARCH_PAGE_ITEMS = 10_000
const MAX_SEARCH_CURSOR_LENGTH = 400_000
const MAX_GDATA_ITEMS = 25
const MAX_PREVIEW_ITEMS = 200
const MAX_PREVIEW_URL_LENGTH = 2_048
const MAX_THUMBNAIL_URL_LENGTH = 4_096
const MAX_THUMBNAIL_DIMENSION = 4_096
const MAX_PREVIEW_TOTAL = 1_000_000
const HATH_NETWORK_SUFFIX = 'hath.network'
const THUMBNAIL_HOST_SUFFIXES = ['e-hentai.org', 'ehgt.org', HATH_NETWORK_SUFFIX] as const

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

interface UploaderSearchCursor {
  version: 2
  url: string
  checkedGids: number[]
}

interface GallerySearchIdentity {
  gid: number
  token: string
}

export class EHentaiProvider implements ArchiveUploaderProvider {
  readonly key = PROVIDER_KEY
  readonly requestGovernance = 'PER_REQUEST' as const

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

  async previewPage(
    input: ArchiveThumbnailPageInput,
    context: ArchiveProviderContext = {}
  ): Promise<ArchiveThumbnailPage> {
    if (!Number.isSafeInteger(input.page) || input.page < 0 || input.page >= MAX_GALLERY_PAGES) {
      throw new ArchiveError('INVALID_URL', `E-Hentai 预览页码必须在 0-${MAX_GALLERY_PAGES - 1} 之间`)
    }
    if (typeof input.url !== 'string' || input.url.length > MAX_PREVIEW_URL_LENGTH) {
      throw new ArchiveError('INVALID_URL', 'E-Hentai 预览链接长度无效')
    }
    const submitted = parseSupportedUrl(input.url)
    const gallery = await this.resolveGalleryIdentity(submitted, context)
    const canonicalUrl = `https://${GALLERY_HOST}/g/${gallery.gid}/${gallery.token}/`
    const galleryPageUrl = new URL(canonicalUrl)
    if (input.page > 0) galleryPageUrl.searchParams.set('p', String(input.page))

    return runResolveRequest(context, async () => {
      const html = await this.http.text(galleryPageUrl.toString(), {
        ...(context.signal ? { signal: context.signal } : {}),
        maxBytes: 8 * 1024 * 1024
      })
      assertPreviewPageAvailable(html)
      const parsed = parseGalleryThumbnailPage(html, canonicalUrl, gallery.gid, gallery.token, input.page)
      return {
        providerKey: PROVIDER_KEY,
        externalId: String(gallery.gid),
        canonicalUrl,
        title: parsed.title || `原站作品 #${gallery.gid}`,
        total: parsed.total,
        page: input.page,
        items: parsed.items,
        nextPage: parsed.nextPage
      }
    })
  }

  async scanUploader(
    input: ArchiveUploaderScanInput,
    context: ArchiveUploaderScanContext = {}
  ): Promise<ArchiveUploaderScanResult> {
    return this.scanSearch(input, context)
  }

  async scanTitles(
    input: ArchiveTitleScanInput,
    context: ArchiveUploaderScanContext = {}
  ): Promise<ArchiveUploaderScanResult> {
    const query = archiveTitleQuerySchema.parse(input.query)
    const binding = createHash('sha256')
      .update(JSON.stringify([input.sourceId, archiveTitleSearchTerm(query), query.matchMode]))
      .digest('hex')
    let cursor: string | null = null
    if (input.cursor) {
      try {
        if (input.cursor.length > MAX_SEARCH_CURSOR_LENGTH * 2) throw new Error('oversized cursor')
        const decoded = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))
        if (decoded.version !== 1 || decoded.binding !== binding || typeof decoded.cursor !== 'string')
          throw new Error('invalid cursor')
        cursor = decoded.cursor
      } catch {
        throw new ArchiveError('INVALID_URL', '标题搜索游标与当前来源或条件不一致')
      }
    }
    const result = await this.scanSearch({ ...input, query, cursor }, context)
    return {
      ...result,
      nextCursor: result.nextCursor
        ? Buffer.from(JSON.stringify({ version: 1, binding, cursor: result.nextCursor })).toString('base64url')
        : null
    }
  }

  private async scanSearch(
    input: ArchiveUploaderScanInput | ArchiveTitleScanInput,
    context: ArchiveUploaderScanContext
  ): Promise<ArchiveUploaderScanResult> {
    const limit = Math.min(MAX_UPLOADER_SCAN_ITEMS, Math.max(1, Math.trunc(input.limit)))
    const searchTerm = 'query' in input ? archiveTitleSearchTerm(input.query) : uploaderSearchTerm(input)
    let cursor = input.cursor
      ? decodeUploaderSearchCursor(input.cursor, searchTerm)
      : initialUploaderSearchCursor(searchTerm)
    const identities: GallerySearchIdentity[] = []
    const seen = new Set<string>()
    let reachedStop = false
    let nextCursor: string | null = null
    const visitedPages = new Set<string>()

    while (identities.length < limit && !reachedStop) {
      if (visitedPages.has(cursor.url) || visitedPages.size >= MAX_GALLERY_PAGES) {
        throw new ArchiveError('REMOTE_RESPONSE_INVALID', '搜索分页重复或超出安全范围', { recoverable: true })
      }
      visitedPages.add(cursor.url)
      const html = await runSearchRequest(context, () =>
        this.http.text(cursor.url, {
          ...(context.signal ? { signal: context.signal } : {}),
          maxBytes: 8 * 1024 * 1024
        })
      )
      const page = parseUploaderSearchPage(html, cursor.url, searchTerm)
      if (page.nextUrl && visitedPages.has(page.nextUrl)) {
        throw new ArchiveError('REMOTE_RESPONSE_INVALID', '搜索分页未向前推进', { recoverable: true })
      }
      if (page.identities.length === 0 && !page.legitimateEmpty) {
        throw new ArchiveError('REMOTE_RESPONSE_INVALID', 'E-Hentai 搜索页未包含可识别的公开画廊', {
          recoverable: true,
          stage: 'UPLOADER_SEARCH',
          remoteHost: GALLERY_HOST
        })
      }

      // Page positions shift when galleries are inserted or removed between runs.
      // Retain only stable identities still on this page, never an array offset.
      const previousChecked = new Set(cursor.checkedGids)
      const checkedGids = new Set(page.identities.filter(({ gid }) => previousChecked.has(gid)).map(({ gid }) => gid))
      let index = 0
      for (; index < page.identities.length && identities.length < limit; index += 1) {
        const identity = page.identities[index]!
        if (input.stopAtExternalId && String(identity.gid) === input.stopAtExternalId) {
          reachedStop = true
          break
        }
        if (checkedGids.has(identity.gid)) continue
        checkedGids.add(identity.gid)
        if (seen.has(String(identity.gid))) continue
        seen.add(String(identity.gid))
        identities.push(identity)
      }

      if (reachedStop) {
        nextCursor = null
        break
      }
      if (identities.length >= limit) {
        nextCursor =
          index < page.identities.length
            ? encodeUploaderSearchCursor({ ...cursor, checkedGids: [...checkedGids] })
            : page.nextUrl
              ? encodeUploaderSearchCursor({ version: 2, url: page.nextUrl, checkedGids: [] })
              : null
        break
      }
      if (!page.nextUrl) {
        nextCursor = null
        break
      }
      cursor = { version: 2, url: page.nextUrl, checkedGids: [] }
    }

    const metadata = await this.fetchMetadataBatch(identities, context)
    const items = metadata.map((value) => {
      const uploaderName = cleanText(value.uploader) || null
      if (
        !('query' in input) &&
        input.identityKind === 'NAME' &&
        normalizeUploaderName(uploaderName) !== normalizeUploaderName(input.identityValue)
      ) {
        throw new ArchiveError('REMOTE_RESPONSE_INVALID', 'E-Hentai 搜索结果包含不属于目标上传者的画廊', {
          recoverable: true,
          stage: 'UPLOADER_METADATA',
          remoteHost: 'api.e-hentai.org'
        })
      }
      const gid = parsePositiveInteger(value.gid, 'gid')
      const token = cleanText(value.token)
      if (!token) throw new ArchiveError('REMOTE_RESPONSE_INVALID', 'E-Hentai 访问令牌无效')
      const normalizedMetadata = normalizedDiscoveryMetadata(value, gid)
      const comparisonSnapshot = createArchiveUploaderComparisonSnapshot(normalizedMetadata)
      if (!comparisonSnapshot) throw new ArchiveError('REMOTE_RESPONSE_INVALID', 'E-Hentai 比较元数据无效')
      return {
        ...('query' in input
          ? {
              matchesQuery: matchesArchiveTitle(input.query, [
                decodeHtml(value.title ?? ''),
                decodeHtml(value.title_jpn ?? '')
              ])
            }
          : {}),
        providerKey: PROVIDER_KEY,
        externalId: String(gid),
        canonicalUrl: `https://${GALLERY_HOST}/g/${gid}/${token}/`,
        title: cleanText(value.title_jpn) || cleanText(value.title) || `E-Hentai ${gid}`,
        thumbnailUrl: cleanText(value.thumb) || null,
        uploaderName,
        postedAt: parseUnixTimestamp(value.posted),
        metadataFingerprint: hashArchiveUploaderComparisonMetadata(comparisonSnapshot)!,
        comparisonSnapshot,
        normalizedMetadata,
        relationships: normalizeRelationships(value, gid)
      }
    })

    const discoveredUploaderUid =
      !('query' in input) && input.identityKind === 'NAME' && items[0]
        ? await discoverUploaderUidFromGallery(items[0].canonicalUrl, input.identityValue, this.http, context)
        : null

    return { items, nextCursor, reachedStop, discoveredUploaderUid }
  }

  async openMedia(item: ResolvedMedia, context: ArchiveDownloadContext): Promise<RemoteMedia> {
    let html: string
    try {
      context.onPhase?.('RESOLVING_SOURCE_PAGE')
      html = await runDownloadRequest(context, () =>
        this.http.text(item.sourcePageUrl, {
          ...(context.signal ? { signal: context.signal } : {}),
          maxBytes: 4 * 1024 * 1024,
          headers: { referer: item.sourcePageUrl }
        })
      )
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
      context.onPhase?.('WAITING_MEDIA_RESPONSE')
      const response = await runDownloadStreamRequest(context, async () => {
        const opened = await this.http.request(selectedUrl, {
          ...(context.signal ? { signal: context.signal } : {}),
          headers: { referer: item.sourcePageUrl }
        })
        assertSuccessStatus(opened)
        return opened
      })
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
    const response = await runResolveRequest(context, () =>
      this.http.json<EhTokenResponse>(API_URL, {
        method: 'POST',
        ...(context.signal ? { signal: context.signal } : {}),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'gtoken', pagelist: [[gid, pageMatch[1], pageNumber]] }),
        maxBytes: 4 * 1024 * 1024
      })
    )
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
    const response = await runResolveRequest(context, () =>
      this.http.json<EhApiResponse>(API_URL, {
        method: 'POST',
        ...(context.signal ? { signal: context.signal } : {}),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'gdata', gidlist: [[gid, token]], namespace: 1 }),
        maxBytes: 4 * 1024 * 1024
      })
    )
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

  private async fetchMetadataBatch(
    identities: GallerySearchIdentity[],
    context: ArchiveUploaderScanContext
  ): Promise<EhGalleryMetadata[]> {
    const values: EhGalleryMetadata[] = []
    for (let index = 0; index < identities.length; index += MAX_GDATA_ITEMS) {
      const batch = identities.slice(index, index + MAX_GDATA_ITEMS)
      const response = await runSearchRequest(context, () =>
        this.http.json<EhApiResponse>(API_URL, {
          method: 'POST',
          ...(context.signal ? { signal: context.signal } : {}),
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            method: 'gdata',
            gidlist: batch.map(({ gid, token }) => [gid, token]),
            namespace: 1
          }),
          maxBytes: 8 * 1024 * 1024
        })
      )
      if (response.error) {
        throw new ArchiveError('REMOTE_RESPONSE_INVALID', 'E-Hentai API 返回错误', {
          cause: new Error(response.error)
        })
      }
      const byGid = new Map((response.gmetadata ?? []).map((value) => [Number(value.gid), value]))
      for (const identity of batch) {
        const metadata = byGid.get(identity.gid)
        if (!metadata || metadata.error) {
          throw new ArchiveError('REMOTE_RESPONSE_INVALID', `E-Hentai API 未完整返回画廊 ${identity.gid}`, {
            recoverable: true,
            stage: 'UPLOADER_METADATA',
            remoteHost: 'api.e-hentai.org'
          })
        }
        values.push(metadata)
      }
    }
    return values
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
      const html = await runResolveRequest(context, () =>
        this.http.text(galleryPage.toString(), {
          ...(context.signal ? { signal: context.signal } : {}),
          maxBytes: 8 * 1024 * 1024
        })
      )
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

async function runResolveRequest<T>(context: ArchiveProviderContext, operation: () => Promise<T>): Promise<T> {
  try {
    return await (context.runResolveRequest ? context.runResolveRequest(operation) : operation())
  } catch (error) {
    if (error instanceof ArchiveError) throw error
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new ArchiveError('CANCELLED', 'E-Hentai 解析已取消', { cause: error, recoverable: true })
    }
    throw error
  }
}

async function runSearchRequest<T>(context: ArchiveUploaderScanContext, operation: () => Promise<T>): Promise<T> {
  try {
    return await (context.runSearchRequest ? context.runSearchRequest(operation) : operation())
  } catch (error) {
    if (error instanceof ArchiveError) throw error
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new ArchiveError('CANCELLED', 'E-Hentai 上传者扫描已取消', { cause: error, recoverable: true })
    }
    throw error
  }
}

function runDownloadRequest<T>(context: ArchiveDownloadContext, operation: () => Promise<T>): Promise<T> {
  return context.runDownloadRequest ? context.runDownloadRequest(operation) : operation()
}

function runDownloadStreamRequest<T extends { stream: Readable }>(
  context: ArchiveDownloadContext,
  operation: () => Promise<T>
): Promise<T> {
  return context.runDownloadStreamRequest ? context.runDownloadStreamRequest(operation) : operation()
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

export function createArchiveUploaderComparisonSnapshot(value: unknown): ArchiveUploaderComparisonSnapshot | null {
  if (!isRecord(value)) return null
  const requiredFields = [
    'titles',
    'category',
    'uploader',
    'postedAt',
    'fileCount',
    'fileSize',
    'expunged',
    'tags',
    'relationships'
  ] as const
  if (requiredFields.some((field) => !Object.hasOwn(value, field))) return null

  const titles = value.titles
  if (!isRecord(titles) || typeof titles.display !== 'string' || !Array.isArray(titles.aliases)) return null
  if (!titles.aliases.every((alias) => typeof alias === 'string')) return null
  const display = cleanText(titles.display)
  if (!display) return null

  const category = nullableNormalizedText(value.category)
  const uploader = nullableNormalizedText(value.uploader)
  const postedAt = normalizeComparisonTimestamp(value.postedAt)
  if (category === undefined || uploader === undefined || postedAt === undefined) return null
  if (!Number.isSafeInteger(value.fileCount) || (value.fileCount as number) <= 0) return null
  if (value.fileSize !== null && (!Number.isSafeInteger(value.fileSize) || (value.fileSize as number) < 0)) return null
  if (typeof value.expunged !== 'boolean' || !Array.isArray(value.tags) || !Array.isArray(value.relationships)) {
    return null
  }

  const tags = value.tags.map(normalizeComparisonTag)
  const relationships = value.relationships.map(normalizeComparisonRelationship)
  if (tags.some((tag) => tag === null) || relationships.some((relationship) => relationship === null)) return null

  return {
    schemaVersion: 1,
    titles: {
      display,
      aliases: sortedUnique(titles.aliases.map((alias) => cleanText(alias)).filter(Boolean))
    },
    category,
    uploader,
    postedAt,
    fileCount: value.fileCount as number,
    fileSize: value.fileSize as number | null,
    expunged: value.expunged,
    tags: uniqueSortedObjects(tags as SourceTagValue[]),
    relationships: uniqueSortedObjects(relationships as ArchiveUploaderComparisonSnapshot['relationships'])
  }
}

export function hashArchiveUploaderComparisonMetadata(value: unknown): string | null {
  const snapshot = createArchiveUploaderComparisonSnapshot(value)
  return snapshot ? createHash('sha256').update(stableStringify(snapshot)).digest('hex') : null
}

export function hashArchiveUploaderDiscoveryMetadata(value: unknown): string | null {
  return hashArchiveUploaderComparisonMetadata(value)
}

export function compareArchiveUploaderMetadata(
  previousValue: unknown,
  currentValue: unknown
): ArchiveUploaderMetadataComparison | null {
  const previous = createArchiveUploaderComparisonSnapshot(previousValue)
  const current = createArchiveUploaderComparisonSnapshot(currentValue)
  if (!previous || !current) return null
  const changeReasons: ArchiveUploaderMetadataChangeReason[] = []

  addComparisonReason(changeReasons, 'titles', previous.titles, current.titles, '标题或别名变化')
  addScalarComparisonReason(changeReasons, 'category', previous.category, current.category, '分类')
  addScalarComparisonReason(changeReasons, 'uploader', previous.uploader, current.uploader, '上传者')
  addScalarComparisonReason(changeReasons, 'postedAt', previous.postedAt, current.postedAt, '发布时间')
  addScalarComparisonReason(changeReasons, 'fileCount', previous.fileCount, current.fileCount, '页数')
  addScalarComparisonReason(changeReasons, 'fileSize', previous.fileSize, current.fileSize, '文件大小')
  addScalarComparisonReason(changeReasons, 'expunged', previous.expunged, current.expunged, '下架状态')
  addComparisonReason(changeReasons, 'tags', previous.tags, current.tags, '标签变化')
  addComparisonReason(changeReasons, 'relationships', previous.relationships, current.relationships, '版本关系变化')

  return { previous, current, changeReasons }
}

function addScalarComparisonReason(
  target: ArchiveUploaderMetadataChangeReason[],
  field: ArchiveUploaderMetadataChangeField,
  previous: string | number | boolean | null,
  current: string | number | boolean | null,
  label: string
) {
  if (previous === current) return
  target.push({ field, message: `${label} ${displayComparisonValue(previous)} → ${displayComparisonValue(current)}` })
}

function addComparisonReason(
  target: ArchiveUploaderMetadataChangeReason[],
  field: ArchiveUploaderMetadataChangeField,
  previous: unknown,
  current: unknown,
  message: string
) {
  if (stableStringify(previous) !== stableStringify(current)) target.push({ field, message })
}

function displayComparisonValue(value: string | number | boolean | null): string {
  if (value === null) return '无'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nullableNormalizedText(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  return cleanText(value) || null
}

function normalizeComparisonTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const timestamp = new Date(value)
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString()
}

function normalizeComparisonTag(value: unknown): SourceTagValue | null {
  if (!isRecord(value) || typeof value.namespace !== 'string' || typeof value.name !== 'string') return null
  const namespace = cleanText(value.namespace).toLocaleLowerCase('en-US')
  const name = cleanText(value.name)
  return namespace && name ? { namespace, name } : null
}

function normalizeComparisonRelationship(
  value: unknown
): ArchiveUploaderComparisonSnapshot['relationships'][number] | null {
  if (
    !isRecord(value) ||
    value.type !== 'REPLACES' ||
    (value.direction !== 'OUTBOUND' && value.direction !== 'INBOUND') ||
    typeof value.providerKey !== 'string' ||
    typeof value.externalId !== 'string'
  ) {
    return null
  }
  const providerKey = cleanText(value.providerKey).toLocaleLowerCase('en-US')
  const externalId = cleanText(value.externalId)
  return providerKey && externalId ? { type: value.type, direction: value.direction, providerKey, externalId } : null
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en-US'))
}

function uniqueSortedObjects<T>(values: T[]): T[] {
  const keyed = new Map(values.map((value) => [stableStringify(value), value]))
  return [...keyed.entries()].sort(([left], [right]) => left.localeCompare(right, 'en-US')).map(([, value]) => value)
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
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== GALLERY_HOST ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new ArchiveError('INVALID_URL', '仅支持 https://e-hentai.org 的公开画廊或图片页链接')
  }
  if (!/^\/(?:g|s)\//.test(url.pathname)) {
    throw new ArchiveError('INVALID_URL', '仅支持 /g/... 画廊链接和 /s/... 图片页链接')
  }
  url.hash = ''
  return url
}

interface PreviewHtmlElement {
  name: string
  attributes: Record<string, string>
  isThumbnailEntry: boolean
  matchedSourceAnchor: boolean
}

interface PendingPreviewThumbnail {
  ordinal: number
  dimensionSources: Array<Record<string, string>>
  imageSources: Array<Record<string, string>>
}

function assertPreviewPageAvailable(html: string) {
  if (
    !/<(?:div|section)\b[^>]*\bid\s*=\s*(["'])gdt\1/i.test(html) &&
    /you are opening pages too fast|your ip address has been temporarily banned|excessive page\s*loads which indicates that you are using automated access/i.test(
      cleanText(decodeHtml(html.replace(/<[^>]+>/g, ' ')))
    )
  ) {
    throw new ArchiveError('REMOTE_RATE_LIMITED', 'E-Hentai 暂时限制了画廊页面访问，请稍后重试', {
      recoverable: true,
      retryAfterMs: 30_000,
      stage: 'SOURCE_PAGE',
      remoteHost: `${GALLERY_HOST}:443`
    })
  }
}

function parseGalleryThumbnailPage(
  html: string,
  canonicalUrl: string,
  gid: number,
  galleryToken: string,
  page: number
): { title: string; total: number | null; items: ArchiveThumbnail[]; nextPage: number | null } {
  const stack: PreviewHtmlElement[] = []
  const thumbnails = new Map<number, ArchiveThumbnail>()
  let pending: PendingPreviewThumbnail | null = null
  let hasExactNextPage = false
  const tagMatcher = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>/g

  for (const match of html.matchAll(tagMatcher)) {
    const tag = match[0]
    const closing = tag.match(/^<\s*\/\s*([a-zA-Z][\w:-]*)/)
    if (closing) {
      const name = closing[1]!.toLowerCase()
      if (name === 'a' && pending) {
        addPreviewThumbnail(thumbnails, finalizePreviewThumbnail(pending, canonicalUrl))
        pending = null
      }
      popHtmlStack(stack, name)
      continue
    }

    const opening = tag.match(/^<\s*([a-zA-Z][\w:-]*)/)
    if (!opening) continue
    const name = opening[1]!.toLowerCase()
    const attributes = parseAttributes(tag)

    if (name === 'a' && attributes.href) {
      if (galleryPageNumber(attributes.href, canonicalUrl, gid, galleryToken) === page + 1) {
        hasExactNextPage = true
      }
      const ordinal = sourcePageOrdinal(attributes.href, canonicalUrl, gid)
      const insideThumbnail = stack.some(({ attributes: ancestor }) => isThumbnailContainer(ancestor))
      if (insideThumbnail && ordinal === null) {
        throw invalidPreviewPage('E-Hentai 画廊缩略图指向了无法验证的图片页')
      }
      if (ordinal !== null && insideThumbnail) {
        const entry = stack
          .slice()
          .reverse()
          .find((element) => element.isThumbnailEntry)
        if (entry) entry.matchedSourceAnchor = true
        if (pending) {
          throw invalidPreviewPage('E-Hentai 画廊缩略图标记发生了意外嵌套')
        }
        pending = {
          ordinal,
          dimensionSources: stack
            .slice()
            .reverse()
            .map(({ attributes: ancestor }) => ancestor),
          imageSources: []
        }
      }
    } else if (pending) {
      if (attributes.style) pending.dimensionSources.unshift(attributes)
      if (name === 'img') pending.imageSources.push(attributes)
    }

    if (!VOID_HTML_ELEMENTS.has(name) && !/\/\s*>$/.test(tag)) {
      stack.push({
        name,
        attributes,
        isThumbnailEntry: isNamedThumbnailEntry(attributes),
        matchedSourceAnchor: false
      })
    }
  }

  if (pending) {
    throw invalidPreviewPage('E-Hentai 画廊缩略图标记未完整结束')
  }
  if (stack.some((element) => element.isThumbnailEntry && !element.matchedSourceAnchor)) {
    throw invalidPreviewPage('E-Hentai 画廊包含未完整结束的缩略图条目')
  }
  const items = [...thumbnails.values()].sort((left, right) => left.ordinal - right.ordinal)
  if (items.length === 0) {
    throw invalidPreviewPage('E-Hentai 画廊页未包含可识别的缩略图')
  }
  if (items.length > MAX_PREVIEW_ITEMS) {
    throw invalidPreviewPage(`E-Hentai 单页缩略图超过 ${MAX_PREVIEW_ITEMS} 个安全限制`)
  }
  for (let index = 1; index < items.length; index += 1) {
    if (items[index]!.ordinal !== items[index - 1]!.ordinal + 1) {
      throw invalidPreviewPage('E-Hentai 画廊页缩略图序号不连续')
    }
  }
  const total = parseGalleryTotal(html)
  if (page === 0 && items[0]!.ordinal !== 0) {
    throw invalidPreviewPage('E-Hentai 画廊首页未从第一张缩略图开始')
  }
  if (total !== null && items.at(-1)!.ordinal >= total) {
    throw invalidPreviewPage('E-Hentai 画廊页缩略图序号超出声明总数')
  }
  if (total !== null) {
    const reachedEnd = items.at(-1)!.ordinal === total - 1
    if (reachedEnd && hasExactNextPage) {
      throw invalidPreviewPage('E-Hentai 画廊分页与声明总数冲突')
    }
    if (!reachedEnd && !hasExactNextPage) {
      throw invalidPreviewPage('E-Hentai 画廊仍有缩略图但缺少下一页')
    }
  }
  return {
    title: parseGalleryTitle(html),
    total,
    items,
    nextPage: hasExactNextPage ? page + 1 : null
  }
}

const VOID_HTML_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source'])

function popHtmlStack(stack: PreviewHtmlElement[], name: string) {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index]!.name !== name) continue
    for (const element of stack.slice(index)) {
      if (element.isThumbnailEntry && !element.matchedSourceAnchor) {
        throw invalidPreviewPage('E-Hentai 画廊包含无法识别的缩略图条目')
      }
    }
    stack.length = index
    return
  }
}

function isThumbnailContainer(attributes: Record<string, string>) {
  if (attributes.id?.toLowerCase() === 'gdt') return true
  return isNamedThumbnailEntry(attributes)
}

function isNamedThumbnailEntry(attributes: Record<string, string>) {
  return cleanText(attributes.class)
    .toLowerCase()
    .split(' ')
    .some((className) => className === 'gdtl' || className === 'gdtm')
}

function sourcePageOrdinal(rawHref: string, baseUrl: string, gid: number): number | null {
  let url: URL
  try {
    url = new URL(decodeHtml(rawHref), baseUrl)
  } catch {
    return null
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== GALLERY_HOST ||
    url.username ||
    url.password ||
    url.port
  ) {
    return null
  }
  const match = url.pathname.match(/^\/s\/[a-z0-9]+\/(\d+)-(\d+)(?:\/|$)/i)
  if (!match || Number(match[1]) !== gid) return null
  const sourcePage = Number(match[2])
  return Number.isSafeInteger(sourcePage) && sourcePage > 0 && sourcePage <= MAX_PREVIEW_TOTAL ? sourcePage - 1 : null
}

function galleryPageNumber(
  rawHref: string,
  baseUrl: string,
  gid: number,
  galleryToken: string
): number | null {
  let url: URL
  try {
    url = new URL(decodeHtml(rawHref), baseUrl)
  } catch {
    return null
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== GALLERY_HOST ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== `/g/${gid}/${galleryToken}/`
  ) {
    return null
  }
  if (!url.searchParams.has('p')) return 0
  const rawPage = url.searchParams.get('p')
  if (!rawPage || !/^\d{1,3}$/.test(rawPage)) return null
  const value = Number(rawPage)
  return Number.isSafeInteger(value) && value >= 0 && value < MAX_GALLERY_PAGES ? value : null
}

function finalizePreviewThumbnail(pending: PendingPreviewThumbnail, baseUrl: string): ArchiveThumbnail {
  const spriteSources = pending.dimensionSources.filter(({ style }) => style && /\burl\(/i.test(style))
  const parsedSprites = spriteSources.map((attributes) =>
    parseSpriteThumbnail(attributes, baseUrl, pending.ordinal)
  )
  if (parsedSprites.some((value) => value === null)) {
    throw invalidPreviewPage(`E-Hentai 第 ${pending.ordinal + 1} 张缩略图的裁剪信息无效`)
  }
  const spriteCandidates = uniqueThumbnails(parsedSprites as ArchiveThumbnail[])
  if (spriteCandidates.length > 1) {
    throw invalidPreviewPage(`E-Hentai 第 ${pending.ordinal + 1} 张缩略图包含冲突的裁剪信息`)
  }
  if (spriteCandidates[0]) return spriteCandidates[0]

  const imageSources = pending.imageSources.filter(
    (attributes) => attributes['data-src'] || attributes['data-original'] || attributes.src
  )
  const parsedImages = imageSources.map((attributes) => {
      const rawUrl = attributes['data-src'] || attributes['data-original'] || attributes.src
      if (!rawUrl) return null
      const url = validatedThumbnailUrl(rawUrl, baseUrl)
      const dimensions = parseVisibleDimensions([attributes, ...pending.dimensionSources])
      if (!url || !dimensions) return null
      return { ordinal: pending.ordinal, url, ...dimensions }
    })
  if (parsedImages.some((value) => value === null)) {
    throw invalidPreviewPage(`E-Hentai 第 ${pending.ordinal + 1} 张缩略图包含无效图片`)
  }
  const imageCandidates = uniqueThumbnails(parsedImages as ArchiveThumbnail[])
  if (imageSources.length === 0 || imageCandidates.length !== 1) {
    throw invalidPreviewPage(`E-Hentai 第 ${pending.ordinal + 1} 张缩略图缺少唯一且安全的图片描述`)
  }
  return imageCandidates[0]!
}

function parseSpriteThumbnail(
  attributes: Record<string, string>,
  baseUrl: string,
  ordinal: number
): ArchiveThumbnail | null {
  const style = attributes.style
  if (!style) return null
  const rawUrl = style.match(/\burl\(\s*(["']?)(.*?)\1\s*\)/i)?.[2]
  if (!rawUrl) return null
  const url = validatedThumbnailUrl(rawUrl, baseUrl)
  const dimensions = parseVisibleDimensions([attributes])
  const position = parseBackgroundPosition(style)
  if (!url || !dimensions || !position) return null
  return {
    ordinal,
    url,
    ...dimensions,
    crop: { x: position.x, y: position.y, width: dimensions.width, height: dimensions.height }
  }
}

function parseBackgroundPosition(style: string): { x: number; y: number } | null {
  const declarations = parseStyleDeclarations(style)
  const explicit = declarations['background-position']
  const shorthand = declarations.background
  const shorthandUrl = shorthand?.match(/\burl\(\s*(["']?)(.*?)\1\s*\)/i)
  if (!shorthandUrl) return null
  const rawPosition = explicit ?? shorthand!.replace(shorthandUrl[0], ' ').split('/')[0]!
  const match = rawPosition.match(
    /(?:^|\s)(0|-?\d+(?:\.\d+)?px)\s+(0|-?\d+(?:\.\d+)?px)(?=\s|$)/i
  )
  if (!match) {
    return /(?:%|\b-?\d+(?:\.\d+)?px\b)/i.test(rawPosition) ? null : { x: 0, y: 0 }
  }
  const xPosition = Number.parseFloat(match[1]!)
  const yPosition = Number.parseFloat(match[2]!)
  if (xPosition > 0 || yPosition > 0) return null
  const x = Math.abs(xPosition)
  const y = Math.abs(yPosition)
  return validPixelValue(x, true) && validPixelValue(y, true) ? { x, y } : null
}

function parseVisibleDimensions(sources: Array<Record<string, string>>): { width: number; height: number } | null {
  for (const attributes of sources) {
    const declarations = parseStyleDeclarations(attributes.style ?? '')
    const width = parsePixelValue(attributes.width ?? declarations.width)
    const height = parsePixelValue(attributes.height ?? declarations.height)
    if (width !== null && height !== null) return { width, height }
  }
  return null
}

function parseStyleDeclarations(style: string): Record<string, string> {
  const declarations: Record<string, string> = {}
  for (const declaration of style.split(';')) {
    const separator = declaration.indexOf(':')
    if (separator <= 0) continue
    declarations[declaration.slice(0, separator).trim().toLowerCase()] = declaration.slice(separator + 1).trim()
  }
  return declarations
}

function parsePixelValue(raw: string | undefined): number | null {
  if (!raw || !/^\d+(?:\.\d+)?(?:px)?$/i.test(raw.trim())) return null
  const value = Number.parseFloat(raw)
  return validPixelValue(value, false) ? value : null
}

function validPixelValue(value: number, allowZero: boolean) {
  return Number.isFinite(value) && (allowZero ? value >= 0 : value > 0) && value <= MAX_THUMBNAIL_DIMENSION
}

function validatedThumbnailUrl(rawUrl: string, baseUrl: string): string | null {
  if (rawUrl.length > MAX_THUMBNAIL_URL_LENGTH) return null
  let url: URL
  try {
    url = new URL(decodeHtml(rawUrl), baseUrl)
  } catch {
    return null
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !THUMBNAIL_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)) ||
    /^\/(?:s\/|fullimg\.php(?:\/|$))/i.test(url.pathname)
  ) {
    return null
  }
  url.search = ''
  url.hash = ''
  return url.toString()
}

function uniqueThumbnails(values: ArchiveThumbnail[]): ArchiveThumbnail[] {
  return [...new Map(values.map((value) => [stableStringify(value), value])).values()]
}

function addPreviewThumbnail(target: Map<number, ArchiveThumbnail>, thumbnail: ArchiveThumbnail) {
  const existing = target.get(thumbnail.ordinal)
  if (existing && stableStringify(existing) !== stableStringify(thumbnail)) {
    throw invalidPreviewPage(`E-Hentai 第 ${thumbnail.ordinal + 1} 张缩略图重复且内容冲突`)
  }
  target.set(thumbnail.ordinal, thumbnail)
  if (target.size > MAX_PREVIEW_ITEMS) {
    throw invalidPreviewPage(`E-Hentai 单页缩略图超过 ${MAX_PREVIEW_ITEMS} 个安全限制`)
  }
}

function parseGalleryTitle(html: string): string {
  for (const id of ['gj', 'gn']) {
    const matcher = new RegExp(
      `<(?:h[1-6]|div)\\b[^>]*\\bid\\s*=\\s*(["'])${id}\\1[^>]*>([\\s\\S]*?)<\\/(?:h[1-6]|div)>`,
      'i'
    )
    const value = cleanText(decodeHtml((html.match(matcher)?.[2] ?? '').replace(/<[^>]+>/g, ' ')))
    if (value) return value.slice(0, 500)
  }
  return ''
}

function parseGalleryTotal(html: string): number | null {
  const candidateBlocks = [
    html.match(/<div\b[^>]*\bid\s*=\s*(["'])gdd\1[^>]*>([\s\S]*?)<\/div>/i)?.[2] ?? '',
    html
  ]
  let foundPageCount = false
  for (const block of candidateBlocks) {
    for (const match of block.matchAll(/>([\d,]+)\s+pages?\s*</gi)) {
      foundPageCount = true
      const value = Number(match[1]!.replaceAll(',', ''))
      if (Number.isSafeInteger(value) && value > 0 && value <= MAX_PREVIEW_TOTAL) return value
    }
  }
  if (foundPageCount) throw invalidPreviewPage('E-Hentai 画廊声明的缩略图总数无效')
  return null
}

function invalidPreviewPage(message: string) {
  return new ArchiveError('REMOTE_RESPONSE_INVALID', message, {
    recoverable: true,
    stage: 'SOURCE_PAGE',
    remoteHost: `${GALLERY_HOST}:443`
  })
}

function uploaderSearchTerm(input: ArchiveUploaderScanInput): string {
  if (input.identityKind === 'UID') {
    if (!/^\d{1,20}$/.test(input.identityValue) || BigInt(input.identityValue) <= 0n) {
      throw new ArchiveError('INVALID_URL', 'E-Hentai 上传者 UID 必须是正整数')
    }
    return `uploaduid:${input.identityValue}`
  }
  const value = input.identityValue.normalize('NFKC').trim()
  // oxlint-disable-next-line no-control-regex -- 查询语法必须拒绝控制字符
  if (!value || value.length > 180 || /["\u0000-\u001f\u007f]/.test(value)) {
    throw new ArchiveError('INVALID_URL', 'E-Hentai 上传者名称无效')
  }
  return `uploader:"${value}"`
}

function initialUploaderSearchCursor(searchTerm: string): UploaderSearchCursor {
  const url = new URL(`https://${GALLERY_HOST}/`)
  url.searchParams.set('f_search', searchTerm)
  return { version: 2, url: url.toString(), checkedGids: [] }
}

function encodeUploaderSearchCursor(cursor: UploaderSearchCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function decodeUploaderSearchCursor(value: string, searchTerm: string): UploaderSearchCursor {
  try {
    if (value.length > MAX_SEARCH_CURSOR_LENGTH) throw new Error('oversized cursor')
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.url !== 'string') {
      throw new Error('invalid cursor shape')
    }
    let checkedGids: number[]
    if (parsed.version === 1 && Number.isSafeInteger(parsed.offset) && parsed.offset >= 0) {
      // Legacy offsets carry no stable identity evidence. Replay this page once;
      // the next successful run writes v2 progress instead of risking skipped items.
      checkedGids = []
    } else if (
      parsed.version === 2 &&
      Array.isArray(parsed.checkedGids) &&
      parsed.checkedGids.length <= MAX_SEARCH_PAGE_ITEMS &&
      parsed.checkedGids.every((gid: unknown) => typeof gid === 'number' && Number.isSafeInteger(gid) && gid > 0) &&
      new Set(parsed.checkedGids).size === parsed.checkedGids.length
    ) {
      checkedGids = parsed.checkedGids
    } else {
      throw new Error('invalid cursor progress')
    }
    const allowedKeys = parsed.version === 1 ? ['version', 'url', 'offset'] : ['version', 'url', 'checkedGids']
    if (Object.keys(parsed).some((key) => !allowedKeys.includes(key))) throw new Error('invalid cursor fields')
    const url = new URL(parsed.url)
    if (
      url.protocol !== 'https:' ||
      url.hostname.toLowerCase() !== GALLERY_HOST ||
      url.pathname !== '/' ||
      url.username ||
      url.password ||
      url.port ||
      url.searchParams.get('f_search') !== searchTerm
    ) {
      throw new Error('上传者搜索游标无效')
    }
    url.hash = ''
    return { version: 2, url: url.toString(), checkedGids }
  } catch (error) {
    throw new ArchiveError('INVALID_URL', 'E-Hentai 上传者扫描游标无效', { cause: error })
  }
}

function parseUploaderSearchPage(html: string, baseUrl: string, searchTerm: string) {
  const identities: GallerySearchIdentity[] = []
  const seen = new Set<number>()
  let nextUrl: string | null = null
  const anchorMatcher = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  for (const match of html.matchAll(anchorMatcher)) {
    const attributes = parseAttributes(`<a ${match[1] ?? ''}>`)
    if (!attributes.href) continue
    let url: URL
    try {
      url = new URL(decodeHtml(attributes.href), baseUrl)
    } catch {
      continue
    }
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== GALLERY_HOST) continue
    const galleryMatch = url.pathname.match(/^\/g\/(\d+)\/([a-z0-9]+)(?:\/|$)/i)
    if (galleryMatch) {
      const gid = Number(galleryMatch[1])
      if (Number.isSafeInteger(gid) && gid > 0 && !seen.has(gid)) {
        seen.add(gid)
        identities.push({ gid, token: galleryMatch[2]! })
        if (identities.length > MAX_SEARCH_PAGE_ITEMS) {
          throw new ArchiveError('REMOTE_RESPONSE_INVALID', '搜索页画廊数量超出安全范围', { recoverable: true })
        }
      }
    }
    const label = cleanText(decodeHtml((match[2] ?? '').replace(/<[^>]+>/g, ' '))).toLowerCase()
    if (
      !nextUrl &&
      (attributes.id?.toLowerCase() === 'unext' ||
        attributes.rel?.toLowerCase() === 'next' ||
        label === 'next' ||
        label === '>') &&
      url.pathname === '/' &&
      url.searchParams.get('f_search') === searchTerm
    ) {
      nextUrl = url.toString()
    }
  }
  return {
    identities,
    nextUrl,
    legitimateEmpty: /\b(?:no hits found|no matching galleries|no results found)\b/i.test(cleanText(html))
  }
}

async function discoverUploaderUidFromGallery(
  canonicalUrl: string,
  expectedUploaderName: string,
  http: SafeHttpClient,
  context: ArchiveUploaderScanContext
): Promise<string | null> {
  const html = await runSearchRequest(context, () =>
    http.text(canonicalUrl, {
      ...(context.signal ? { signal: context.signal } : {}),
      maxBytes: 8 * 1024 * 1024
    })
  )
  return parseUploaderUidFromGalleryPage(html, canonicalUrl, expectedUploaderName)
}

export function parseUploaderUidFromGalleryPage(
  html: string,
  baseUrl: string,
  expectedUploaderName: string
): string | null {
  const uploaderBlock = html.match(
    /<div\b[^>]*(?:(?:id|class)\s*=\s*(["'])[^"']*\bgdn\b[^"']*\1)[^>]*>([\s\S]*?)<\/div>/i
  )?.[2]
  if (!uploaderBlock) return null

  let pageUploaderName: string | null = null
  let uploaderUid: string | null = null
  const anchorMatcher = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  for (const match of uploaderBlock.matchAll(anchorMatcher)) {
    const attributes = parseAttributes(`<a ${match[1] ?? ''}>`)
    if (!attributes.href) continue
    let url: URL
    try {
      url = new URL(decodeHtml(attributes.href), baseUrl)
    } catch {
      continue
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) continue
    if (url.hostname.toLowerCase() === GALLERY_HOST) {
      const nameMatch = url.pathname.match(/^\/uploader\/([^/]+)\/?$/i)
      if (nameMatch) {
        try {
          pageUploaderName = decodeURIComponent(nameMatch[1]!.replaceAll('+', ' '))
        } catch {
          pageUploaderName = cleanText(decodeHtml((match[2] ?? '').replace(/<[^>]+>/g, ' '))) || null
        }
      }
      continue
    }
    if (url.hostname.toLowerCase() !== 'forums.e-hentai.org' || url.pathname !== '/index.php') continue
    const showUser = url.searchParams.get('showuser')
    if (showUser && /^\d{1,20}$/.test(showUser) && BigInt(showUser) > 0n) {
      uploaderUid = BigInt(showUser).toString(10)
    }
  }

  return pageUploaderName &&
    uploaderUid &&
    normalizeUploaderName(pageUploaderName) === normalizeUploaderName(expectedUploaderName)
    ? uploaderUid
    : null
}

function normalizedDiscoveryMetadata(metadata: EhGalleryMetadata, gid: number): Record<string, unknown> {
  const title = cleanText(metadata.title_jpn) || cleanText(metadata.title) || `E-Hentai ${gid}`
  const aliases = Array.from(
    new Set([cleanText(metadata.title), cleanText(metadata.title_jpn)].filter(Boolean))
  ).filter((value) => value !== title)
  return {
    schemaVersion: 1,
    gid: String(gid),
    titles: { display: title, aliases },
    category: cleanText(metadata.category) || null,
    uploader: cleanText(metadata.uploader) || null,
    thumbnailUrl: cleanText(metadata.thumb) || null,
    postedAt: parseUnixTimestamp(metadata.posted)?.toISOString() ?? null,
    fileCount: parsePositiveInteger(metadata.filecount, 'filecount'),
    fileSize: typeof metadata.filesize === 'number' ? metadata.filesize : null,
    rating: cleanText(metadata.rating) || null,
    expunged: metadata.expunged === true,
    tags: normalizeTags(metadata.tags ?? []),
    relationships: normalizeRelationships(metadata, gid)
  }
}

function normalizeUploaderName(value: string | null): string {
  return value?.normalize('NFKC').trim().toLocaleLowerCase('en-US') ?? ''
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
