import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@pixishelf/db'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  addArchiveUploaderScanItems,
  ignoreArchiveUploaderScanItems,
  listArchiveUploaderIgnoredItems,
  listArchiveUploaderScanItems,
  restoreArchiveUploaderIgnoredItems
} from '../archive-uploader-service'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const prefix = `archive-uploader-ignore-${randomUUID()}`
const sharedExternalId = Number.parseInt(randomUUID().replaceAll('-', '').slice(0, 12), 16).toString()
const secondExternalId = (BigInt(sharedExternalId) + 1n).toString()

describePostgres('archive uploader ignored gallery PostgreSQL integration', () => {
  beforeEach(cleanupDatabase)

  afterAll(async () => {
    if (!prisma) return
    await cleanupDatabase()
    await prisma.$disconnect()
  })

  it('applies an ignored Provider/GID globally and restores it without changing scan history', async () => {
    const first = await seedCompletedScan('first', '1001')
    const second = await seedCompletedScan('second', '1002')

    const ignored = await ignoreArchiveUploaderScanItems(
      { sourceId: first.sourceId, itemIds: [first.itemId] },
      'admin-1',
      { database: db() }
    )
    expect(ignored).toMatchObject({ ignoredCount: 1, createdCount: 1, reusedCount: 0 })

    await expect(
      ignoreArchiveUploaderScanItems({ sourceId: second.sourceId, itemIds: [second.itemId] }, 'admin-1', {
        database: db()
      })
    ).resolves.toMatchObject({ ignoredCount: 1, createdCount: 0, reusedCount: 1 })

    await expect(
      listArchiveUploaderScanItems({ sourceId: second.sourceId, limit: 50 }, { database: db() })
    ).resolves.toMatchObject({ items: [] })
    const ignoredFeed = await listArchiveUploaderIgnoredItems({ limit: 50 }, { database: db() })
    expect(ignoredFeed.items).toContainEqual(
      expect.objectContaining({ externalId: sharedExternalId, sourceDisplayName: 'Uploader first' })
    )

    await restoreArchiveUploaderIgnoredItems({ ignoredItemIds: ignored.ignoredItemIds }, { database: db() })
    const restoredFeed = await listArchiveUploaderScanItems(
      { sourceId: second.sourceId, limit: 50 },
      { database: db() }
    )
    expect(restoredFeed.items).toHaveLength(1)
    expect(restoredFeed.items[0]).toMatchObject({
      externalId: sharedExternalId,
      thumbnailUrl: 'https://ehgt.org/thumb.jpg'
    })
    await expect(
      db().archiveUploaderScanItem.count({ where: { id: { in: [first.itemId, second.itemId] } } })
    ).resolves.toBe(2)
  })

  it('serializes ignore before intake so a stale add attempt cannot enqueue the same gallery', async () => {
    const ignoreScan = await seedCompletedScan('ignore-wins-first', '2001')
    const addScan = await seedCompletedScan('ignore-wins-second', '2002')
    const ignoreLocked = deferred()
    const releaseIgnore = deferred()
    const addReachedLock = deferred()
    const ignorePromise = ignoreArchiveUploaderScanItems(
      { sourceId: ignoreScan.sourceId, itemIds: [ignoreScan.itemId] },
      `${prefix}-admin`,
      {
        database: databaseWithFirstLockHooks({
          after: async () => {
            ignoreLocked.resolve()
            await releaseIgnore.promise
          }
        })
      }
    )
    await ignoreLocked.promise
    const addPromise = addArchiveUploaderScanItems(
      {
        sourceId: addScan.sourceId,
        submissionAttemptId: randomUUID(),
        itemIds: [addScan.itemId]
      },
      `${prefix}-admin`,
      {
        database: databaseWithFirstLockHooks({ before: async () => addReachedLock.resolve() }),
        uuid: prefixedUuidFactory('ignore-wins')
      }
    )
    await addReachedLock.promise
    releaseIgnore.resolve()

    const [ignoreResult, addResult] = await Promise.allSettled([ignorePromise, addPromise])
    expect(ignoreResult.status).toBe('fulfilled')
    expect(addResult).toMatchObject({ status: 'rejected', reason: { code: 'STATE_CONFLICT' } })
    await expect(
      db().archiveUploaderIgnoredItem.count({ where: { providerKey: 'e-hentai', externalId: sharedExternalId } })
    ).resolves.toBe(1)
    await expect(db().archiveIntakeSubmission.count({ where: { requestedByUserId: `${prefix}-admin` } })).resolves.toBe(
      0
    )
  })

  it('serializes intake before ignore so an enqueued gallery cannot become globally ignored', async () => {
    const addScan = await seedCompletedScan('intake-wins-first', '3001')
    const ignoreScan = await seedCompletedScan('intake-wins-second', '3002')
    const addLocked = deferred()
    const releaseAdd = deferred()
    const ignoreReachedLock = deferred()
    const addPromise = addArchiveUploaderScanItems(
      {
        sourceId: addScan.sourceId,
        submissionAttemptId: randomUUID(),
        itemIds: [addScan.itemId]
      },
      `${prefix}-admin`,
      {
        database: databaseWithFirstLockHooks({
          after: async () => {
            addLocked.resolve()
            await releaseAdd.promise
          }
        }),
        uuid: prefixedUuidFactory('intake-wins')
      }
    )
    await addLocked.promise
    const ignorePromise = ignoreArchiveUploaderScanItems(
      { sourceId: ignoreScan.sourceId, itemIds: [ignoreScan.itemId] },
      `${prefix}-admin`,
      { database: databaseWithFirstLockHooks({ before: async () => ignoreReachedLock.resolve() }) }
    )
    await ignoreReachedLock.promise
    releaseAdd.resolve()

    const [addResult, ignoreResult] = await Promise.allSettled([addPromise, ignorePromise])
    expect(addResult).toMatchObject({ status: 'fulfilled', value: { acceptedCount: 1 } })
    expect(ignoreResult).toMatchObject({ status: 'rejected', reason: { code: 'STATE_CONFLICT' } })
    await expect(
      db().archiveUploaderIgnoredItem.count({ where: { providerKey: 'e-hentai', externalId: sharedExternalId } })
    ).resolves.toBe(0)
    await expect(
      db().archiveUploaderScanItem.findUniqueOrThrow({ where: { id: addScan.itemId } })
    ).resolves.toMatchObject({ intakeItemId: expect.any(String) })
    await expect(
      db().archiveUploaderScanItem.findUniqueOrThrow({ where: { id: ignoreScan.itemId } })
    ).resolves.toMatchObject({ intakeItemId: null })
  })

  it('rolls back an entire intake batch when any selected Provider/GID is ignored', async () => {
    const scan = await seedCompletedScan('batch', '2003')
    const secondItemId = `${prefix}-item-batch-second`
    await db().archiveUploaderScanItem.create({
      data: {
        id: secondItemId,
        runId: scan.runId,
        providerKey: 'e-hentai',
        externalId: secondExternalId,
        canonicalUrl: `https://e-hentai.org/g/${secondExternalId}/private-token/`,
        title: 'Ignored batch gallery',
        metadataFingerprint: 'b'.repeat(64),
        relationships: {},
        classification: 'NEW'
      }
    })
    await db().archiveUploaderIgnoredItem.create({
      data: {
        id: `${prefix}-ignored-batch`,
        providerKey: 'e-hentai',
        externalId: secondExternalId,
        sourceId: scan.sourceId,
        sourceDisplayName: 'Uploader batch',
        title: 'Ignored batch gallery'
      }
    })

    await expect(
      addArchiveUploaderScanItems(
        {
          sourceId: scan.sourceId,
          submissionAttemptId: randomUUID(),
          itemIds: [scan.itemId, secondItemId]
        },
        `${prefix}-batch-admin`,
        { database: db(), uuid: prefixedUuidFactory('batch') }
      )
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    await expect(
      db().archiveIntakeSubmission.count({ where: { requestedByUserId: `${prefix}-batch-admin` } })
    ).resolves.toBe(0)
    await expect(
      db().archiveUploaderScanItem.count({
        where: { id: { in: [scan.itemId, secondItemId] }, intakeItemId: { not: null } }
      })
    ).resolves.toBe(0)
  })
})

async function seedCompletedScan(suffix: string, uploaderUid: string) {
  const sourceId = `${prefix}-source-${suffix}`
  const runId = `${prefix}-run-${suffix}`
  const jobId = `${prefix}-job-${suffix}`
  const itemId = `${prefix}-item-${suffix}`
  await db().archiveUploaderSource.create({
    data: {
      id: sourceId,
      providerKey: 'e-hentai',
      identityKind: 'UID',
      identityValue: uploaderUid,
      normalizedIdentity: uploaderUid,
      displayName: `Uploader ${suffix}`
    }
  })
  await db().systemJob.create({
    data: {
      id: jobId,
      type: 'ARCHIVE_UPLOADER_SCAN',
      executionLane: 'ARCHIVE_RESOLVE',
      definitionVersion: 1,
      status: 'COMPLETED',
      triggerSource: 'MANUAL',
      payload: { scanRunId: runId },
      queuePriority: 20,
      effectivePriority: 20,
      availableAt: new Date('2026-09-02T00:00:00.000Z'),
      finishedAt: new Date('2026-09-02T00:01:00.000Z'),
      progress: 100
    }
  })
  await db().archiveUploaderScanRun.create({
    data: {
      id: runId,
      sourceId,
      systemJobId: jobId,
      mode: 'LATEST',
      status: 'COMPLETED',
      itemCount: 1,
      newCount: 1,
      finishedAt: new Date('2026-09-02T00:01:00.000Z')
    }
  })
  await db().archiveUploaderScanItem.create({
    data: {
      id: itemId,
      runId,
      providerKey: 'e-hentai',
      externalId: sharedExternalId,
      canonicalUrl: `https://e-hentai.org/g/${sharedExternalId}/private-token/`,
      title: 'Shared gallery',
      thumbnailUrl: 'https://ehgt.org/thumb.jpg?secret=1',
      uploaderName: `Uploader ${suffix}`,
      postedAt: new Date('2026-09-01T00:00:00.000Z'),
      metadataFingerprint: 'a'.repeat(64),
      relationships: {},
      classification: 'NEW'
    }
  })
  return { sourceId, runId, jobId, itemId }
}

async function cleanupDatabase() {
  if (!prisma) return
  await prisma.archiveUploaderIgnoredItem.deleteMany({
    where: {
      OR: [
        { id: { startsWith: prefix } },
        { sourceId: { startsWith: prefix } },
        { ignoredByUserId: { startsWith: prefix } },
        {
          providerKey: 'e-hentai',
          externalId: '9001',
          title: 'Shared gallery',
          sourceDisplayName: { startsWith: 'Uploader ' },
          ignoredByUserId: 'admin-1'
        }
      ]
    }
  })
  await prisma.archiveUploaderScanRun.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.archiveUploaderSource.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.archiveIntakeSubmission.deleteMany({
    where: { OR: [{ id: { startsWith: prefix } }, { requestedByUserId: { startsWith: prefix } }] }
  })
  await prisma.systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
}

function databaseWithFirstLockHooks(hooks: { before?: () => Promise<void>; after?: () => Promise<void> }) {
  const database = db()
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property !== '$transaction') return Reflect.get(target, property, receiver)
      return (operation: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
        target.$transaction(async (transaction) => {
          let lockCount = 0
          const hookedTransaction = new Proxy(transaction, {
            get(transactionTarget, transactionProperty, transactionReceiver) {
              if (transactionProperty !== '$queryRaw') {
                return Reflect.get(transactionTarget, transactionProperty, transactionReceiver)
              }
              return async (...args: unknown[]) => {
                if (lockCount === 0) await hooks.before?.()
                const result = await Reflect.apply(transactionTarget.$queryRaw, transactionTarget, args)
                if (lockCount === 0) await hooks.after?.()
                lockCount += 1
                return result
              }
            }
          })
          return operation(hookedTransaction)
        })
    }
  })
}

function prefixedUuidFactory(suffix: string) {
  let sequence = 0
  return () => `${prefix}-${suffix}-${++sequence}`
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function db() {
  if (!prisma) throw new Error('QUEUE_KERNEL_TEST_DATABASE_URL is required')
  return prisma
}
