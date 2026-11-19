// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Prisma, PrismaClient } from '@pixishelf/db'
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import logger from '@/lib/logger'
import { addArchiveUploaderScanItems } from '../../archive-uploader/archive-uploader-service'
import { createArchiveIntakeSubmission, retryArchiveIntakeMany } from '../archive-intake-service'
import { runConcurrentArchiveTasks } from './intake-worker-fixture'

const databaseUrl = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const suite = databaseUrl ? describe.sequential : describe.skip
const prefix = `intake-batch-${randomUUID()}`
const applicationName = `intake-batch-${randomUUID()}`
const url = databaseUrl ? new URL(databaseUrl) : null
url?.searchParams.set('application_name', applicationName)
const db = new PrismaClient({ datasourceUrl: url?.toString() })
const observer = new PrismaClient({ datasourceUrl: databaseUrl })
let fixtureIndex = 0

let intakeArtistId: number
suite('100 item intake transactions', () => {
  beforeAll(async () => {
    intakeArtistId = (await db.artist.create({ data: { name: 'Intake test ' + randomUUID() } })).id
  })
  afterEach(async () => {
    await db.archiveUploaderSource.deleteMany({ where: { id: { startsWith: prefix } } })
    await db.archiveIntakeSubmission.deleteMany({ where: { requestedByUserId: prefix } })
    await db.systemJob.deleteMany({ where: { requestedByUserId: prefix } })
  })
  afterAll(async () => {

    await db.artist.delete({ where: { id: intakeArtistId } })
    await Promise.all([db.$disconnect(), observer.$disconnect()])
  })

  it('commits 100 linked items in FIFO order with at most 150 database executions', async () => {
    const fixture = await seedBatch()
    const result = await measuredSubmit(fixture, 'idle')
    await assertBatch(result, fixture)
    const originalIds = result.items.map((item) => item.id)
    const [firstReplay, secondReplay] = await Promise.all([submit(fixture), submit(fixture)])
    expect(firstReplay.items.map((item) => item.id)).toEqual(originalIds)
    expect(secondReplay.id).toBe(result.id)
    expect(
      await db.systemJobEvent.count({ where: { jobId: { in: result.items.map((item) => item.currentSystemJobId!) } } })
    ).toBe(100)

    await db.archiveUploaderCatalogItem.updateMany({
      where: { sourceId: fixture.sourceId },
      data: { lastOutcome: 'ARCHIVED', lastOutcomeAt: new Date(), lastErrorCode: null }
    })
    await submit(fixture)
    expect(
      await db.archiveUploaderCatalogItem.count({
        where: { sourceId: fixture.sourceId, lastOutcome: 'ARCHIVED' }
      })
    ).toBe(100)
  })

  it('batch creates direct URL submissions with exact duplicates and stable FIFO', async () => {
    const fixture = await seedBatch()
    const urls = fixture.urls.slice(0, 98)
    const result = await createArchiveIntakeSubmission(
      {
        artistIds: [intakeArtistId],
        idempotencyKey: randomUUID(),
        urls: [...urls, urls[0]!, 'invalid'],
        downloadMode: 'AUTO',
        quality: 'DISPLAY'
      },
      prefix,
      { database: db }
    )
    expect(result).toMatchObject({ rawCount: 100, acceptedCount: 98, duplicateCount: 1, invalidCount: 1 })
    expect(result.items.map((item) => item.submittedUrl)).toEqual(urls)
    expect(result.items.every((item) => item.selectedQuality === 'DISPLAY' && item.downloadMode === 'AUTO')).toBe(true)
    const duplicates = await createArchiveIntakeSubmission(
      { artistIds: [intakeArtistId], idempotencyKey: randomUUID(), urls, downloadMode: 'MANUAL', quality: 'ORIGINAL' },
      prefix,
      { database: db }
    )
    expect(duplicates).toMatchObject({ acceptedCount: 0, duplicateCount: 98 })
    expect(duplicates.items.map((item) => item.duplicateOfItemId)).toEqual(result.items.map((item) => item.id))
    expect(duplicates.items.every((item) => item.currentSystemJobId === null)).toBe(true)
  })

  it('keeps gallery aliases in one manual batch and rejects a later catalog submission before resolution', async () => {
    const fixture = await seedBatch()
    const gid = fixture.externalIds[0]!
    const manualUrls = [`https://e-hentai.org/s/pagekey/${gid}-1`, `https://e-hentai.org/s/pagekey/${gid}-2`]
    const first = await createArchiveIntakeSubmission(
      { artistIds: [intakeArtistId], idempotencyKey: randomUUID(), urls: manualUrls },
      prefix,
      { database: db }
    )
    expect(first.acceptedCount).toBe(2)
    expect(first.items.map((row) => row.providerKey)).toEqual([null, null])
    await expect(submit({ ...fixture, itemIds: [fixture.itemIds[0]!] })).rejects.toThrow('已加入收件箱')
    expect(await db.discoverySourceCreator.count({ where: { sourceId: fixture.sourceId } })).toBe(0)
    expect(await db.archiveIntakeItem.count({ where: { submission: { requestedByUserId: prefix } } })).toBe(2)
  })

  it('reuses the first source intake for a manual page alias while the original resolver is waiting', async () => {
    const fixture = await seedBatch()
    const first = await submit({ ...fixture, itemIds: [fixture.itemIds[0]!] })
    const original = first.items[0]!
    await db.archiveIntakeItem.update({ where: { id: original.id }, data: { status: 'RETRY_WAIT' } })
    const alias = `https://e-hentai.org/s/pagekey/${fixture.externalIds[0]}-2`
    const other = await db.artist.create({ data: { name: prefix + '-manual' } })
    try {
      const second = await createArchiveIntakeSubmission(
        { artistIds: [other.id], idempotencyKey: randomUUID(), urls: [alias] },
        prefix,
        { database: db }
      )
      expect(second).toMatchObject({
        acceptedCount: 0,
        duplicateCount: 1,
        items: [{ status: 'DUPLICATE', duplicateOfItemId: original.id, currentSystemJobId: null }]
      })
      expect(await db.archiveIntakeItem.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({
        assignedArtistIds: [intakeArtistId],
        creatorSourceId: fixture.sourceId,
        status: 'RETRY_WAIT'
      })
    } finally {
      await db.artist.delete({ where: { id: other.id } })
    }
  })

  it('rejects a retry that would race an active gallery alias before remote resolution', async () => {
    const fixture = await seedBatch()
    const original = await submit({ ...fixture, itemIds: [fixture.itemIds[0]!] })
    const failed = original.items[0]!
    await db.archiveIntakeItem.update({ where: { id: failed.id }, data: { status: 'FAILED', retryable: true } })
    await db.systemJob.update({ where: { id: failed.currentSystemJobId! }, data: { status: 'FAILED' } })
    const active = await createArchiveIntakeSubmission(
      {
        artistIds: [intakeArtistId],
        idempotencyKey: randomUUID(),
        urls: [`https://e-hentai.org/s/pagekey/${fixture.externalIds[0]}-2`]
      },
      prefix,
      { database: db }
    )
    const result = await retryArchiveIntakeMany({ idempotencyKey: randomUUID(), itemIds: [failed.id] }, prefix, {
      database: db
    })
    expect(result?.items[0]).toMatchObject({
      result: 'CONFLICT',
      relatedId: active.items[0]!.id,
      code: 'ACTIVE_DUPLICATE'
    })
  })

  it('serializes competing 100 item submissions at the capacity boundary', async () => {
    const filler = await db.archiveIntakeSubmission.create({
      data: {
        idempotencyKey: randomUUID(),
        requestHash: '0'.repeat(64),
        rawCount: 950,
        acceptedCount: 950,
        requestedByUserId: prefix
      }
    })
    await db.archiveIntakeItem.createMany({
      data: Array.from({ length: 950 }, (_, index) => ({
        submissionId: filler.id,
        submittedUrl: `https://fixture.invalid/${filler.id}/${index}`,
        normalizedUrlHash: `${filler.id}-${index}`,
        status: 'QUEUED'
      }))
    })
    const first = await seedBatch()
    const second = await seedBatch()
    const results = await Promise.all([submit(first), submit(second)])
    expect(results.map((result) => result.acceptedCount).sort((a, b) => a - b)).toEqual([0, 50])
    expect(results.reduce((sum, result) => sum + result.rejectedCount, 0)).toBe(150)
    expect(
      await db.archiveIntakeItem.count({
        where: { submission: { requestedByUserId: prefix }, status: 'QUEUED' }
      })
    ).toBe(1000)
    for (const [index, result] of results.entries()) {
      const fixture = [first, second][index]!
      expect(result.items.map((item) => item.submittedUrl)).toEqual(fixture.urls.slice(0, result.acceptedCount))
      expect(
        await db.archiveUploaderCatalogItem.count({
          where: { sourceId: fixture.sourceId, lastOutcome: 'SUBMITTED' }
        })
      ).toBe(result.acceptedCount)
    }
  })

  it('keeps deleted URLs manual-only after cleanup and rejects any unfinished cleanup', async () => {
    const fixture = await seedBatch()
    const identities = [randomUUID(), randomUUID(), randomUUID()]
    const now = new Date()
    await db.archiveDeletedIdentity.createMany({
      data: identities.map((externalId, index) => ({
        providerKey: 'e-hentai',
        externalId,
        canonicalUrl: fixture.urls[index === 0 ? 0 : 1]!,
        artworkId: -1,
        deletedAt: now,
        purgedAt: index === 1 ? null : now
      }))
    })
    try {
      const urls = fixture.urls.slice(0, 2)
      const auto = await createArchiveIntakeSubmission(
        { artistIds: [intakeArtistId], idempotencyKey: randomUUID(), urls, downloadMode: 'AUTO' },
        prefix,
        { database: db }
      )
      expect(auto).toMatchObject({ acceptedCount: 0, rejectedCount: 2 })
      const manual = await createArchiveIntakeSubmission(
        { artistIds: [intakeArtistId], idempotencyKey: randomUUID(), urls, downloadMode: 'MANUAL' },
        prefix,
        { database: db }
      )
      expect(manual).toMatchObject({ acceptedCount: 1, rejectedCount: 1 })
      expect(manual.items[0]?.submittedUrl).toBe(urls[0])
    } finally {
      await db.archiveDeletedIdentity.deleteMany({ where: { providerKey: 'e-hentai', externalId: { in: identities } } })
    }
  })

  it.each(['events', 'catalog'] as const)(
    'rolls back every write after a %s failure, then reuses the attempt',
    async (failureAt) => {
      const fixture = await seedBatch()
      const failingDb = wrapTransactions(
        db,
        (tx) =>
          new Proxy(tx, {
            get(target, property) {
              if (failureAt === 'catalog' && property === '$executeRaw') {
                return async () => {
                  throw new Error('injected catalog failure')
                }
              }
              if (failureAt === 'events' && property === 'systemJobEvent') {
                return new Proxy(target.systemJobEvent, {
                  get(delegate, method) {
                    if (method === 'createMany') {
                      return async () => {
                        throw new Error('injected events failure')
                      }
                    }
                    return Reflect.get(delegate, method)
                  }
                })
              }
              return Reflect.get(target, property)
            }
          })
      )
      await expect(submit(fixture, failingDb)).rejects.toThrow(`injected ${failureAt} failure`)
      await assertEmpty(fixture)
      await assertBatch(await submit(fixture), fixture)
    }
  )

  it.each(['identity', 'creator catalog'] as const)(
    'waits on the %s lock for over five seconds and still commits 100 items',
    async (lock) => {
      const fixture = await seedBatch()
      const held = deferred()
      const release = deferred()
      const holder = observer.$transaction(
        async (tx) => {
          if (lock === 'identity') {
            await tx.$queryRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(20260903::integer, hashtext(${`e-hentai\n${fixture.externalIds[0]}`}::text))::text
        `)
          } else {
            await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(7341902118::bigint)::text`)
          }
          held.resolve()
          await release.promise
        },
        { timeout: 15_000 }
      )
      await held.promise
      const pending = submit(fixture)
      const outcome = pending.then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      )
      try {
        await waitForLock()
        await delay(5_500)
      } finally {
        release.resolve()
        await holder
      }
      const result = await outcome
      if ('error' in result) throw result.error
      await assertBatch(result.value, fixture)
    },
    20_000
  )

  it('rolls back all prior writes when a final catalog lock exceeds the 30 second budget', async () => {
    const fixture = await seedBatch()
    const held = deferred()
    const release = deferred()
    // A row lock blocks only the final catalog update; the request has already created jobs/items/events.
    const holder = observer.$transaction(
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`
        SELECT id FROM archive_uploader_catalog_items WHERE id = ${fixture.itemIds[0]} FOR UPDATE
      `)
        held.resolve()
        await release.promise
      },
      { timeout: 45_000 }
    )
    await held.promise
    const started = performance.now()
    const outcome = submit(fixture).then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    )
    try {
      await waitForLock()
      await delay(30_500)
    } finally {
      release.resolve()
      await holder
    }
    const result = await outcome
    expect(result).toHaveProperty('error')
    expect(performance.now() - started).toBeGreaterThanOrEqual(30_000)
    await assertEmpty(fixture)
    await assertBatch(await submit(fixture), fixture)
  }, 45_000)

  it.each(
    [1, 2, 3].flatMap((round) =>
      (['transfer', 'checkpoint', 'publication'] as const).map((phase) => ({ phase, round }))
    )
  )(
    'commits 100 items with real resolver and archive phase executors running ($phase round $round)',
    async ({ phase, round }) => {
      const fixture = await seedBatch()
      await runConcurrentArchiveTasks(db, prefix, intakeArtistId, phase, async () => {
        const result = await measuredSubmit(fixture, `${phase}-${round}`)
        await assertBatch(result, fixture)
      })
    },
    30_000
  )

  it('rejects a batch containing a gallery with an active intake instead of bypassing conflicts', async () => {
    const fixture = await seedBatch()
    await createArchiveIntakeSubmission(
      { artistIds: [intakeArtistId], idempotencyKey: randomUUID(), urls: [fixture.urls[0]!] },
      prefix,
      { database: db }
    )
    const before = await db.archiveIntakeSubmission.count({ where: { requestedByUserId: prefix } })
    await expect(submit(fixture)).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(await db.archiveIntakeSubmission.count({ where: { requestedByUserId: prefix } })).toBe(before)
    expect(
      await db.archiveUploaderCatalogItem.count({
        where: { sourceId: fixture.sourceId, lastIntakeItemId: { not: null } }
      })
    ).toBe(0)
  })
})

async function seedBatch() {
  const sourceId = `${prefix}-${fixtureIndex++}`
  const now = new Date()
  // Keep numeric gallery IDs within Number.MAX_SAFE_INTEGER, as required by the real URL parser.
  const firstExternalId = Date.now() * 1_000
  const externalIds = Array.from({ length: 100 }, (_, index) => String(firstExternalId + index))
  const urls = externalIds.map((id) => `https://e-hentai.org/g/${id}/batchtest/`)
  const itemIds = externalIds.map((_, index) => `${sourceId}-${index.toString().padStart(3, '0')}`)
  await db.archiveUploaderSource.create({
    data: {
      id: sourceId,
      providerKey: 'e-hentai',
      identityKind: 'UID',
      identityValue: sourceId,
      normalizedIdentity: sourceId,
      displayName: 'Batch regression'
    }
  })
  await db.archiveUploaderCatalogItem.createMany({
    data: externalIds.map((externalId, index) => ({
      id: itemIds[index]!,
      sourceId,
      providerKey: 'e-hentai',
      externalId,
      canonicalUrl: urls[index]!,
      title: 'Batch fixture',
      relationships: [],
      classification: 'NEW',
      firstSeenAt: now,
      lastSeenAt: now
    }))
  })
  return { sourceId, itemIds, externalIds, urls, submissionAttemptId: randomUUID() }
}

type BatchFixture = Awaited<ReturnType<typeof seedBatch>>
type Submission = Awaited<ReturnType<typeof submit>>

function submit(fixture: BatchFixture, database: PrismaClient = db) {
  return addArchiveUploaderScanItems(
    {
      artistIds: [intakeArtistId],
      sourceId: fixture.sourceId,
      itemIds: fixture.itemIds,
      submissionAttemptId: fixture.submissionAttemptId,
      downloadMode: 'AUTO',
      quality: 'ORIGINAL'
    },
    prefix,
    { database }
  )
}

async function measuredSubmit(fixture: BatchFixture, phase: string) {
  // A separate client counts only the request, not concurrently executing Worker queries.
  const measuredUrl = new URL(url!.toString())
  measuredUrl.searchParams.set('application_name', `${applicationName}-request`)
  const measured = new PrismaClient({ datasourceUrl: measuredUrl.toString(), log: [{ emit: 'event', level: 'query' }] })
  let count = 0
  measured.$on('query', () => {
    count += 1
  })
  try {
    await measured.$connect()
    const started = performance.now()
    const result = await submit(fixture, measured)
    const durationMs = Math.round(performance.now() - started)
    logger.info('Archive intake benchmark', { benchmark: 'intake-100', phase, queries: count, durationMs })
    expect(count).toBeLessThanOrEqual(150)
    expect(durationMs).toBeLessThan(30_000)
    return result
  } finally {
    await measured.$disconnect()
  }
}

async function assertBatch(result: Submission, fixture: BatchFixture) {
  expect(result).toMatchObject({
    acceptedCount: 100,
    rawCount: 100,
    invalidCount: 0,
    duplicateCount: 0,
    rejectedCount: 0
  })
  expect(result.items.map((item) => item.submittedUrl)).toEqual(fixture.urls)
  expect(new Set(result.items.map((item) => item.queueOrder)).size).toBe(100)
  expect(
    result.items.every(
      (item, index) => index === 0 || BigInt(item.queueOrder) > BigInt(result.items[index - 1]!.queueOrder)
    )
  ).toBe(true)
  const jobIds = result.items.map((item) => item.currentSystemJobId!)
  expect(await db.systemJob.count({ where: { id: { in: jobIds }, type: 'ARCHIVE_RESOLVE_ITEM' } })).toBe(100)
  expect(await db.systemJobEvent.count({ where: { jobId: { in: jobIds }, type: 'job.queued' } })).toBe(100)
  const catalog = await db.archiveUploaderCatalogItem.findMany({
    where: { sourceId: fixture.sourceId },
    orderBy: { id: 'asc' }
  })
  expect(catalog.map((item) => item.lastIntakeItemId)).toEqual(result.items.map((item) => item.id))
  expect(catalog.every((item) => item.lastOutcome === 'SUBMITTED')).toBe(true)
}

async function assertEmpty(fixture: BatchFixture) {
  expect(await db.archiveIntakeSubmission.count({ where: { requestedByUserId: prefix } })).toBe(0)
  expect(await db.systemJob.count({ where: { requestedByUserId: prefix } })).toBe(0)
  expect(await db.archiveIntakeItem.count({ where: { submittedUrl: { in: fixture.urls } } })).toBe(0)
  const catalog = await db.archiveUploaderCatalogItem.findMany({ where: { sourceId: fixture.sourceId } })
  expect(catalog.every((item) => item.lastIntakeItemId === null && item.lastOutcome === null)).toBe(true)
}

function wrapTransactions(database: PrismaClient, wrap: (tx: Prisma.TransactionClient) => Prisma.TransactionClient) {
  return new Proxy(database, {
    get(target, property) {
      if (property === '$transaction') {
        return (
          operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: { timeout?: number; maxWait?: number }
        ) => target.$transaction((tx) => operation(wrap(tx)), options)
      }
      return Reflect.get(target, property)
    }
  })
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function waitForLock() {
  await vi.waitFor(
    async () => {
      const blocked = await observer.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT count(*) FROM pg_stat_activity
      WHERE application_name = ${applicationName} AND wait_event_type = 'Lock'
    `)
      expect(Number(blocked[0]?.count)).toBeGreaterThan(0)
    },
    { timeout: 5_000, interval: 25 }
  )
}
