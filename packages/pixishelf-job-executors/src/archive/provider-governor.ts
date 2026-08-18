import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
import type { PrismaClient } from '@pixishelf/db'
import { ArchiveExecutorError, toArchiveExecutorError } from './errors.js'
import type { ArchiveMediaProvider, ArchiveProvider, ArchiveProviderRegistry, ArchiveRemoteMedia } from './types.js'

export type ArchiveProviderRequestClass = 'RESOLVE' | 'DOWNLOAD'

export interface ArchiveProviderPermit {
  id: string
  providerKey: string
  requestClass: ArchiveProviderRequestClass
  renewAfterMs: number
}

export interface ArchiveProviderAcquireOptions {
  yieldToDownloads?: boolean
}

export interface ArchiveProviderGovernor {
  acquire(
    providerKey: string,
    requestClass: ArchiveProviderRequestClass,
    signal: AbortSignal,
    options?: ArchiveProviderAcquireOptions
  ): Promise<ArchiveProviderPermit>
  renew(permit: ArchiveProviderPermit): Promise<void>
  release(permit: ArchiveProviderPermit): Promise<void>
  penalize(providerKey: string, code: string, until: Date): Promise<void>
}

export interface PostgresArchiveProviderGovernorOptions {
  minimumIntervalMs?: number
  leaseDurationMs?: number
  maxConcurrentDownloads?: number
  now?: () => Date
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

export class PostgresArchiveProviderGovernor implements ArchiveProviderGovernor {
  private readonly minimumIntervalMs: number
  private readonly leaseDurationMs: number
  private readonly maxConcurrentDownloads: number
  private readonly now: () => Date
  private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>

  constructor(
    private readonly database: PrismaClient,
    options: PostgresArchiveProviderGovernorOptions = {}
  ) {
    this.minimumIntervalMs = options.minimumIntervalMs ?? 250
    this.leaseDurationMs = options.leaseDurationMs ?? 5 * 60_000
    this.maxConcurrentDownloads = options.maxConcurrentDownloads ?? 2
    this.now = options.now ?? (() => new Date())
    this.sleep = options.sleep ?? abortableDelay
    assertPositiveInteger('minimumIntervalMs', this.minimumIntervalMs)
    assertPositiveInteger('leaseDurationMs', this.leaseDurationMs)
    assertPositiveInteger('maxConcurrentDownloads', this.maxConcurrentDownloads)
  }

  async acquire(
    providerKeyInput: string,
    requestClass: ArchiveProviderRequestClass,
    signal: AbortSignal,
    options: ArchiveProviderAcquireOptions = {}
  ): Promise<ArchiveProviderPermit> {
    const providerKey = normalizeProviderKey(providerKeyInput)
    while (true) {
      throwIfAborted(signal)
      const now = this.now()
      let decision:
        | { permit: ArchiveProviderPermit }
        | { waitUntil: Date; reason: 'PENALTY' | 'INTERVAL' | 'DOWNLOAD_ACTIVE' | 'DOWNLOAD_CAPACITY' }
      try {
        decision = await this.database.$transaction(
          async (transaction) => {
            await transaction.archiveProviderThrottle.upsert({
              where: { providerKey },
              create: { providerKey },
              update: {}
            })
            const states = await transaction.$queryRawUnsafe<Array<{ nextRequestAt: Date; penaltyUntil: Date | null }>>(
              `SELECT "nextRequestAt", "penaltyUntil"
             FROM "archive_provider_throttles"
             WHERE "providerKey" = $1
             FOR UPDATE`,
              providerKey
            )
            await transaction.archiveProviderRequestLease.deleteMany({
              where: { providerKey, expiresAt: { lte: now } }
            })
            const state = states[0]
            if (!state) throw new Error(`Provider throttle row disappeared for ${providerKey}`)
            const activeDownloads = await transaction.archiveProviderRequestLease.findMany({
              where: { providerKey, requestClass: 'DOWNLOAD', expiresAt: { gt: now } },
              select: { expiresAt: true },
              orderBy: { expiresAt: 'asc' }
            })
            if (state.penaltyUntil && state.penaltyUntil.getTime() > now.getTime()) {
              return { waitUntil: state.penaltyUntil, reason: 'PENALTY' as const }
            }
            if (state.nextRequestAt.getTime() > now.getTime()) {
              return { waitUntil: state.nextRequestAt, reason: 'INTERVAL' as const }
            }
            if (requestClass === 'RESOLVE' && activeDownloads.length > 0) {
              return { waitUntil: activeDownloads[0]!.expiresAt, reason: 'DOWNLOAD_ACTIVE' as const }
            }
            if (requestClass === 'DOWNLOAD' && activeDownloads.length >= this.maxConcurrentDownloads) {
              return { waitUntil: activeDownloads[0]!.expiresAt, reason: 'DOWNLOAD_CAPACITY' as const }
            }

            const permit: ArchiveProviderPermit = {
              id: randomUUID(),
              providerKey,
              requestClass,
              renewAfterMs: Math.max(100, Math.floor(this.leaseDurationMs / 3))
            }
            await transaction.archiveProviderRequestLease.create({
              data: {
                id: permit.id,
                providerKey,
                requestClass,
                expiresAt: new Date(now.getTime() + this.leaseDurationMs)
              }
            })
            await transaction.archiveProviderThrottle.update({
              where: { providerKey },
              data: {
                nextRequestAt: new Date(now.getTime() + this.minimumIntervalMs),
                version: { increment: 1 }
              }
            })
            return { permit }
          },
          { isolationLevel: 'Serializable' }
        )
      } catch (error) {
        if (!isSerializationConflict(error)) throw error
        await this.sleep(25, signal)
        continue
      }
      if ('permit' in decision) return decision.permit
      if (
        requestClass === 'RESOLVE' &&
        options.yieldToDownloads &&
        (decision.reason === 'DOWNLOAD_ACTIVE' || decision.reason === 'PENALTY')
      ) {
        const blockedMs = Math.max(1_000, decision.waitUntil.getTime() - this.now().getTime())
        throw new ArchiveExecutorError(
          'REMOTE_RATE_LIMITED',
          decision.reason === 'PENALTY'
            ? 'Provider request penalty is still active'
            : 'Archive downloads currently have provider request priority',
          {
            recoverable: true,
            decisionCode: decision.reason === 'DOWNLOAD_ACTIVE' ? 'PROVIDER_DOWNLOAD_PRIORITY' : null,
            retryAfterMs: decision.reason === 'PENALTY' ? blockedMs : Math.min(5_000, blockedMs)
          }
        )
      }
      const maximumWaitMs = decision.reason === 'DOWNLOAD_CAPACITY' ? 100 : 5_000
      const waitMs = Math.max(25, Math.min(maximumWaitMs, decision.waitUntil.getTime() - this.now().getTime()))
      await this.sleep(waitMs, signal)
    }
  }

  async renew(permit: ArchiveProviderPermit): Promise<void> {
    const now = this.now()
    const renewed = await this.database.archiveProviderRequestLease.updateMany({
      where: {
        id: permit.id,
        providerKey: permit.providerKey,
        requestClass: permit.requestClass,
        expiresAt: { gt: now }
      },
      data: { expiresAt: new Date(now.getTime() + this.leaseDurationMs) }
    })
    if (renewed.count !== 1) {
      throw new ArchiveExecutorError('STATE_CONFLICT', 'Provider request permit expired before renewal', {
        recoverable: true
      })
    }
  }

  async release(permit: ArchiveProviderPermit): Promise<void> {
    await this.database.archiveProviderRequestLease.deleteMany({
      where: { id: permit.id, providerKey: permit.providerKey, requestClass: permit.requestClass }
    })
  }

  async penalize(providerKeyInput: string, code: string, until: Date): Promise<void> {
    const providerKey = normalizeProviderKey(providerKeyInput)
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

export class GovernedArchiveProviderRegistry implements ArchiveProviderRegistry {
  private readonly providers = new Map<string, ArchiveProvider>()

  constructor(
    private readonly delegate: ArchiveProviderRegistry,
    private readonly governor: ArchiveProviderGovernor
  ) {}

  get(providerKey: string): ArchiveMediaProvider {
    return this.wrap(this.delegate.get(providerKey))
  }

  getForUrl(url: string): ArchiveProvider {
    return this.wrap(this.delegate.getForUrl(url))
  }

  private wrap(provider: ArchiveMediaProvider): ArchiveProvider {
    const existing = this.providers.get(provider.key)
    if (existing) return existing
    if (!isArchiveProvider(provider)) {
      throw new Error(`Archive provider ${provider.key} cannot resolve URLs`)
    }
    const governed = new GovernedArchiveProvider(provider, this.governor)
    this.providers.set(provider.key, governed)
    return governed
  }
}

class GovernedArchiveProvider implements ArchiveProvider {
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

  async resolve(url: string, context: { signal?: AbortSignal } = {}) {
    const signal = context.signal ?? new AbortController().signal
    const linked = linkedAbortController(signal)
    try {
      return await this.delegate.resolve(url, {
        ...context,
        signal: linked.controller.signal,
        runResolveRequest: (operation) =>
          this.runWithPermit('RESOLVE', linked.controller, operation, { yieldToDownloads: true })
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
    try {
      const remote = await this.delegate.openMedia(item, {
        ...context,
        signal: linked.controller.signal,
        runDownloadRequest: (operation) => this.runWithPermit('DOWNLOAD', linked.controller, operation),
        runDownloadStreamRequest: async (operation) => {
          const response = await this.runWithStreamPermit(linked.controller, operation, linked.dispose)
          governedStream.value = response.stream
          return response
        }
      })
      if (!governedStream.value || remote.stream !== governedStream.value) {
        remote.stream.destroy()
        throw new ArchiveExecutorError(
          'STATE_CONFLICT',
          `Archive provider ${this.key} returned media without per-request stream governance`
        )
      }
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
    const stopRenewal = startPermitRenewal(this.governor, permit, (error) => controller.abort(error))
    try {
      return await operation()
    } catch (error) {
      await this.applyPenalty(error)
      throw error
    } finally {
      await stopRenewal()
      await this.governor.release(permit)
    }
  }

  private async runWithStreamPermit<T extends { stream: Readable }>(
    controller: AbortController,
    operation: () => Promise<T>,
    onSettlement: () => void
  ): Promise<T> {
    const permit = await this.governor.acquire(this.key, 'DOWNLOAD', controller.signal)
    let response: T | null = null
    const stopRenewal = startPermitRenewal(this.governor, permit, (error) => {
      controller.abort(error)
      response?.stream.destroy(error)
    })
    try {
      response = await operation()
      releaseOnStreamSettlement(response, async () => {
        await stopRenewal()
        onSettlement()
        await this.governor.release(permit)
      })
      return response
    } catch (error) {
      await stopRenewal()
      try {
        await this.applyPenalty(error)
      } finally {
        onSettlement()
        await this.governor.release(permit)
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

function startPermitRenewal(
  governor: ArchiveProviderGovernor,
  permit: ArchiveProviderPermit,
  onError: (error: Error) => void
) {
  let stopped = false
  let renewal: Promise<void> | null = null
  const timer = setInterval(() => {
    if (stopped || renewal) return
    renewal = governor
      .renew(permit)
      .catch((error) => {
        if (stopped) return
        stopped = true
        clearInterval(timer)
        onError(error instanceof Error ? error : new Error(String(error)))
      })
      .finally(() => {
        renewal = null
      })
  }, permit.renewAfterMs)
  timer.unref()
  return async () => {
    stopped = true
    clearInterval(timer)
    await renewal
  }
}

function releaseOnStreamSettlement(remote: { stream: Readable }, release: () => Promise<void>) {
  let released = false
  const once = () => {
    if (released) return
    released = true
    void release().catch(() => undefined)
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

function normalizeProviderKey(value: string) {
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized.length > 50 || !/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new Error('Provider key is invalid')
  }
  return normalized
}

function assertPositiveInteger(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`)
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

function isSerializationConflict(error: unknown) {
  const record = typeof error === 'object' && error !== null ? (error as { code?: unknown; meta?: unknown }) : null
  const code = record?.code === undefined ? '' : String(record.code)
  const meta =
    record?.meta && typeof record.meta === 'object' ? (record.meta as { code?: unknown; message?: unknown }) : null
  const databaseCode = meta?.code === undefined ? '' : String(meta.code)
  const message = error instanceof Error ? error.message : String(error)
  const databaseMessage = meta?.message === undefined ? '' : String(meta.message)
  return (
    code === 'P2034' ||
    code === '40001' ||
    databaseCode === '40001' ||
    /serializ(?:ation|e)|write conflict/i.test(`${message} ${databaseMessage}`)
  )
}
