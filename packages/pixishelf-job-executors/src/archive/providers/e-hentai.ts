import { createHash } from 'node:crypto'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { ArchiveError, withArchiveErrorContext } from '../errors.ts'
import { SafeHttpClient, assertSuccessStatus, remoteHostForUrl } from '../safe-http.ts'
import type {
  ArchiveDownloadContext,
  ArchiveProviderContext,
  ArchiveUploaderProvider,
  ArchiveUploaderComparisonSnapshot,
  ArchiveUploaderMetadataChangeField,
  ArchiveUploaderMetadataChangeReason,
  ArchiveUploaderMetadataComparison,
  ArchiveUploaderScanContext,
  ArchiveUploaderScanInput,
  ArchiveUploaderScanResult,
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
const MAX_GDATA_ITEMS = 25
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

interface UploaderSearchCursor {
  version: 1
  url: string
  offset: number
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
    if (relationships.length > 0) warnings.push('检测到 E-Hentai 画廊版本替代关系，将在关联作品存在时建立显式关系')

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

  async scanUploader(
    input: ArchiveUploaderScanInput,
    context: ArchiveUploaderScanContext = {}
  ): Promise<ArchiveUploaderScanResult> {
    const limit = Math.min(MAX_UPLOADER_SCAN_ITEMS, Math.max(1, Math.trunc(input.limit)))
    const searchTerm = uploaderSearchTerm(input)
    let cursor = input.cursor
      ? decodeUploaderSearchCursor(input.cursor, searchTerm)
      : initialUploaderSearchCursor(searchTerm)
    const identities: GallerySearchIdentity[] = []
    const seen = new Set<string>()
    let reachedStop = false
    let nextCursor: string | null = null

    while (identities.length < limit && !reachedStop) {
      const html = await runSearchRequest(context, () =>
        this.http.text(cursor.url, {
          ...(context.signal ? { signal: context.signal } : {}),
          maxBytes: 8 * 1024 * 1024
        })
      )
      const page = parseUploaderSearchPage(html, cursor.url, searchTerm)
      if (page.identities.length === 0 && !page.legitimateEmpty) {
        throw new ArchiveError('REMOTE_RESPONSE_INVALID', 'E-Hentai 搜索页未包含可识别的公开画廊', {
          recoverable: true,
          stage: 'UPLOADER_SEARCH',
          remoteHost: GALLERY_HOST
        })
      }

      let index = cursor.offset
      for (; index < page.identities.length && identities.length < limit; index += 1) {
        const identity = page.identities[index]!
        if (input.stopAtExternalId && String(identity.gid) === input.stopAtExternalId) {
          reachedStop = true
          break
        }
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
            ? encodeUploaderSearchCursor({ ...cursor, offset: index })
            : page.nextUrl
              ? encodeUploaderSearchCursor({ version: 1, url: page.nextUrl, offset: 0 })
              : null
        break
      }
      if (!page.nextUrl) {
        nextCursor = null
        break
      }
      cursor = { version: 1, url: page.nextUrl, offset: 0 }
    }

    const metadata = await this.fetchMetadataBatch(identities, context)
    const items = metadata.map((value) => {
      const uploaderName = cleanText(value.uploader) || null
      if (
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

    return { items, nextCursor, reachedStop }
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
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== GALLERY_HOST || url.username || url.password) {
    throw new ArchiveError('INVALID_URL', '仅支持 https://e-hentai.org 的公开画廊或图片页链接')
  }
  if (!/^\/(?:g|s)\//.test(url.pathname)) {
    throw new ArchiveError('INVALID_URL', '仅支持 /g/... 画廊链接和 /s/... 图片页链接')
  }
  url.hash = ''
  return url
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
  return { version: 1, url: url.toString(), offset: 0 }
}

function encodeUploaderSearchCursor(cursor: UploaderSearchCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function decodeUploaderSearchCursor(value: string, searchTerm: string): UploaderSearchCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as UploaderSearchCursor
    const url = new URL(parsed.url)
    if (
      parsed.version !== 1 ||
      !Number.isSafeInteger(parsed.offset) ||
      parsed.offset < 0 ||
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
    return { version: 1, url: url.toString(), offset: parsed.offset }
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
