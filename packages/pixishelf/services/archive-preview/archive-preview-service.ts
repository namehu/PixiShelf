import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import type { PrismaClient } from '@pixishelf/db'
import {
  createDefaultArchiveMediaProviderRegistry,
  GovernedArchiveProviderRegistry,
  PostgresArchiveProviderGovernor,
  type ArchiveProvider,
  type ArchiveThumbnailPage,
  type ArchiveUploaderProviderRegistry
} from '@pixishelf/job-executors'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ArchiveError, type ArchiveErrorCode } from '@/services/archive/errors'
import type {
  ArchivePreviewPageDto,
  ArchivePreviewSourceDto,
  ArchivePreviewThumbnailDto,
  OpenArchivePreviewDto
} from './archive-preview-types'

export type {
  ArchivePreviewPageDto,
  ArchivePreviewSourceDto,
  ArchivePreviewThumbnailDto,
  ArchivePreviewSourceInput,
  OpenArchivePreviewDto
} from './archive-preview-types'

const SESSION_IDLE_TTL_MS = 30 * 60_000
const PAGE_CACHE_TTL_MS = 5 * 60_000
const MAX_SESSIONS = 128
const MAX_CACHE_PAGES = 256
const MAX_CACHE_IN_FLIGHT = 64
const MAX_PAGES_PER_SESSION = 100
const MAX_THUMBNAILS_PER_PAGE = 200
const MAX_SESSION_PAGES_TOTAL = 512
const MAX_SESSION_THUMBNAILS_TOTAL = 20_000
const MAX_GALLERY_ITEMS = 1_000_000
const MAX_DIMENSION = 20_000
const THUMBNAIL_HOST_SUFFIXES = ['e-hentai.org', 'ehgt.org', 'hath.network'] as const

const opaqueIdSchema = z.string().trim().min(1).max(128)

export const listArchivePreviewSourcesSchema = z.object({ artworkId: z.number().int().positive() }).strict()

export const archivePreviewSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('artwork'), externalRefId: opaqueIdSchema }).strict(),
  z.object({ kind: z.literal('task'), taskId: opaqueIdSchema }).strict(),
  z.object({ kind: z.literal('intake'), itemId: opaqueIdSchema }).strict(),
  z.object({ kind: z.literal('catalog'), itemId: opaqueIdSchema }).strict(),
  z.object({ kind: z.literal('url'), url: z.string().trim().min(1).max(2_048) }).strict()
])

export const openArchivePreviewSchema = z.object({ source: archivePreviewSourceSchema }).strict()
export const getArchivePreviewPageSchema = z
  .object({
    previewId: opaqueIdSchema,
    page: z
      .number()
      .int()
      .min(0)
      .max(MAX_PAGES_PER_SESSION - 1)
  })
  .strict()
export const reloadArchivePreviewSchema = z.object({ previewId: opaqueIdSchema }).strict()

interface PreviewIdentity {
  providerKey: string
  externalId: string
  canonicalUrl: string
}

interface ResolvedPreviewSource {
  inputUrl: string
  expectedProviderKey: string
  expectedExternalId: string
  expectedCanonicalUrl: string | null
}

interface ValidatedPreviewPage extends ArchivePreviewPageDto, PreviewIdentity {}

interface ArchivePreviewSession extends PreviewIdentity {
  id: string
  userId: string
  updatedAt: number
  generation: number
  pages: Map<number, ArchivePreviewPageDto>
  cacheIdentities: Set<string>
  inFlight: {
    page: number
    generation: number
    promise: Promise<ArchivePreviewPageDto>
  } | null
}

interface CacheEntry {
  expiresAt: number
  value: ValidatedPreviewPage
}

interface CacheFlight {
  invalidated: boolean
  promise: Promise<ValidatedPreviewPage>
}

export interface ArchivePreviewServiceDependencies {
  database?: PrismaClient
  providers?: ArchiveUploaderProviderRegistry
  store?: ArchivePreviewStore
  now?: () => Date
  createId?: () => string
}

interface ArchivePreviewStoreOptions {
  now?: () => number
  sessionIdleTtlMs?: number
  pageCacheTtlMs?: number
  maxSessions?: number
  maxCachePages?: number
  maxCacheInFlight?: number
  maxPagesPerSession?: number
  maxSessionPagesTotal?: number
  maxSessionThumbnailsTotal?: number
}

/** Process-local, bounded preview state. A restart intentionally invalidates every opaque preview id. */
export class ArchivePreviewStore {
  private readonly sessions = new Map<string, ArchivePreviewSession>()
  private readonly cache = new Map<string, CacheEntry>()
  private readonly cacheFlights = new Map<string, CacheFlight>()
  private activeCacheFlights = 0
  private readonly now: () => number
  private readonly sessionIdleTtlMs: number
  private readonly pageCacheTtlMs: number
  private readonly maxSessions: number
  private readonly maxCachePages: number
  private readonly maxCacheInFlight: number
  private readonly maxPagesPerSession: number
  private readonly maxSessionPagesTotal: number
  private readonly maxSessionThumbnailsTotal: number

  constructor(options: ArchivePreviewStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.sessionIdleTtlMs = options.sessionIdleTtlMs ?? SESSION_IDLE_TTL_MS
    this.pageCacheTtlMs = options.pageCacheTtlMs ?? PAGE_CACHE_TTL_MS
    this.maxSessions = options.maxSessions ?? MAX_SESSIONS
    this.maxCachePages = options.maxCachePages ?? MAX_CACHE_PAGES
    this.maxCacheInFlight = options.maxCacheInFlight ?? MAX_CACHE_IN_FLIGHT
    this.maxPagesPerSession = options.maxPagesPerSession ?? MAX_PAGES_PER_SESSION
    this.maxSessionPagesTotal = options.maxSessionPagesTotal ?? MAX_SESSION_PAGES_TOTAL
    this.maxSessionThumbnailsTotal = options.maxSessionThumbnailsTotal ?? MAX_SESSION_THUMBNAILS_TOTAL
  }

  async open(input: {
    previewId: string
    userId: string
    source: ResolvedPreviewSource
    provider: ArchiveProvider
  }): Promise<OpenArchivePreviewDto> {
    this.prune()
    const inputIdentity = cacheIdentity(input.source.inputUrl)
    const first = await this.loadCached(inputIdentity, 0, () =>
      loadProviderPage(input.provider, input.source, input.source.inputUrl, 0, new AbortController().signal)
    )
    const canonicalIdentity = cacheIdentity(first.canonicalUrl)
    const page = publicPage(first)
    const session: ArchivePreviewSession = {
      id: input.previewId,
      userId: input.userId,
      providerKey: first.providerKey,
      externalId: first.externalId,
      canonicalUrl: first.canonicalUrl,
      updatedAt: this.now(),
      generation: 0,
      pages: new Map([[0, page]]),
      cacheIdentities: new Set([inputIdentity, canonicalIdentity]),
      inFlight: null
    }
    this.addSession(session)
    this.enforceSessionBudget(session.id)
    return { previewId: session.id, ...page }
  }

  async page(
    previewId: string,
    userId: string,
    pageNumber: number,
    provider: ArchiveProvider
  ): Promise<ArchivePreviewPageDto> {
    this.prune()
    const session = this.ownedSession(previewId, userId)
    session.updatedAt = this.now()
    const loaded = session.pages.get(pageNumber)
    if (loaded) return loaded

    if (session.inFlight) {
      if (session.inFlight.page === pageNumber && session.inFlight.generation === session.generation) {
        return session.inFlight.promise
      }
      throw new ArchiveError('STATE_CONFLICT', '请等待当前预览页加载完成')
    }
    if (session.pages.size >= this.maxPagesPerSession) {
      throw new ArchiveError('STATE_CONFLICT', '该预览会话已达到页数上限，请重新打开')
    }
    const previous = session.pages.get(pageNumber - 1)
    if (pageNumber === 0 || !previous || previous.nextPage !== pageNumber) {
      throw new ArchiveError('STATE_CONFLICT', '预览页必须按顺序加载')
    }

    const generation = session.generation
    const controller = new AbortController()
    const identity = cacheIdentity(session.canonicalUrl)
    session.cacheIdentities.add(identity)
    const promise = this.loadCached(identity, pageNumber, () =>
      loadProviderPage(
        provider,
        {
          inputUrl: session.canonicalUrl,
          expectedProviderKey: session.providerKey,
          expectedExternalId: session.externalId,
          expectedCanonicalUrl: session.canonicalUrl
        },
        session.canonicalUrl,
        pageNumber,
        controller.signal
      )
    )
      .then((result) => {
        const current = this.sessions.get(session.id)
        if (!current || current !== session || current.generation !== generation || this.isExpired(current)) {
          throw expiredPreviewError()
        }
        try {
          assertPageContinuation(current, pageNumber, result)
        } catch (error) {
          this.cache.delete(cachePageKey(identity, pageNumber))
          throw error
        }
        const value = publicPage(result)
        current.pages.set(pageNumber, value)
        current.updatedAt = this.now()
        this.enforceSessionBudget(current.id)
        return value
      })
      .finally(() => {
        if (session.inFlight?.generation === generation && session.inFlight.page === pageNumber) {
          session.inFlight = null
        }
      })
    session.inFlight = { page: pageNumber, generation, promise }
    return promise
  }

  async reload(previewId: string, userId: string, provider: ArchiveProvider): Promise<ArchivePreviewPageDto> {
    this.prune()
    const session = this.ownedSession(previewId, userId)
    session.updatedAt = this.now()
    session.generation += 1
    const generation = session.generation
    session.pages.clear()
    for (const identity of session.cacheIdentities) this.invalidateCache(identity)

    const stale = session.inFlight
    session.inFlight = null
    if (stale) {
      await stale.promise.catch(() => undefined)
    }

    const current = this.ownedSession(previewId, userId)
    if (current !== session || current.generation !== generation) throw expiredPreviewError()
    const controller = new AbortController()
    const identity = cacheIdentity(session.canonicalUrl)
    const promise = this.loadCached(
      identity,
      0,
      () =>
        loadProviderPage(
          provider,
          {
            inputUrl: session.canonicalUrl,
            expectedProviderKey: session.providerKey,
            expectedExternalId: session.externalId,
            expectedCanonicalUrl: session.canonicalUrl
          },
          session.canonicalUrl,
          0,
          controller.signal
        ),
      true
    )
      .then((result) => {
        const latest = this.sessions.get(session.id)
        if (!latest || latest !== session || latest.generation !== generation || this.isExpired(latest)) {
          throw expiredPreviewError()
        }
        const value = publicPage(result)
        latest.pages.set(0, value)
        latest.updatedAt = this.now()
        this.enforceSessionBudget(latest.id)
        return value
      })
      .finally(() => {
        if (session.inFlight?.generation === generation && session.inFlight.page === 0) session.inFlight = null
      })
    session.inFlight = { page: 0, generation, promise }
    return promise
  }

  sourceUrl(previewId: string, userId: string): string | null {
    this.prune()
    let session: ArchivePreviewSession
    try {
      session = this.ownedSession(previewId, userId)
    } catch {
      return null
    }
    session.updatedAt = this.now()
    return session.canonicalUrl
  }

  private async loadCached(
    identity: string,
    page: number,
    loader: () => Promise<ValidatedPreviewPage>,
    force = false
  ): Promise<ValidatedPreviewPage> {
    this.pruneCache()
    const key = cachePageKey(identity, page)
    if (!force) {
      const entry = this.cache.get(key)
      if (entry && entry.expiresAt > this.now()) {
        this.cache.delete(key)
        this.cache.set(key, entry)
        return entry.value
      }
      const existing = this.cacheFlights.get(key)
      if (existing && !existing.invalidated) return existing.promise
    }
    if (this.activeCacheFlights >= this.maxCacheInFlight) {
      throw new ArchiveError('STATE_CONFLICT', '当前预览请求较多，请稍后重试')
    }

    const flight = {} as CacheFlight
    flight.invalidated = false
    this.activeCacheFlights += 1
    flight.promise = loader()
      .then((value) => {
        if (!flight.invalidated) this.putCache(key, value)
        return value
      })
      .finally(() => {
        this.activeCacheFlights -= 1
        if (this.cacheFlights.get(key) === flight) this.cacheFlights.delete(key)
      })
    this.cacheFlights.set(key, flight)
    return flight.promise
  }

  private invalidateCache(identity: string) {
    const prefix = `${identity}:`
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key)
    }
    for (const [key, flight] of this.cacheFlights) {
      if (key.startsWith(prefix)) flight.invalidated = true
    }
  }

  private putCache(key: string, value: ValidatedPreviewPage) {
    this.cache.delete(key)
    this.cache.set(key, { expiresAt: this.now() + this.pageCacheTtlMs, value })
    while (this.cache.size > this.maxCachePages) {
      const oldest = this.cache.keys().next().value as string | undefined
      if (!oldest) break
      this.cache.delete(oldest)
    }
  }

  private addSession(session: ArchivePreviewSession) {
    const collision = this.sessions.get(session.id)
    if (collision) throw new ArchiveError('STATE_CONFLICT', '无法创建预览会话，请重试')
    this.sessions.delete(session.id)
    this.sessions.set(session.id, session)
    while (this.sessions.size > this.maxSessions) {
      const oldestId = this.sessions.keys().next().value as string | undefined
      if (!oldestId) break
      this.sessions.delete(oldestId)
    }
  }

  private enforceSessionBudget(protectedSessionId: string) {
    while (true) {
      let pageCount = 0
      let thumbnailCount = 0
      for (const session of this.sessions.values()) {
        pageCount += session.pages.size
        for (const page of session.pages.values()) thumbnailCount += page.items.length
      }
      if (pageCount <= this.maxSessionPagesTotal && thumbnailCount <= this.maxSessionThumbnailsTotal) return

      const victim = [...this.sessions.keys()].find((id) => id !== protectedSessionId)
      if (victim) {
        this.sessions.delete(victim)
        continue
      }
      this.sessions.delete(protectedSessionId)
      throw new ArchiveError('STATE_CONFLICT', '预览内容超过会话容量，请重新打开')
    }
  }

  private ownedSession(previewId: string, userId: string): ArchivePreviewSession {
    const session = this.sessions.get(previewId)
    if (!session || session.userId !== userId || this.isExpired(session)) {
      if (session && this.isExpired(session)) {
        this.sessions.delete(previewId)
      }
      throw expiredPreviewError()
    }
    this.sessions.delete(previewId)
    this.sessions.set(previewId, session)
    return session
  }

  private prune() {
    for (const [id, session] of this.sessions) {
      if (!this.isExpired(session)) continue
      this.sessions.delete(id)
    }
    this.pruneCache()
  }

  private pruneCache() {
    const now = this.now()
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key)
    }
  }

  private isExpired(session: ArchivePreviewSession) {
    return this.now() - session.updatedAt >= this.sessionIdleTtlMs
  }
}

const storeSymbol = Symbol.for('pixishelf.archive-preview.store')
const globalState = globalThis as typeof globalThis & { [storeSymbol]?: ArchivePreviewStore }
const defaultStore = (globalState[storeSymbol] ??= new ArchivePreviewStore())

export async function listArchivePreviewSources(
  input: z.input<typeof listArchivePreviewSourcesSchema>,
  dependencies: ArchivePreviewServiceDependencies = {}
): Promise<ArchivePreviewSourceDto[]> {
  const parsed = listArchivePreviewSourcesSchema.parse(input)
  const database = dependencies.database ?? (prisma as unknown as PrismaClient)
  const providers = getProviders(dependencies, database)
  const refs = await database.artworkExternalRef.findMany({
    where: {
      artworkId: parsed.artworkId,
      artwork: { deletedAt: null, archiveLifecycleState: 'ACTIVE' }
    },
    select: { id: true, providerKey: true, externalId: true, canonicalUrl: true },
    orderBy: [{ providerKey: 'asc' }, { externalId: 'asc' }, { id: 'asc' }]
  })
  return refs.flatMap((ref) => {
    try {
      previewProviderForFrozenIdentity(ref, providers)
      return [{ externalRefId: ref.id, providerKey: ref.providerKey, label: sourceLabel(ref) }]
    } catch {
      return []
    }
  })
}

export async function openArchivePreview(
  input: z.input<typeof openArchivePreviewSchema>,
  userId: string,
  dependencies: ArchivePreviewServiceDependencies = {}
): Promise<OpenArchivePreviewDto> {
  const parsed = openArchivePreviewSchema.parse(input)
  const database = dependencies.database ?? (prisma as unknown as PrismaClient)
  const providers = getProviders(dependencies, database)
  try {
    const source = await resolvePreviewSource(parsed.source, database, providers)
    const provider = previewProviderForSource(source, providers)
    return await (dependencies.store ?? defaultStore).open({
      previewId: (dependencies.createId ?? createPreviewId)(),
      userId,
      source,
      provider
    })
  } catch (error) {
    throw translatePreviewError(error)
  }
}

export async function getArchivePreviewPage(
  input: z.input<typeof getArchivePreviewPageSchema>,
  userId: string,
  dependencies: ArchivePreviewServiceDependencies = {}
): Promise<ArchivePreviewPageDto> {
  const parsed = getArchivePreviewPageSchema.parse(input)
  const database = dependencies.database ?? (prisma as unknown as PrismaClient)
  try {
    const store = dependencies.store ?? defaultStore
    const identity = getOwnedPreviewIdentity(store, parsed.previewId, userId)
    const provider = previewProviderForFrozenIdentity(identity, getProviders(dependencies, database))
    return await store.page(parsed.previewId, userId, parsed.page, provider)
  } catch (error) {
    throw translatePreviewError(error)
  }
}

export async function reloadArchivePreview(
  input: z.input<typeof reloadArchivePreviewSchema>,
  userId: string,
  dependencies: ArchivePreviewServiceDependencies = {}
): Promise<ArchivePreviewPageDto> {
  const parsed = reloadArchivePreviewSchema.parse(input)
  const database = dependencies.database ?? (prisma as unknown as PrismaClient)
  try {
    const store = dependencies.store ?? defaultStore
    const identity = getOwnedPreviewIdentity(store, parsed.previewId, userId)
    const provider = previewProviderForFrozenIdentity(identity, getProviders(dependencies, database))
    return await store.reload(parsed.previewId, userId, provider)
  } catch (error) {
    throw translatePreviewError(error)
  }
}

export function getArchivePreviewSourceUrl(previewId: string, userId: string): string | null {
  return defaultStore.sourceUrl(previewId, userId)
}

function getOwnedPreviewIdentity(store: ArchivePreviewStore, previewId: string, userId: string): PreviewIdentity {
  const canonicalUrl = store.sourceUrl(previewId, userId)
  if (!canonicalUrl) throw expiredPreviewError()
  const gallery = parseCanonicalGalleryUrl(canonicalUrl)
  return { providerKey: gallery.providerKey, externalId: gallery.externalId, canonicalUrl }
}

async function resolvePreviewSource(
  source: z.output<typeof archivePreviewSourceSchema>,
  database: PrismaClient,
  providers: ArchiveUploaderProviderRegistry
): Promise<ResolvedPreviewSource> {
  if (source.kind === 'url') return sourceFromSubmittedUrl(source.url, providers)

  if (source.kind === 'artwork') {
    const ref = await database.artworkExternalRef.findFirst({
      where: {
        id: source.externalRefId,
        artwork: { deletedAt: null, archiveLifecycleState: 'ACTIVE' }
      },
      select: { providerKey: true, externalId: true, canonicalUrl: true }
    })
    if (!ref) throw unavailableSourceError()
    return sourceFromFrozenIdentity(ref, providers)
  }

  if (source.kind === 'task') {
    const task = await database.archiveImport.findUnique({
      where: { id: source.taskId },
      select: { providerKey: true, externalId: true, canonicalUrl: true }
    })
    if (!task) throw unavailableSourceError()
    return sourceFromFrozenIdentity(task, providers)
  }

  if (source.kind === 'catalog') {
    const item = await database.archiveUploaderCatalogItem.findFirst({
      where: { id: source.itemId, matchesQuery: true },
      select: { providerKey: true, externalId: true, canonicalUrl: true }
    })
    if (!item) throw unavailableSourceError()
    return sourceFromFrozenIdentity(item, providers)
  }

  const item = await database.archiveIntakeItem.findUnique({
    where: { id: source.itemId },
    select: { submittedUrl: true, providerKey: true, externalId: true, canonicalUrl: true }
  })
  if (!item) throw unavailableSourceError()
  if (item.providerKey && item.externalId && item.canonicalUrl) {
    return sourceFromFrozenIdentity(
      { providerKey: item.providerKey, externalId: item.externalId, canonicalUrl: item.canonicalUrl },
      providers
    )
  }
  return sourceFromSubmittedUrl(item.submittedUrl, providers)
}

function sourceFromFrozenIdentity(identity: PreviewIdentity, providers: ArchiveUploaderProviderRegistry) {
  previewProviderForFrozenIdentity(identity, providers)
  return {
    inputUrl: identity.canonicalUrl,
    expectedProviderKey: identity.providerKey,
    expectedExternalId: identity.externalId,
    expectedCanonicalUrl: identity.canonicalUrl
  }
}

function sourceFromSubmittedUrl(inputUrl: string, providers: ArchiveUploaderProviderRegistry): ResolvedPreviewSource {
  const provider = previewProviderForUrl(inputUrl, providers)
  const submitted = parseSubmittedIdentity(inputUrl, provider.key)
  return {
    inputUrl: submitted.normalizedUrl,
    expectedProviderKey: provider.key,
    expectedExternalId: submitted.externalId,
    expectedCanonicalUrl: submitted.canonicalUrl
  }
}

function previewProviderForSource(source: ResolvedPreviewSource, providers: ArchiveUploaderProviderRegistry) {
  const provider = previewProviderForUrl(source.inputUrl, providers)
  if (provider.key !== source.expectedProviderKey) throw unavailableSourceError()
  return provider
}

function previewProviderForFrozenIdentity(identity: PreviewIdentity, providers: ArchiveUploaderProviderRegistry) {
  const parsed = parseCanonicalGalleryUrl(identity.canonicalUrl)
  if (parsed.providerKey !== identity.providerKey || parsed.externalId !== identity.externalId) {
    throw unavailableSourceError()
  }
  const provider = previewProviderForUrl(identity.canonicalUrl, providers)
  if (provider.key !== identity.providerKey) throw unavailableSourceError()
  return provider
}

function previewProviderForUrl(inputUrl: string, providers: ArchiveUploaderProviderRegistry): ArchiveProvider {
  const provider = providers.getForUrl(inputUrl)
  if (typeof provider.previewPage !== 'function') throw unavailableSourceError()
  return provider
}

async function loadProviderPage(
  provider: ArchiveProvider,
  source: ResolvedPreviewSource,
  url: string,
  page: number,
  signal: AbortSignal
): Promise<ValidatedPreviewPage> {
  if (!provider.previewPage) throw unavailableSourceError()
  let result: ArchiveThumbnailPage
  try {
    result = await provider.previewPage({ url, page }, { signal })
  } catch (error) {
    throw translatePreviewError(error)
  }
  return validateProviderPage(result, source, page)
}

function validateProviderPage(
  result: ArchiveThumbnailPage,
  source: ResolvedPreviewSource,
  requestedPage: number
): ValidatedPreviewPage {
  if (!result || typeof result !== 'object') throw invalidProviderResponse()
  const canonical = parseCanonicalGalleryUrl(result.canonicalUrl)
  if (
    result.providerKey !== source.expectedProviderKey ||
    result.providerKey !== canonical.providerKey ||
    result.externalId !== source.expectedExternalId ||
    result.externalId !== canonical.externalId ||
    (source.expectedCanonicalUrl !== null && result.canonicalUrl !== source.expectedCanonicalUrl) ||
    result.page !== requestedPage ||
    (result.nextPage !== null && result.nextPage !== requestedPage + 1) ||
    (!Number.isInteger(result.total) && result.total !== null) ||
    (typeof result.total === 'number' && (result.total < 0 || result.total > MAX_GALLERY_ITEMS)) ||
    typeof result.title !== 'string' ||
    !result.title.trim() ||
    result.title.length > 1_000 ||
    !Array.isArray(result.items) ||
    result.items.length > MAX_THUMBNAILS_PER_PAGE
  ) {
    throw invalidProviderResponse()
  }

  let previousOrdinal = -1
  const items = result.items.map((item) => {
    if (
      !Number.isInteger(item.ordinal) ||
      item.ordinal < 0 ||
      item.ordinal >= MAX_GALLERY_ITEMS ||
      item.ordinal <= previousOrdinal ||
      (previousOrdinal >= 0 && item.ordinal !== previousOrdinal + 1) ||
      !validDimension(item.width) ||
      !validDimension(item.height) ||
      !isSafeThumbnailUrl(item.url)
    ) {
      throw invalidProviderResponse()
    }
    previousOrdinal = item.ordinal
    const crop = item.crop
    if (
      crop &&
      (!Number.isInteger(crop.x) ||
        crop.x < 0 ||
        crop.x > MAX_DIMENSION ||
        !Number.isInteger(crop.y) ||
        crop.y < 0 ||
        crop.y > MAX_DIMENSION ||
        !validDimension(crop.width) ||
        !validDimension(crop.height))
    ) {
      throw invalidProviderResponse()
    }
    return crop
      ? {
          ordinal: item.ordinal,
          url: item.url,
          width: item.width,
          height: item.height,
          crop: { x: crop.x, y: crop.y, width: crop.width, height: crop.height }
        }
      : { ordinal: item.ordinal, url: item.url, width: item.width, height: item.height }
  })
  const lastOrdinal = items.at(-1)?.ordinal
  const hasKnownFinalItem = result.total !== null && lastOrdinal === result.total - 1
  if (
    (requestedPage === 0 && items.length > 0 && items[0]!.ordinal !== 0) ||
    (result.total !== null && items.some((item) => item.ordinal >= result.total!)) ||
    (result.total === 0 && (items.length > 0 || result.nextPage !== null)) ||
    (result.nextPage !== null && items.length === 0) ||
    (result.total !== null && result.total > 0 && items.length === 0) ||
    (result.total !== null && result.total > 0 && result.nextPage === null && !hasKnownFinalItem) ||
    (result.total !== null && result.nextPage !== null && hasKnownFinalItem)
  ) {
    throw invalidProviderResponse()
  }
  return {
    providerKey: result.providerKey,
    externalId: result.externalId,
    canonicalUrl: result.canonicalUrl,
    title: result.title.trim(),
    total: result.total,
    page: result.page,
    items,
    nextPage: result.nextPage
  }
}

function parseSubmittedIdentity(input: string, providerKey: string) {
  if (providerKey !== 'e-hentai') throw unavailableSourceError()
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new ArchiveError('INVALID_URL', '原站链接格式无效')
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'e-hentai.org' ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new ArchiveError('INVALID_URL', '原站链接不可用于预览')
  }
  const gallery = url.pathname.match(/^\/g\/([1-9]\d*)\/([a-z0-9]+)\/?$/i)
  if (gallery) {
    return {
      externalId: gallery[1]!,
      canonicalUrl: `https://e-hentai.org/g/${gallery[1]}/${gallery[2]}/`,
      normalizedUrl: `https://e-hentai.org/g/${gallery[1]}/${gallery[2]}/`
    }
  }
  const imagePage = url.pathname.match(/^\/s\/[a-z0-9]+\/([1-9]\d*)-(?:[1-9]\d*)\/?$/i)
  if (imagePage) {
    return {
      externalId: imagePage[1]!,
      canonicalUrl: null,
      normalizedUrl: `https://e-hentai.org${url.pathname}`
    }
  }
  throw new ArchiveError('INVALID_URL', '原站链接不可用于预览')
}

function parseCanonicalGalleryUrl(input: string) {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw unavailableSourceError()
  }
  const gallery = url.pathname.match(/^\/g\/([1-9]\d*)\/([a-z0-9]+)\/$/i)
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'e-hentai.org' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !gallery
  ) {
    throw unavailableSourceError()
  }
  return { providerKey: 'e-hentai', externalId: gallery[1]! }
}

function isSafeThumbnailUrl(input: string) {
  try {
    const url = new URL(input)
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    const isAllowedHost = THUMBNAIL_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
    )
    const isGalleryNavigation =
      (hostname === 'e-hentai.org' || hostname.endsWith('.e-hentai.org')) &&
      /^(?:\/(?:g|s)(?:\/|$)|\/fullimg(?:\.php)?(?:\/|$))/i.test(url.pathname)
    return (
      url.protocol === 'https:' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname !== '/' &&
      isAllowedHost &&
      !isGalleryNavigation
    )
  } catch {
    return false
  }
}

function validDimension(value: number) {
  return Number.isInteger(value) && value > 0 && value <= MAX_DIMENSION
}

function assertPageContinuation(session: ArchivePreviewSession, pageNumber: number, result: ValidatedPreviewPage) {
  const first = session.pages.get(0)
  const previous = session.pages.get(pageNumber - 1)
  if (!first || !previous || result.total !== first.total || result.title !== first.title) {
    throw invalidProviderResponse()
  }
  const previousLast = previous.items.at(-1)
  const currentFirst = result.items[0]
  if (
    (previous.items.length === 0 && result.items.length > 0) ||
    (previousLast && currentFirst && currentFirst.ordinal !== previousLast.ordinal + 1)
  ) {
    throw invalidProviderResponse()
  }
}

function sourceLabel(source: { providerKey: string; externalId: string }) {
  return source.providerKey === 'e-hentai' ? `#${source.externalId}` : `${source.providerKey} #${source.externalId}`
}

function publicPage(page: ValidatedPreviewPage): ArchivePreviewPageDto {
  return {
    title: page.title,
    total: page.total,
    page: page.page,
    items: page.items,
    nextPage: page.nextPage
  }
}

function createPreviewId() {
  return randomBytes(32).toString('base64url')
}

function cacheIdentity(url: string) {
  return createHash('sha256').update(url).digest('base64url')
}

function cachePageKey(identity: string, page: number) {
  return `${identity}:${page}`
}

function getProviders(dependencies: ArchivePreviewServiceDependencies, database: PrismaClient) {
  return (
    dependencies.providers ??
    new GovernedArchiveProviderRegistry(
      createDefaultArchiveMediaProviderRegistry(),
      new PostgresArchiveProviderGovernor(database)
    )
  )
}

function expiredPreviewError() {
  return new ArchiveError('STATE_CONFLICT', '预览会话不存在或已过期，请重新打开')
}

function unavailableSourceError() {
  return new ArchiveError('STATE_CONFLICT', '该原站来源不可用于预览')
}

function invalidProviderResponse() {
  return new ArchiveError('REMOTE_RESPONSE_INVALID', '原站缩略图响应无效', { recoverable: true })
}

function translatePreviewError(error: unknown): ArchiveError {
  if (error instanceof ArchiveError && error.code === 'STATE_CONFLICT') return error
  const classified = findCodedError(error)
  const code = classified?.code
  if (code === 'INVALID_URL' || code === 'UNSUPPORTED_PROVIDER' || code === 'SSRF_BLOCKED') {
    return new ArchiveError(code, '原站链接不可用于预览')
  }
  if (code === 'REMOTE_NOT_FOUND') return new ArchiveError(code, '原站画廊不存在或已不可访问')
  if (code === 'REMOTE_RATE_LIMITED' || code === 'REMOTE_QUOTA_EXCEEDED' || code === 'REMOTE_FORBIDDEN') {
    return new ArchiveError(code, '原站暂时限制了预览请求，请稍后重试', {
      recoverable: true,
      retryAfterMs: classified?.retryAfterMs ?? null
    })
  }
  if (error instanceof ArchiveError && error.code === 'REMOTE_RESPONSE_INVALID') return invalidProviderResponse()
  return new ArchiveError('REMOTE_RESPONSE_INVALID', '无法读取原站缩略图，请稍后重试', {
    recoverable: true
  })
}

function findCodedError(error: unknown): { code: ArchiveErrorCode; retryAfterMs: number | null } | null {
  let current: unknown = error
  const seen = new Set<unknown>()
  for (let depth = 0; current && depth < 8 && !seen.has(current); depth += 1) {
    seen.add(current)
    if (typeof current === 'object' && 'code' in current && typeof current.code === 'string') {
      const code = current.code as ArchiveErrorCode
      const retryAfterMs =
        'retryAfterMs' in current && typeof current.retryAfterMs === 'number' && Number.isFinite(current.retryAfterMs)
          ? Math.max(0, Math.min(current.retryAfterMs, 24 * 60 * 60_000))
          : null
      return { code, retryAfterMs }
    }
    current = current instanceof Error ? current.cause : null
  }
  return null
}
