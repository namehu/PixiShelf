import { getEventListeners } from 'node:events'
import { PassThrough } from 'node:stream'
import type { PrismaClient } from '@pixishelf/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArchiveExecutorError } from '../errors.js'
import { DefaultArchiveMediaProviderRegistry } from '../provider-registry.js'
import {
  GovernedArchiveProviderRegistry,
  InMemoryArchiveProviderGovernor,
  getArchiveProviderGovernor,
  type ArchiveProviderGovernor,
  type ArchiveProviderPermit
} from '../provider-governor.js'
import { EHentaiProvider } from '../providers/e-hentai.js'
import type { ArchiveProvider, ArchiveRemoteMedia } from '../types.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('InMemoryArchiveProviderGovernor', () => {
  function database() {
    return {
      archiveProviderThrottle: { findMany: vi.fn(async () => []) },
      $executeRawUnsafe: vi.fn(async () => 1),
      $transaction: vi.fn(() => {
        throw new Error('requests must not start a transaction')
      })
    }
  }

  it('shares one governor across callers using the same process database client', () => {
    const db = database() as unknown as PrismaClient
    expect(getArchiveProviderGovernor(db)).toBe(getArchiveProviderGovernor(db))
  })

  it('spaces four concurrent requests by the shared random interval without database writes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const db = database()
    const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValue(0.999)
    const governor = new InMemoryArchiveProviderGovernor(db as unknown as PrismaClient, { random })
    const starts: number[] = []
    const attempts = Array.from({ length: 4 }, async () => {
      const permit = await governor.acquire('test', 'DOWNLOAD', new AbortController().signal, {
        maxConcurrentDownloads: 4
      })
      starts.push(Date.now())
      return permit
    })
    await vi.advanceTimersByTimeAsync(1_125)
    const permits = await Promise.all(attempts)
    expect(starts).toEqual([0, 250, 625, 1_125])
    permits.forEach((permit) => governor.release(permit))
    expect(db.archiveProviderThrottle.findMany).toHaveBeenCalledOnce()
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps capacity until release while allowing resolver and search requests', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const governor = new InMemoryArchiveProviderGovernor(database() as unknown as PrismaClient, {
      minimumIntervalMs: 1,
      maximumIntervalMs: 1,
      searchMinimumIntervalMs: 3,
      maxConcurrentDownloads: 1
    })
    const signal = new AbortController().signal
    const first = await governor.acquire('test', 'DOWNLOAD', signal)
    let acquired = false
    const waiting = governor.acquire('test', 'DOWNLOAD', signal).then((permit) => {
      acquired = true
      return permit
    })
    const reads = Promise.all(
      ['RESOLVE', 'SEARCH'].map((requestClass) =>
        governor.acquire('test', requestClass as 'RESOLVE' | 'SEARCH', signal)
      )
    )
    await vi.advanceTimersByTimeAsync(500)
    await reads
    expect(acquired).toBe(false)
    governor.release(first)
    governor.release(first)
    await vi.advanceTimersByTimeAsync(100)
    governor.release(await waiting)
    expect(acquired).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['interval', 'capacity', 'cooldown'])(
    'cancels a request waiting for %s without leaving a slot or timer',
    async (reason) => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      const governor = new InMemoryArchiveProviderGovernor(database() as unknown as PrismaClient, {
        random: () => 0,
        maxConcurrentDownloads: 1
      })
      const controller = new AbortController()
      const first = await governor.acquire('test', 'DOWNLOAD', controller.signal)
      if (reason === 'interval') governor.release(first)
      if (reason === 'capacity') await vi.advanceTimersByTimeAsync(250)
      if (reason === 'cooldown') await governor.penalize('test', 'REMOTE_RATE_LIMITED', new Date(1_000))
      const cancelled = new Error('paused or cancelled')
      const waiting = governor.acquire('test', 'DOWNLOAD', controller.signal).catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(0)
      controller.abort(cancelled)
      expect(await waiting).toBe(cancelled)
      expect(vi.getTimerCount()).toBe(0)
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
      governor.release(first)
      await vi.advanceTimersByTimeAsync(1_000)
      const resumed = await governor.acquire('test', 'DOWNLOAD', new AbortController().signal)
      governor.release(resumed)
    }
  )

  it('applies a newly received cooldown to requests already waiting for their interval', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const db = database()
    const governor = new InMemoryArchiveProviderGovernor(db as unknown as PrismaClient, { random: () => 0 })
    const signal = new AbortController().signal
    governor.release(await governor.acquire('test', 'DOWNLOAD', signal))
    let startedAt: number | undefined
    const waiting = governor.acquire('test', 'DOWNLOAD', signal).then((permit) => {
      startedAt = Date.now()
      return permit
    })
    await vi.advanceTimersByTimeAsync(100)
    await governor.penalize('test', 'REMOTE_RATE_LIMITED', new Date(1_000))
    await vi.advanceTimersByTimeAsync(899)
    expect(startedAt).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    governor.release(await waiting)
    expect(startedAt).toBe(1_000)
    expect(db.$executeRawUnsafe).toHaveBeenCalledOnce()
  })

  it('splits a long cooldown at the timer limit and can cancel the remaining wait', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const schedule = vi.spyOn(globalThis, 'setTimeout')
    const governor = new InMemoryArchiveProviderGovernor(database() as unknown as PrismaClient)
    const controller = new AbortController()
    const until = 30 * 24 * 60 * 60 * 1_000
    await governor.penalize('test', 'REMOTE_RATE_LIMITED', new Date(until))
    let granted = false
    const waiting = governor
      .acquire('test', 'DOWNLOAD', controller.signal)
      .then(() => {
        granted = true
      })
      .catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(0)
    expect(schedule).toHaveBeenLastCalledWith(expect.any(Function), 2_147_483_647)
    await vi.advanceTimersByTimeAsync(2_147_483_647)
    expect(granted).toBe(false)
    expect(schedule).toHaveBeenLastCalledWith(expect.any(Function), until - 2_147_483_647)
    expect(schedule).toHaveBeenCalledTimes(2)

    const cancelled = new Error('cancelled during long cooldown')
    controller.abort(cancelled)
    expect(await waiting).toBe(cancelled)
    expect(vi.getTimerCount()).toBe(0)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    schedule.mockRestore()
  })

  it('keeps the existing three-second spacing after a search request', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const governor = new InMemoryArchiveProviderGovernor(database() as unknown as PrismaClient)
    const signal = new AbortController().signal
    governor.release(await governor.acquire('test', 'SEARCH', signal))
    let started = false
    const waiting = governor.acquire('test', 'RESOLVE', signal).then((permit) => {
      started = true
      return permit
    })
    await vi.advanceTimersByTimeAsync(2_999)
    expect(started).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    governor.release(await waiting)
    expect(started).toBe(true)
  })

  it('allows a later task to load cooldowns after an initial database read fails', async () => {
    const db = database()
    const failure = new Error('database unavailable')
    db.archiveProviderThrottle.findMany.mockRejectedValueOnce(failure)
    const governor = new InMemoryArchiveProviderGovernor(db as unknown as PrismaClient)
    const signal = new AbortController().signal
    await expect(governor.acquire('test', 'DOWNLOAD', signal)).rejects.toBe(failure)
    governor.release(await governor.acquire('test', 'DOWNLOAD', signal))
    expect(db.archiveProviderThrottle.findMany).toHaveBeenCalledTimes(2)
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
      { yieldOnPenalty: true },
      { yieldOnPenalty: true },
      { yieldOnPenalty: true }
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
      yieldOnPenalty: true
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

  it('keeps parent cancellation linked while a provider recovers a failed stream request', async () => {
    const controller = new AbortController()
    const cancelled = new Error('user paused')
    const delegate = createProvider({
      openMedia: vi.fn(async (_item, context) => {
        await expect(
          context.runDownloadStreamRequest!(async () => {
            throw new ArchiveExecutorError('REMOTE_FORBIDDEN', '403', { httpStatus: 403 })
          })
        ).rejects.toMatchObject({ code: 'REMOTE_FORBIDDEN' })
        expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1)
        controller.abort(cancelled)
        expect(context.signal?.aborted).toBe(true)
        throw context.signal?.reason
      })
    })
    const governor = createGovernor()
    const provider = new GovernedArchiveProviderRegistry(
      new DefaultArchiveMediaProviderRegistry([delegate]),
      governor
    ).get('test')
    await expect(provider.openMedia(mediaItem(), { quality: 'ORIGINAL', signal: controller.signal })).rejects.toBe(
      cancelled
    )
    expect(governor.release).toHaveBeenCalledOnce()
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  })

  it('holds a long stream without renewal timers and removes the parent abort listener after settlement', async () => {
    vi.useFakeTimers()
    const stream = new PassThrough()
    const remote = remoteMedia(stream)
    const delegate = createProvider({
      openMedia: vi.fn(async (_item, context) => context.runDownloadStreamRequest!(() => Promise.resolve(remote)))
    })
    const governor = createGovernor()
    const provider = new GovernedArchiveProviderRegistry(
      new DefaultArchiveMediaProviderRegistry([delegate]),
      governor
    ).get('test')
    const controller = new AbortController()

    const opened = await provider.openMedia(mediaItem(), { quality: 'ORIGINAL', signal: controller.signal })
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1_001)
    expect(vi.getTimerCount()).toBe(0)
    expect(governor.release).not.toHaveBeenCalled()
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

function createPermit(requestClass: 'SEARCH' | 'RESOLVE' | 'DOWNLOAD'): ArchiveProviderPermit {
  return {
    id: `${requestClass.toLowerCase()}-${Math.random()}`,
    providerKey: 'test',
    requestClass
  }
}

function createGovernor() {
  return {
    acquire: vi.fn(
      async (
        _providerKey: string,
        requestClass: 'SEARCH' | 'RESOLVE' | 'DOWNLOAD',
        _signal: AbortSignal,
        _options?: { yieldOnPenalty?: boolean; maxConcurrentDownloads?: number }
      ) => createPermit(requestClass)
    ),
    release: vi.fn((_permit: ArchiveProviderPermit) => undefined),
    penalize: vi.fn(async (_providerKey: string, _code: string, _until: Date) => undefined)
  } satisfies ArchiveProviderGovernor
}

function createProvider(overrides: Partial<ArchiveProvider> = {}): ArchiveProvider {
  return {
    key: 'test',
    accepts: () => true,
    identifySource: (input: string) => ({
      kind: 'PROVIDER',
      providerKey: 'test',
      externalId: new URL(input).pathname.split('/')[2] ?? '1'
    }),
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
