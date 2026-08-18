import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@pixishelf/db'
import { afterAll, describe, expect, it } from 'vitest'
import { PostgresArchiveProviderGovernor } from '../provider-governor.js'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const competingPrisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const providerKey = `test-${randomUUID()}`

describePostgres('Postgres archive provider governor', () => {
  afterAll(async () => {
    if (!prisma) return
    await prisma.archiveProviderRequestLease.deleteMany({ where: { providerKey } })
    await prisma.archiveProviderThrottle.deleteMany({ where: { providerKey } })
    await prisma.$disconnect()
    await competingPrisma?.$disconnect()
  })

  it('keeps at most two concurrent downloads across clients and makes resolver requests yield', async () => {
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
    const abortTimer = setTimeout(() => {
      for (const controller of controllers) controller.abort(new Error('bounded concurrency probe finished'))
    }, 200)
    const results = await Promise.allSettled(attempts)
    clearTimeout(abortTimer)
    const permits = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    const failures = results.flatMap((result) =>
      result.status === 'rejected'
        ? [result.reason instanceof Error ? `${result.reason.name}:${result.reason.message}` : String(result.reason)]
        : []
    )

    expect(permits, failures.join('\n')).toHaveLength(2)
    expect(await prisma!.archiveProviderRequestLease.count({ where: { providerKey, requestClass: 'DOWNLOAD' } })).toBe(
      2
    )

    const resolverController = new AbortController()
    const resolverAttempt = governors[1]!.acquire(providerKey, 'RESOLVE', resolverController.signal)
    setTimeout(() => resolverController.abort(new Error('resolver yielded to download')), 50)
    await expect(resolverAttempt).rejects.toThrow('resolver yielded to download')
    expect(await prisma!.archiveProviderRequestLease.count({ where: { providerKey, requestClass: 'RESOLVE' } })).toBe(0)

    await Promise.all(permits.map((permit, index) => governors[index % governors.length]!.release(permit)))
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
  })
})
