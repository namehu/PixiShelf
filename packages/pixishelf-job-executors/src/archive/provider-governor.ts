import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
import type { PrismaClient } from '@pixishelf/db'
import { ArchiveExecutorError, toArchiveExecutorError } from './errors.ts'
import type {
  ArchiveMediaProvider,
  ArchiveProvider,
  ArchiveRemoteMedia,
  ArchiveUploaderProvider,
  ArchiveUploaderProviderRegistry
} from './types.ts'

export type ArchiveProviderRequestClass = 'SEARCH' | 'RESOLVE' | 'DOWNLOAD'

export interface ArchiveProviderPermit {
  id: string
  providerKey: string
  requestClass: ArchiveProviderRequestClass
}

export interface ArchiveProviderAcquireOptions {
  yieldOnPenalty?: boolean
  maxConcurrentDownloads?: number
}

export interface ArchiveProviderGovernor {
  acquire(
    providerKey: string,
    requestClass: ArchiveProviderRequestClass,
    signal: AbortSignal,
    options?: ArchiveProviderAcquireOptions
  ): Promise<ArchiveProviderPermit>
  release(permit: ArchiveProviderPermit): void
  penalize(providerKey: string, code: string, until: Date): Promise<void>
}

export interface InMemoryArchiveProviderGovernorOptions {
  minimumIntervalMs?: number
  maximumIntervalMs?: number
  searchMinimumIntervalMs?: number
  maxConcurrentDownloads?: number
  now?: () => Date
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  random?: () => number
}

type ProviderState = {
  nextRequestAt: number
  penaltyUntil: number
  downloads: Set<string>
}

const governors = new WeakMap<PrismaClient, InMemoryArchiveProviderGovernor>()

export function getArchiveProviderGovernor(database: PrismaClient) {
  let governor = governors.get(database)
  if (!governor) {
    governor = new InMemoryArchiveProviderGovernor(database)
    governors.set(database, governor)
  }
  return governor
}

export class InMemoryArchiveProviderGovernor implements ArchiveProviderGovernor {
  private readonly states = new Map<string, ProviderState>()
  private penaltiesLoaded = false
  private loadingPenalties: Promise<void> | undefined
  private readonly minimumIntervalMs: number
  private readonly maximumIntervalMs: number
  private readonly searchMinimumIntervalMs: number
  private readonly maxConcurrentDownloads: number
  private readonly now: () => Date
  private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>
  private readonly random: () => number

  constructor(
    private readonly database: PrismaClient,
    options: InMemoryArchiveProviderGovernorOptions = {}
  ) {
    this.minimumIntervalMs = options.minimumIntervalMs ?? 250
    this.maximumIntervalMs = options.maximumIntervalMs ?? 500
    this.searchMinimumIntervalMs = options.searchMinimumIntervalMs ?? 3_000
    this.maxConcurrentDownloads = options.maxConcurrentDownloads ?? 2
    this.now = options.now ?? (() => new Date())
    this.sleep = options.sleep ?? abortableDelay
    this.random = options.random ?? Math.random
  }

  async acquire(
    providerKey: string,
    requestClass: ArchiveProviderRequestClass,
    signal: AbortSignal,
    options: ArchiveProviderAcquireOptions = {}
  ): Promise<ArchiveProviderPermit> {
    throwIfAborted(signal)
    await this.loadPenalties()
    const state = this.stateFor(providerKey)
    const capacity = options.maxConcurrentDownloads ?? this.maxConcurrentDownloads
    while (true) {
      throwIfAborted(signal)
      const now = this.now().getTime()
      if (state.penaltyUntil > now) {
        if (requestClass !== 'DOWNLOAD' && options.yieldOnPenalty) {
          throw new ArchiveExecutorError('REMOTE_RATE_LIMITED', '来源站点仍处于请求限流等待期', {
            recoverable: true,
            retryAfterMs: Math.max(1_000, state.penaltyUntil - now)
          })
        }
        // Longer delays overflow Node's timer and become a 1ms busy loop.
        await this.sleep(Math.min(state.penaltyUntil - now, 2_147_483_647), signal)
      } else if (state.nextRequestAt > now) {
        await this.sleep(state.nextRequestAt - now, signal)
      } else if (requestClass === 'DOWNLOAD' && state.downloads.size >= capacity) {
        await this.sleep(100, signal)
      } else {
        // No await between checking capacity and reserving the next request.
        // All callers in this process share this state, including resolver requests.
        state.nextRequestAt =
          now +
          (requestClass === 'SEARCH'
            ? this.searchMinimumIntervalMs
            : this.minimumIntervalMs +
              Math.floor(this.random() * (this.maximumIntervalMs - this.minimumIntervalMs + 1)))
        const permit = { id: randomUUID(), providerKey, requestClass }
        if (requestClass === 'DOWNLOAD') state.downloads.add(permit.id)
        return permit
      }
    }
  }

  release(permit: ArchiveProviderPermit): void {
    this.states.get(permit.providerKey)?.downloads.delete(permit.id)
  }

  private stateFor(providerKey: string) {
    let state = this.states.get(providerKey)
    if (!state) {
      state = { nextRequestAt: 0, penaltyUntil: 0, downloads: new Set() }
      this.states.set(providerKey, state)
    }
    return state
  }

  private async loadPenalties() {
    if (this.penaltiesLoaded) return
    this.loadingPenalties ??= this.database.archiveProviderThrottle
      .findMany({
        where: { penaltyUntil: { gt: this.now() } },
        select: { providerKey: true, penaltyUntil: true }
      })
      .then((rows) => {
        for (const row of rows) {
          const state = this.stateFor(row.providerKey)
          state.penaltyUntil = Math.max(state.penaltyUntil, row.penaltyUntil?.getTime() ?? 0)
        }
        this.penaltiesLoaded = true
      })
      .finally(() => {
        this.loadingPenalties = undefined
      })
    await this.loadingPenalties
  }

  async penalize(providerKey: string, code: string, until: Date): Promise<void> {
    const state = this.stateFor(providerKey)
    state.penaltyUntil = Math.max(state.penaltyUntil, until.getTime())
    await this.database.$executeRawUnsafe(
      `INSERT INTO "archive_provider_throttles" (
         "providerKey", "nextRequestAt", "penaltyUntil", "penaltyCode", "version", "updatedAt"
       ) VALUES ($1, $2, $2, $3, 1, $4)
       ON CONFLICT ("providerKey") DO UPDATE
       SET "penaltyUntil" = GREATEST("archive_provider_throttles"."penaltyUntil", EXCLUDED."penaltyUntil"),
           "nextRequestAt" = GREATEST("archive_provider_throttles"."nextRequestAt", EXCLUDED."nextRequestAt"),
           "penaltyCode" = EXCLUDED."penaltyCode",
           "version" = "archive_provider_throttles"."version" + 1,
           "updatedAt" = EXCLUDED."updatedAt"`,
      providerKey,
      until,
      code.slice(0, 40),
      this.now()
    )
  }
}

export class GovernedArchiveProviderRegistry implements ArchiveUploaderProviderRegistry {
  private readonly providers = new Map<string, ArchiveProvider>()

  constructor(
    private readonly delegate: ArchiveUploaderProviderRegistry,
    private readonly governor: ArchiveProviderGovernor
  ) {}

  get(providerKey: string): ArchiveMediaProvider {
    return this.wrap(this.delegate.get(providerKey))
  }

  getForUrl(url: string): ArchiveProvider {
    return this.wrap(this.delegate.getForUrl(url))
  }

  getUploaderScanner(providerKey: string): ArchiveUploaderProvider {
    const provider = this.wrap(this.delegate.getUploaderScanner(providerKey))
    if (!isArchiveUploaderProvider(provider)) {
      throw new Error(`归档来源站点 ${providerKey} 不支持扫描上传者`)
    }
    return provider
  }

  private wrap(provider: ArchiveMediaProvider): ArchiveProvider {
    const existing = this.providers.get(provider.key)
    if (existing) return existing
    if (!isArchiveProvider(provider)) {
      throw new Error(`归档来源站点 ${provider.key} 不支持解析链接`)
    }
    const governed = new GovernedArchiveProvider(provider, this.governor)
    this.providers.set(provider.key, governed)
    return governed
  }
}

class GovernedArchiveProvider implements ArchiveUploaderProvider {
  readonly key: string
  readonly requestGovernance = 'PER_REQUEST' as const
  constructor(
    private readonly delegate: ArchiveProvider,
    private readonly governor: ArchiveProviderGovernor
  ) {
    this.key = delegate.key
  }

  accepts(url: URL) {
    return this.delegate.accepts(url)
  }

  identifySource(input: string) {
    return this.delegate.identifySource(input)
  }

  async resolve(url: string, context: { signal?: AbortSignal } = {}) {
    const signal = context.signal ?? new AbortController().signal
    const linked = linkedAbortController(signal)
    try {
      return await this.delegate.resolve(url, {
        ...context,
        signal: linked.controller.signal,
        runResolveRequest: (operation) =>
          this.runWithPermit('RESOLVE', linked.controller, operation, { yieldOnPenalty: true })
      })
    } finally {
      linked.dispose()
    }
  }

  async scanUploader(
    input: Parameters<ArchiveUploaderProvider['scanUploader']>[0],
    context: Parameters<ArchiveUploaderProvider['scanUploader']>[1] = {}
  ) {
    if (!isArchiveUploaderProvider(this.delegate)) {
      throw new Error(`归档来源站点 ${this.key} 不支持扫描上传者`)
    }
    const signal = context.signal ?? new AbortController().signal
    const linked = linkedAbortController(signal)
    try {
      return await this.delegate.scanUploader(input, {
        ...context,
        signal: linked.controller.signal,
        runSearchRequest: (operation) =>
          this.runWithPermit('SEARCH', linked.controller, operation, { yieldOnPenalty: true })
      })
    } finally {
      linked.dispose()
    }
  }

  async scanTitles(
    input: import('./types.ts').ArchiveTitleScanInput,
    context: import('./types.ts').ArchiveUploaderScanContext = {}
  ) {
    if (!isArchiveUploaderProvider(this.delegate) || !this.delegate.scanTitles) {
      throw new Error(`归档来源站点 ${this.key} 不支持标题搜索`)
    }
    const linked = linkedAbortController(context.signal ?? new AbortController().signal)
    try {
      return await this.delegate.scanTitles(input, {
        ...context,
        signal: linked.controller.signal,
        runSearchRequest: (operation) =>
          this.runWithPermit('SEARCH', linked.controller, operation, { yieldOnPenalty: true })
      })
    } finally {
      linked.dispose()
    }
  }

  async openMedia(
    item: Parameters<ArchiveProvider['openMedia']>[0],
    context: Parameters<ArchiveProvider['openMedia']>[1]
  ): Promise<ArchiveRemoteMedia> {
    const signal = context.signal ?? new AbortController().signal
    const linked = linkedAbortController(signal)
    const governedStream: { value: Readable | null } = { value: null }
    const acquireOptions =
      context.maxConcurrentDownloads === undefined ? {} : { maxConcurrentDownloads: context.maxConcurrentDownloads }
    try {
      const remote = await this.delegate.openMedia(item, {
        ...context,
        signal: linked.controller.signal,
        runDownloadRequest: (operation) => this.runWithPermit('DOWNLOAD', linked.controller, operation, acquireOptions),
        runDownloadStreamRequest: async (operation) => {
          const response = await this.runWithStreamPermit(linked.controller, operation, linked.dispose, acquireOptions)
          governedStream.value = response.stream
          return response
        }
      })
      if (!governedStream.value || remote.stream !== governedStream.value) {
        remote.stream.destroy()
        throw new ArchiveExecutorError('STATE_CONFLICT', `归档来源站点 ${this.key} 返回了未按请求进行流量管控的媒体流`)
      }
      // The download permit follows the returned stream, not just openMedia;
      // releasing here would allow another download to exceed the provider cap
      // while bytes from this response are still being consumed.
      return remote
    } catch (error) {
      if (governedStream.value) governedStream.value.destroy(toError(error))
      else linked.dispose()
      throw error
    }
  }

  private async runWithPermit<T>(
    requestClass: ArchiveProviderRequestClass,
    controller: AbortController,
    operation: () => Promise<T>,
    options?: ArchiveProviderAcquireOptions
  ): Promise<T> {
    const permit = await this.governor.acquire(this.key, requestClass, controller.signal, options)
    try {
      throwIfAborted(controller.signal)
      return await operation()
    } catch (error) {
      await this.applyPenalty(error)
      throw error
    } finally {
      this.governor.release(permit)
    }
  }

  private async runWithStreamPermit<T extends { stream: Readable }>(
    controller: AbortController,
    operation: () => Promise<T>,
    onSettlement: () => void,
    options: ArchiveProviderAcquireOptions
  ): Promise<T> {
    const permit = await this.governor.acquire(this.key, 'DOWNLOAD', controller.signal, options)
    try {
      throwIfAborted(controller.signal)
      const response = await operation()
      releaseOnStreamSettlement(response, () => {
        onSettlement()
        this.governor.release(permit)
      })
      return response
    } catch (error) {
      try {
        await this.applyPenalty(error)
      } finally {
        // The provider may recover this request. Keep parent cancellation linked
        // until openMedia fails or the final successful stream settles.
        this.governor.release(permit)
      }
      throw error
    }
  }

  private async applyPenalty(error: unknown) {
    const classified = findProviderLimitError(error) ?? toArchiveExecutorError(error)
    if (!['REMOTE_RATE_LIMITED', 'REMOTE_QUOTA_EXCEEDED'].includes(classified.code)) return
    const delayMs = classified.retryAfterMs ?? 30_000
    await this.governor.penalize(this.key, classified.code, new Date(Date.now() + delayMs))
  }
}

function releaseOnStreamSettlement(remote: { stream: Readable }, release: () => void) {
  let released = false
  const once = () => {
    if (released) return
    released = true
    release()
  }
  remote.stream.once('end', once)
  remote.stream.once('close', once)
  remote.stream.once('error', once)
}

function linkedAbortController(parent: AbortSignal) {
  const controller = new AbortController()
  const onAbort = () => controller.abort(parent.reason)
  if (parent.aborted) onAbort()
  else parent.addEventListener('abort', onAbort, { once: true })
  return {
    controller,
    dispose: () => parent.removeEventListener('abort', onAbort)
  }
}

function findProviderLimitError(error: unknown) {
  let current: unknown = error
  const seen = new Set<unknown>()
  for (let depth = 0; current && depth < 8 && !seen.has(current); depth += 1) {
    seen.add(current)
    const classified = toArchiveExecutorError(current)
    if (classified.code === 'REMOTE_RATE_LIMITED' || classified.code === 'REMOTE_QUOTA_EXCEEDED') {
      return classified
    }
    current = current instanceof Error ? current.cause : undefined
  }
  return null
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

function isArchiveProvider(provider: ArchiveMediaProvider): provider is ArchiveProvider {
  const candidate = provider as Partial<ArchiveProvider>
  return (
    candidate.requestGovernance === 'PER_REQUEST' &&
    typeof candidate.accepts === 'function' &&
    typeof candidate.resolve === 'function'
  )
}

function isArchiveUploaderProvider(provider: ArchiveMediaProvider): provider is ArchiveUploaderProvider {
  return (
    isArchiveProvider(provider) && typeof (provider as Partial<ArchiveUploaderProvider>).scanUploader === 'function'
  )
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    timer.unref()
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
