import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { PrismaClient } from '@pixishelf/db'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { GovernedArchiveProviderRegistry, PostgresArchiveProviderGovernor } from '../provider-governor.js'
import { DefaultArchiveMediaProviderRegistry } from '../provider-registry.js'
import { EHentaiProvider } from '../providers/e-hentai.js'
import type { ArchiveProvider } from '../types.js'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const competingPrisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const providerKey = `test-${randomUUID()}`

describePostgres('Postgres archive provider governor', () => {
  beforeEach(async () => {
    await prisma!.archiveProviderRequestLease.deleteMany({ where: { providerKey } })
    await prisma!.archiveProviderThrottle.deleteMany({ where: { providerKey } })
  })

  afterAll(async () => {
    if (!prisma) return
    await prisma.archiveProviderRequestLease.deleteMany({ where: { providerKey } })
    await prisma.archiveProviderThrottle.deleteMany({ where: { providerKey } })
    await prisma.$disconnect()
    await competingPrisma?.$disconnect()
  })

  it('keeps download capacity bounded across clients while allowing resolver requests at full capacity', async () => {
    const governors = [prisma!, competingPrisma!].map(
      (database) =>
        new PostgresArchiveProviderGovernor(database, {
          minimumIntervalMs: 1,
          leaseDurationMs: 60_000,
          maxConcurrentDownloads: 2
        })
    )
    const controllers = Array.from({ length: 8 }, () => new AbortController())
    const attempts = controllers.map((controller, index) =>
      governors[index % governors.length]!.acquire(providerKey, 'DOWNLOAD', controller.signal)
    )
    const settledAttempts = Promise.allSettled(attempts)
    let capacityObservationError: unknown
    try {
      await vi.waitFor(
        async () => {
          expect(
            await prisma!.archiveProviderRequestLease.count({ where: { providerKey, requestClass: 'DOWNLOAD' } })
          ).toBe(2)
        },
        { timeout: 5_000, interval: 25 }
      )
    } catch (error) {
      capacityObservationError = error
    } finally {
      for (const controller of controllers) controller.abort(new Error('bounded concurrency probe finished'))
    }
    const results = await settledAttempts
    const permits = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    const failures = results.flatMap((result) =>
      result.status === 'rejected'
        ? [result.reason instanceof Error ? `${result.reason.name}:${result.reason.message}` : String(result.reason)]
        : []
    )

    expect(permits, failures.join('\n')).toHaveLength(2)
    if (capacityObservationError) throw capacityObservationError
    expect(await prisma!.archiveProviderRequestLease.count({ where: { providerKey, requestClass: 'DOWNLOAD' } })).toBe(
      2
    )

    try {
      const resolverPermit = await governors[1]!.acquire(providerKey, 'RESOLVE', new AbortController().signal, {
        yieldOnPenalty: true
      })
      expect(await prisma!.archiveProviderRequestLease.count({ where: { providerKey, requestClass: 'RESOLVE' } })).toBe(
        1
      )
      expect(
        await prisma!.archiveProviderRequestLease.count({ where: { providerKey, requestClass: 'DOWNLOAD' } })
      ).toBe(2)
      await governors[1]!.release(resolverPermit)
    } finally {
      await Promise.all(permits.map((permit, index) => governors[index % governors.length]!.release(permit)))
    }
  }, 10_000)

  it.each(['RESOLVE', 'SEARCH'] as const)(
    'shares request intervals across clients for %s and downloads',
    async (requestClass) => {
      let now = new Date('2026-09-09T10:00:00.000Z')
      await prisma!.archiveProviderThrottle.create({ data: { providerKey, nextRequestAt: now } })
      const sleep = vi.fn(async (milliseconds: number) => {
        now = new Date(now.getTime() + milliseconds)
      })
      const governors = [prisma!, competingPrisma!].map(
        (database) => new PostgresArchiveProviderGovernor(database, { now: () => now, sleep })
      )
      const signal = new AbortController().signal
      const download = await governors[0]!.acquire(providerKey, 'DOWNLOAD', signal)
      const read = await governors[1]!.acquire(providerKey, requestClass, signal, { yieldOnPenalty: true })
      expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([250])
      await governors[1]!.release(read)
      const nextDownload = await governors[0]!.acquire(providerKey, 'DOWNLOAD', signal)
      expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
        250,
        requestClass === 'SEARCH' ? 3_000 : 250
      ])
      await governors[0]!.release(download)
      await governors[0]!.release(nextDownload)
    }
  )

  it('resolves every gallery page once while a governed media stream remains open', async () => {
    const stream = new PassThrough()
    let now = new Date('2026-09-09T10:00:00.000Z')
    await prisma!.archiveProviderThrottle.create({ data: { providerKey, nextRequestAt: now } })
    const sleep = vi.fn(async (milliseconds: number) => {
      now = new Date(now.getTime() + milliseconds)
    })
    const governor = new PostgresArchiveProviderGovernor(prisma!, {
      now: () => now,
      sleep,
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
      ).toBe(1)
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

  it('persists a penalty so another client cannot immediately acquire the provider budget', async () => {
    const blocked = new Error('penalty-wait')
    const governor = new PostgresArchiveProviderGovernor(prisma!, {
      minimumIntervalMs: 1,
      sleep: async () => {
        throw blocked
      }
    })
    await governor.penalize(providerKey, 'REMOTE_RATE_LIMITED', new Date(Date.now() + 60_000))
    const competitor = new PostgresArchiveProviderGovernor(competingPrisma!, {
      minimumIntervalMs: 1,
      sleep: async () => {
        throw blocked
      }
    })
    await expect(competitor.acquire(providerKey, 'DOWNLOAD', new AbortController().signal)).rejects.toBe(blocked)
    for (const requestClass of ['RESOLVE', 'SEARCH'] as const) {
      await expect(
        competitor.acquire(providerKey, requestClass, new AbortController().signal, {
          yieldOnPenalty: true
        })
      ).rejects.toMatchObject({ code: 'REMOTE_RATE_LIMITED', decisionCode: null, recoverable: true })
    }
    expect(await prisma!.archiveProviderRequestLease.count({ where: { providerKey } })).toBe(0)
  })
})
