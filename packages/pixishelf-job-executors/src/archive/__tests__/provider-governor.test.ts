import { getEventListeners } from 'node:events'
import { PassThrough } from 'node:stream'
import type { PrismaClient } from '@pixishelf/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArchiveExecutorError } from '../errors.js'
import { DefaultArchiveMediaProviderRegistry } from '../provider-registry.js'
import {
  GovernedArchiveProviderRegistry,
  PostgresArchiveProviderGovernor,
  type ArchiveProviderGovernor,
  type ArchiveProviderPermit
} from '../provider-governor.js'
import { EHentaiProvider } from '../providers/e-hentai.js'
import type { ArchiveProvider, ArchiveRemoteMedia } from '../types.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('PostgresArchiveProviderGovernor', () => {
  it('retries a serializable transaction conflict inside acquire', async () => {
    const permit = {
      id: '6c50812b-fbaf-43b7-9235-f7f0c8842c6c',
      providerKey: 'test',
      requestClass: 'DOWNLOAD' as const,
      renewAfterMs: 1_000
    }
    const conflict = Object.assign(new Error('Transaction failed due to a write conflict'), { code: 'P2034' })
    const transaction = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce({ permit })
    const sleep = vi.fn(async () => undefined)
    const governor = new PostgresArchiveProviderGovernor({ $transaction: transaction } as unknown as PrismaClient, {
      sleep
    })

    await expect(governor.acquire('test', 'DOWNLOAD', new AbortController().signal)).resolves.toEqual(permit)
    expect(transaction).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(25, expect.any(AbortSignal))
  })

  it('retries PostgreSQL 40001 when Prisma wraps it as a raw-query error', async () => {
    const permit = createPermit('DOWNLOAD')
    const conflict = Object.assign(new Error('Raw query failed: could not serialize access due to concurrent update'), {
      code: 'P2010',
      meta: { code: '40001', message: 'could not serialize access due to concurrent update' }
    })
    const transaction = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce({ permit })
    const sleep = vi.fn(async () => undefined)
    const governor = new PostgresArchiveProviderGovernor({ $transaction: transaction } as unknown as PrismaClient, {
      sleep
    })

    await expect(governor.acquire('test', 'DOWNLOAD', new AbortController().signal)).resolves.toEqual(permit)
    expect(transaction).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-serialization database failure', async () => {
    const failure = Object.assign(new Error('permission denied'), { code: '42501' })
    const transaction = vi.fn().mockRejectedValue(failure)
    const sleep = vi.fn(async () => undefined)
    const governor = new PostgresArchiveProviderGovernor({ $transaction: transaction } as unknown as PrismaClient, {
      sleep
    })

    await expect(governor.acquire('test', 'RESOLVE', new AbortController().signal)).rejects.toBe(failure)
    expect(transaction).toHaveBeenCalledOnce()
    expect(sleep).not.toHaveBeenCalled()
  })

  it.each([
    [
      'DOWNLOAD_ACTIVE',
      new Date('2026-08-18T10:01:00.000Z'),
      'PROVIDER_DOWNLOAD_PRIORITY',
      '归档下载正在优先使用来源站点请求额度，当前任务稍后自动重试'
    ],
    ['PENALTY', new Date('2026-08-18T10:10:00.000Z'), null, '来源站点仍处于请求限流等待期']
  ] as const)(
    'fails resolver acquisition fast for %s instead of polling while RUNNING',
    async (reason, waitUntil, decisionCode, message) => {
      const transaction = vi.fn().mockResolvedValue({ reason, waitUntil })
      const sleep = vi.fn(async () => undefined)
      const governor = new PostgresArchiveProviderGovernor({ $transaction: transaction } as unknown as PrismaClient, {
        now: () => new Date('2026-08-18T10:00:00.000Z'),
        sleep
      })

      await expect(
        governor.acquire('test', 'RESOLVE', new AbortController().signal, { yieldToDownloads: true })
      ).rejects.toMatchObject({ code: 'REMOTE_RATE_LIMITED', message, recoverable: true, decisionCode })
      expect(sleep).not.toHaveBeenCalled()
    }
  )

  it('grants a SEARCH permit while a download stream lease is active', async () => {
    const now = new Date('2026-08-18T10:00:00.000Z')
    const requestLeaseCreate = vi.fn(async () => ({}))
    const transactionClient = {
      archiveProviderThrottle: {
        upsert: vi.fn(async () => ({})),
        update: vi.fn(async () => ({}))
      },
      archiveProviderRequestLease: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        findMany: vi.fn(async () => [{ expiresAt: new Date('2026-08-18T10:05:00.000Z') }]),
        create: requestLeaseCreate
      },
      $queryRawUnsafe: vi.fn(async () => [{ nextRequestAt: now, penaltyUntil: null }])
    }
    const database = {
      $transaction: vi.fn(async (operation: (transaction: typeof transactionClient) => Promise<unknown>) =>
        operation(transactionClient)
      )
    }
    const sleep = vi.fn(async () => undefined)
    const governor = new PostgresArchiveProviderGovernor(database as unknown as PrismaClient, {
      now: () => now,
      sleep
    })

    await expect(governor.acquire('e-hentai', 'SEARCH', new AbortController().signal)).resolves.toMatchObject({
      providerKey: 'e-hentai',
      requestClass: 'SEARCH'
    })
    expect(requestLeaseCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ providerKey: 'e-hentai', requestClass: 'SEARCH' })
    })
    expect(sleep).not.toHaveBeenCalled()
  })

  it('checks download capacity again quickly while an ended stream permit is being released', async () => {
    const permit = createPermit('DOWNLOAD')
    const transaction = vi
      .fn()
      .mockResolvedValueOnce({
        reason: 'DOWNLOAD_CAPACITY',
        waitUntil: new Date('2026-08-18T10:01:00.000Z')
      })
      .mockResolvedValueOnce({ permit })
    const sleep = vi.fn(async () => undefined)
    const governor = new PostgresArchiveProviderGovernor({ $transaction: transaction } as unknown as PrismaClient, {
      now: () => new Date('2026-08-18T10:00:00.000Z'),
      sleep
    })

    await expect(governor.acquire('test', 'DOWNLOAD', new AbortController().signal)).resolves.toEqual(permit)
    expect(sleep).toHaveBeenCalledWith(100, expect.any(AbortSignal))
  })
})

describe('GovernedArchiveProviderRegistry', () => {
  it('takes a SEARCH permit for the uploader listing, metadata, and UID evidence page', async () => {
    const http = {
      text: vi.fn(async () => '<a href="https://e-hentai.org/g/123/gallerytoken/">Gallery</a>'),
      json: vi.fn(async () => ({
        gmetadata: [{ gid: 123, token: 'gallerytoken', title: 'Gallery', uploader: 'alice', filecount: '1', tags: [] }]
      }))
    }
    const governor = createGovernor()
    const registry = new GovernedArchiveProviderRegistry(
      new DefaultArchiveMediaProviderRegistry([new EHentaiProvider(http as never)]),
      governor
    )

    await registry.getUploaderScanner('e-hentai').scanUploader({
      identityKind: 'NAME',
      identityValue: 'alice',
      cursor: null,
      stopAtExternalId: null,
      limit: 100
    })

    expect(governor.acquire).toHaveBeenCalledTimes(3)
    expect(governor.acquire.mock.calls.map((call) => call[1])).toEqual(['SEARCH', 'SEARCH', 'SEARCH'])
    expect(governor.acquire.mock.calls.map((call) => call[3])).toEqual([
      { yieldToDownloads: true },
      { yieldToDownloads: true },
      { yieldToDownloads: true }
    ])
    expect(governor.release).toHaveBeenCalledTimes(3)
  })

  it('takes and releases a governor permit for every E-Hentai resolve HTTP request', async () => {
    const http = {
      json: vi.fn(async () => ({
        gmetadata: [
          {
            gid: 123,
            token: 'gallerytoken',
            title: 'Gallery',
            filecount: '1',
            tags: []
          }
        ]
      })),
      text: vi.fn(async () => '<a href="https://e-hentai.org/s/pagetoken/123-1">page</a>')
    }
    const provider = new EHentaiProvider(http as never)
    const governor = createGovernor()
    const registry = new GovernedArchiveProviderRegistry(new DefaultArchiveMediaProviderRegistry([provider]), governor)

    await registry
      .getForUrl('https://e-hentai.org/g/123/gallerytoken/')
      .resolve('https://e-hentai.org/g/123/gallerytoken/')

    expect(http.json).toHaveBeenCalledOnce()
    expect(http.text).toHaveBeenCalledOnce()
    expect(governor.acquire).toHaveBeenCalledTimes(2)
    expect(governor.acquire).toHaveBeenNthCalledWith(1, 'e-hentai', 'RESOLVE', expect.any(AbortSignal), {
      yieldToDownloads: true
    })
    expect(governor.release).toHaveBeenCalledTimes(2)
  })

  it('takes separate permits for the E-Hentai source page and media stream requests', async () => {
    const stream = new PassThrough()
    const http = {
      text: vi.fn(
        async () => '<title>0001.jpg :: E-Hentai</title><a href="https://e-hentai.org/fullimg.php?gid=123">original</a>'
      ),
      request: vi.fn(async () => ({
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
        stream,
        url: 'https://e-hentai.org/fullimg.php?gid=123'
      }))
    }
    const provider = new EHentaiProvider(http as never)
    const governor = createGovernor()
    const governed = new GovernedArchiveProviderRegistry(
      new DefaultArchiveMediaProviderRegistry([provider]),
      governor
    ).get('e-hentai')

    const remote = await governed.openMedia(mediaItem(), {
      quality: 'ORIGINAL',
      signal: new AbortController().signal,
      maxConcurrentDownloads: 4
    })

    expect(governor.acquire).toHaveBeenCalledTimes(2)
    expect(governor.acquire.mock.calls.map((call) => call[1])).toEqual(['DOWNLOAD', 'DOWNLOAD'])
    expect(governor.acquire.mock.calls.map((call) => call[3])).toEqual([
      { maxConcurrentDownloads: 4 },
      { maxConcurrentDownloads: 4 }
    ])
    expect(governor.release).toHaveBeenCalledOnce()
    remote.stream.resume()
    stream.end()
    await new Promise<void>((resolve) => remote.stream.once('end', () => resolve()))
    await Promise.resolve()
    await Promise.resolve()
    expect(governor.release).toHaveBeenCalledTimes(2)
  })

  it('renews a long media stream lease and removes the parent abort listener after settlement', async () => {
    vi.useFakeTimers()
    const stream = new PassThrough()
    const remote = remoteMedia(stream)
    const delegate = createProvider({
      openMedia: vi.fn(async (_item, context) => context.runDownloadStreamRequest!(() => Promise.resolve(remote)))
    })
    const governor = createGovernor({ renewAfterMs: 1_000 })
    const provider = new GovernedArchiveProviderRegistry(
      new DefaultArchiveMediaProviderRegistry([delegate]),
      governor
    ).get('test')
    const controller = new AbortController()

    const opened = await provider.openMedia(mediaItem(), { quality: 'ORIGINAL', signal: controller.signal })
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1_001)
    expect(governor.renew).toHaveBeenCalledOnce()
    opened.stream.resume()
    stream.end()
    await new Promise<void>((resolve) => opened.stream.once('end', () => resolve()))
    await Promise.resolve()
    await Promise.resolve()

    expect(governor.release).toHaveBeenCalledOnce()
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  })

  it('records a nested 509 quota penalty even when the provider wraps it as original unavailable', async () => {
    const quota = new ArchiveExecutorError('REMOTE_QUOTA_EXCEEDED', 'quota', {
      recoverable: true,
      retryAfterMs: 90_000
    })
    const wrapped = new ArchiveExecutorError('ORIGINAL_UNAVAILABLE', 'use display quality', {
      cause: quota,
      recoverable: true,
      pause: true
    })
    const delegate = createProvider({
      openMedia: vi.fn(async (_item, context) => {
        try {
          await context.runDownloadRequest!(async () => {
            throw quota
          })
        } catch {
          throw wrapped
        }
        throw new Error('unreachable')
      })
    })
    const governor = createGovernor()
    const provider = new GovernedArchiveProviderRegistry(
      new DefaultArchiveMediaProviderRegistry([delegate]),
      governor
    ).get('test')

    await expect(
      provider.openMedia(mediaItem(), { quality: 'ORIGINAL', signal: new AbortController().signal })
    ).rejects.toBe(wrapped)
    expect(governor.penalize).toHaveBeenCalledWith('test', 'REMOTE_QUOTA_EXCEEDED', expect.any(Date))
    const until = vi.mocked(governor.penalize).mock.calls[0]![2]
    expect(until.getTime()).toBeGreaterThan(Date.now() + 89_000)
  })

  it('keeps the download permit until a provider penalty is durably recorded', async () => {
    let finishPenalty: (() => void) | undefined
    const penaltyWrite = new Promise<void>((resolve) => {
      finishPenalty = resolve
    })
    const rateLimit = new ArchiveExecutorError('REMOTE_RATE_LIMITED', 'slow down', {
      recoverable: true,
      retryAfterMs: 30_000
    })
    const delegate = createProvider({
      openMedia: vi.fn(async (_item, context) =>
        context.runDownloadRequest!(async () => {
          throw rateLimit
        })
      ) as ArchiveProvider['openMedia']
    })
    const governor = createGovernor()
    vi.mocked(governor.penalize).mockImplementation(async () => penaltyWrite)
    const provider = new GovernedArchiveProviderRegistry(
      new DefaultArchiveMediaProviderRegistry([delegate]),
      governor
    ).get('test')

    const opening = provider.openMedia(mediaItem(), {
      quality: 'ORIGINAL',
      signal: new AbortController().signal
    })
    await vi.waitFor(() => expect(governor.penalize).toHaveBeenCalledOnce())

    expect(governor.release).not.toHaveBeenCalled()
    finishPenalty?.()
    await expect(opening).rejects.toBe(rateLimit)
    expect(governor.release).toHaveBeenCalledOnce()
  })
})

function createPermit(requestClass: 'SEARCH' | 'RESOLVE' | 'DOWNLOAD', renewAfterMs = 1_000): ArchiveProviderPermit {
  return {
    id: `${requestClass.toLowerCase()}-${Math.random()}`,
    providerKey: 'test',
    requestClass,
    renewAfterMs
  }
}

function createGovernor(options: { renewAfterMs?: number } = {}) {
  return {
    acquire: vi.fn(
      async (
        _providerKey: string,
        requestClass: 'SEARCH' | 'RESOLVE' | 'DOWNLOAD',
        _signal: AbortSignal,
        _options?: { yieldToDownloads?: boolean; maxConcurrentDownloads?: number }
      ) => createPermit(requestClass, options.renewAfterMs)
    ),
    renew: vi.fn(async (_permit: ArchiveProviderPermit) => undefined),
    release: vi.fn(async (_permit: ArchiveProviderPermit) => undefined),
    penalize: vi.fn(async (_providerKey: string, _code: string, _until: Date) => undefined)
  } satisfies ArchiveProviderGovernor
}

function createProvider(overrides: Partial<ArchiveProvider> = {}): ArchiveProvider {
  return {
    key: 'test',
    accepts: () => true,
    resolve: vi.fn(async () => ({}) as never),
    openMedia: vi.fn(async () => remoteMedia(new PassThrough())),
    ...overrides,
    requestGovernance: 'PER_REQUEST'
  }
}

function mediaItem() {
  return { index: 0, sourcePageUrl: 'https://example.test/page/1', locator: {}, expectedFilename: '0001' }
}

function remoteMedia(stream: PassThrough): ArchiveRemoteMedia {
  return {
    stream,
    mimeType: 'image/jpeg',
    contentLength: null,
    originalFilename: '0001.jpg',
    quality: 'ORIGINAL',
    remoteHost: 'example.test'
  }
}
