import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { PrismaClient } from '@pixishelf/db'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { GovernedArchiveProviderRegistry, InMemoryArchiveProviderGovernor } from '../provider-governor.js'
import { DefaultArchiveMediaProviderRegistry } from '../provider-registry.js'
import { EHentaiProvider } from '../providers/e-hentai.js'
import type { ArchiveProvider } from '../types.js'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const prisma = databaseUrl
  ? new PrismaClient({ datasourceUrl: databaseUrl, log: [{ emit: 'event', level: 'query' }] })
  : null
const queries: string[] = []
prisma?.$on('query', (event) => queries.push(event.query))
const providerKey = `test-${randomUUID()}`

describePostgres('Archive provider cooldown persistence', () => {
  beforeEach(async () => {
    await prisma!.archiveProviderRequestLease.deleteMany({ where: { providerKey } })
    await prisma!.archiveProviderThrottle.deleteMany({ where: { providerKey } })
    queries.length = 0
  })

  afterAll(async () => {
    if (!prisma) return
    await prisma.archiveProviderRequestLease.deleteMany({ where: { providerKey } })
    await prisma.archiveProviderThrottle.deleteMany({ where: { providerKey } })
    await prisma.$disconnect()
  })

  it('runs four lanes and 240 requests with one cooldown read and no database writes', async () => {
    const governor = new InMemoryArchiveProviderGovernor(prisma!, {
      minimumIntervalMs: 1,
      maximumIntervalMs: 1,
      maxConcurrentDownloads: 4
    })
    const signal = AbortSignal.timeout(15_000)
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, async () => {
        for (let image = 0; image < 30; image++) {
          for (const requestClass of ['RESOLVE', 'DOWNLOAD'] as const) {
            const permit = await governor.acquire(providerKey, requestClass, signal)
            governor.release(permit)
          }
        }
        return 30
      })
    )
    expect(results).toEqual(Array.from({ length: 4 }, () => ({ status: 'fulfilled', value: 30 })))
    expect(queries).toHaveLength(1)
    expect(queries[0]).toMatch(/^SELECT .*archive_provider_throttles/)
    expect(await prisma!.archiveProviderRequestLease.count({ where: { providerKey } })).toBe(0)
    expect(await prisma!.archiveProviderThrottle.count({ where: { providerKey } })).toBe(0)
  }, 20_000)

  it('restores a persisted cooldown after restart and never shortens it', async () => {
    let now = new Date('2026-10-29T10:00:00.000Z')
    const until = new Date(now.getTime() + 60_000)
    const first = new InMemoryArchiveProviderGovernor(prisma!, { now: () => now })
    await first.penalize(providerKey, 'REMOTE_RATE_LIMITED', until)
    await first.penalize(providerKey, 'REMOTE_RATE_LIMITED', new Date(now.getTime() + 10_000))
    expect((await prisma!.archiveProviderThrottle.findUniqueOrThrow({ where: { providerKey } })).penaltyUntil).toEqual(
      until
    )
    const sleep = vi.fn(async (milliseconds: number) => {
      now = new Date(now.getTime() + milliseconds)
    })
    const restarted = new InMemoryArchiveProviderGovernor(prisma!, { now: () => now, sleep })
    const signal = new AbortController().signal
    for (const requestClass of ['RESOLVE', 'SEARCH'] as const) {
      await expect(
        restarted.acquire(providerKey, requestClass, signal, { yieldOnPenalty: true })
      ).rejects.toMatchObject({ code: 'REMOTE_RATE_LIMITED', retryAfterMs: 60_000 })
    }
    const permit = await restarted.acquire(providerKey, 'DOWNLOAD', signal)
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([60_000])
    restarted.release(permit)
    expect(await prisma!.archiveProviderRequestLease.count({ where: { providerKey } })).toBe(0)
  })

  it('ignores old request timestamps and leases while preserving the stored records', async () => {
    const now = new Date()
    await prisma!.archiveProviderThrottle.create({
      data: { providerKey, nextRequestAt: new Date(now.getTime() + 60_000) }
    })
    await prisma!.archiveProviderRequestLease.create({
      data: {
        id: randomUUID(),
        providerKey,
        requestClass: 'DOWNLOAD',
        expiresAt: new Date(now.getTime() + 60_000)
      }
    })
    const sleep = vi.fn(async () => undefined)
    const governor = new InMemoryArchiveProviderGovernor(prisma!, { now: () => now, sleep, maxConcurrentDownloads: 1 })
    governor.release(await governor.acquire(providerKey, 'DOWNLOAD', new AbortController().signal))
    expect(sleep).not.toHaveBeenCalled()
    expect(await prisma!.archiveProviderRequestLease.count({ where: { providerKey } })).toBe(1)
  })

  it('resolves every gallery page once while a governed media stream remains open', async () => {
    const stream = new PassThrough()
    let now = new Date('2026-09-09T10:00:00.000Z')
    await prisma!.archiveProviderThrottle.create({ data: { providerKey, nextRequestAt: now } })
    const sleep = vi.fn(async (milliseconds: number) => {
      now = new Date(now.getTime() + milliseconds)
    })
    const governor = new InMemoryArchiveProviderGovernor(prisma!, {
      now: () => now,
      sleep,
      random: () => 0,
      maxConcurrentDownloads: 1
    })
    const http = {
      json: vi.fn(async () => ({
        gmetadata: [{ gid: 123, token: 'gallerytoken', title: 'Gallery', filecount: '2', tags: [] }]
      })),
      text: vi.fn(async (url: string) => {
        if (url.includes('/s/')) return '<img id="img" src="https://ehgt.org/test.jpg">'
        const page = new URL(url).searchParams.has('p') ? 2 : 1
        return `<a href="https://e-hentai.org/s/pagetoken/123-${page}">page</a>`
      }),
      request: vi.fn(async () => ({
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
        stream,
        url: 'https://ehgt.org/test.jpg'
      }))
    }
    // Isolate this real provider's throttle rows from other PostgreSQL fixtures.
    const delegate = new EHentaiProvider(http as never)
    const testProvider: ArchiveProvider = {
      key: providerKey,
      requestGovernance: 'PER_REQUEST',
      accepts: delegate.accepts.bind(delegate),
      identifySource: delegate.identifySource.bind(delegate),
      resolve: delegate.resolve.bind(delegate),
      openMedia: delegate.openMedia.bind(delegate)
    }
    const registry = new GovernedArchiveProviderRegistry(
      new DefaultArchiveMediaProviderRegistry([testProvider]),
      governor
    )
    const provider = registry.getForUrl('https://e-hentai.org/g/123/gallerytoken/')
    try {
      await provider.openMedia(
        {
          index: 0,
          sourcePageUrl: 'https://e-hentai.org/s/other/456-1',
          locator: {},
          expectedFilename: '0001'
        },
        { quality: 'DISPLAY', maxConcurrentDownloads: 1 }
      )
      const resolved = await provider.resolve('https://e-hentai.org/g/123/gallerytoken/')
      expect(resolved.media).toHaveLength(2)
      expect(http.json).toHaveBeenCalledOnce()
      expect(http.text.mock.calls.map(([url]) => url)).toEqual([
        'https://e-hentai.org/s/other/456-1',
        'https://e-hentai.org/g/123/gallerytoken/',
        'https://e-hentai.org/g/123/gallerytoken/?p=1'
      ])
      expect(stream.readableEnded).toBe(false)
      expect(
        await prisma!.archiveProviderRequestLease.count({ where: { providerKey, requestClass: 'DOWNLOAD' } })
      ).toBe(0)
      expect(await prisma!.archiveProviderRequestLease.count({ where: { providerKey, requestClass: 'RESOLVE' } })).toBe(
        0
      )
      expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([250, 250, 250, 250])
    } finally {
      stream.destroy()
      await vi.waitFor(async () => {
        expect(await prisma!.archiveProviderRequestLease.count({ where: { providerKey } })).toBe(0)
      })
    }
  })
})
