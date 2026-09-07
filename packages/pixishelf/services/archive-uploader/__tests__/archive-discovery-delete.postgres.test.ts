import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Prisma, PrismaClient } from '@pixishelf/db'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  cancelArchiveUploaderScan,
  createArchiveTitleSource,
  createArchiveUploaderSource,
  deleteArchiveDiscoverySource,
  getArchiveDiscoverySourceDeletePreview,
  triggerArchiveUploaderScan,
  addArchiveUploaderScanItems,
  ignoreArchiveUploaderScanItems
} from '../archive-uploader-service'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const prefix = `discovery-delete-${randomUUID()}`
const sharedExternalId = Number.parseInt(randomUUID().replaceAll('-', '').slice(0, 12), 16).toString()
const secondExternalId = (BigInt(sharedExternalId) + 1n).toString()

describePostgres('discovery source deletion PostgreSQL integration', () => {
  beforeEach(cleanupDatabase)
  afterAll(async () => {
    if (!prisma) return
    await cleanupDatabase()
    await prisma.$disconnect()
  })
  it.each(['UPLOADER', 'TITLE_QUERY'] as const)(
    'deletes an unused %s source and frees its identity for recreation',
    async (kind) => {
      const dependencies = { database: db(), sourceKind: 'ALL' as const }
      const create = () =>
        kind === 'UPLOADER'
          ? createArchiveUploaderSource({ identityKind: 'NAME', identityValue: `${prefix}-blank` }, dependencies)
          : createArchiveTitleSource({ displayName: `${prefix}-blank`, keyword: `${prefix} blank` }, dependencies)
      const first = await create()
      await db().archiveUploaderSource.update({ where: { id: first.id }, data: { status: 'ARCHIVED' } })
      await expect(getArchiveDiscoverySourceDeletePreview({ sourceId: first.id }, dependencies)).resolves.toMatchObject(
        {
          scanRunCount: 0,
          catalogItemCount: 0,
          blockingRun: null
        }
      )
      await expect(deleteArchiveDiscoverySource({ sourceId: first.id }, dependencies)).resolves.toMatchObject({
        deleted: true
      })
      await expect(deleteArchiveDiscoverySource({ sourceId: first.id }, dependencies)).resolves.toMatchObject({
        deleted: false
      })
      await expect(getArchiveDiscoverySourceDeletePreview({ sourceId: first.id }, dependencies)).resolves.toBeNull()
      const second = await create()
      expect(second.id).not.toBe(first.id)
      expect(second).toMatchObject({ status: 'ACTIVE', latestSeenExternalId: null, canContinueHistory: false })
    }
  )

  it.each(['UPLOADER', 'TITLE_QUERY'] as const)(
    'deletes only owned %s discovery rows and preserves workflows, media, ignores and jobs',
    async (kind) => {
      const owned = await seedCompletedScan('delete-owned', '6001')
      const other = await seedCompletedScan('delete-other', '6002')
      if (kind === 'TITLE_QUERY') {
        await db().archiveUploaderSource.update({
          where: { id: owned.sourceId },
          data: {
            sourceKind: kind,
            identityKind: null,
            identityValue: null,
            normalizedIdentity: null,
            titleQuery: { keyword: 'Example', matchMode: 'CONTAINS', uploaderUid: null },
            queryKey: 'd'.repeat(64)
          }
        })
        await db().archiveUploaderScanRun.update({
          where: { id: owned.runId },
          data: {
            searchIdentityKind: null,
            searchIdentityValue: null,
            titleQuery: { keyword: 'Example', matchMode: 'CONTAINS', uploaderUid: null }
          }
        })
        await db().systemJob.update({ where: { id: owned.jobId }, data: { type: 'ARCHIVE_SEARCH_SCAN' } })
      }
      const deps = { database: db(), sourceKind: 'ALL' as const }
      const submitted = await addArchiveUploaderScanItems(
        { sourceId: owned.sourceId, itemIds: [owned.catalogItemId], submissionAttemptId: randomUUID() },
        prefix,
        deps
      )
      const intake = await db().archiveIntakeItem.findFirstOrThrow({ where: { submissionId: submitted.id } })
      await db().archiveUploaderScanItem.update({ where: { id: owned.scanItemId }, data: { intakeItemId: intake.id } })
      const folder = await mkdtemp(path.join(tmpdir(), 'discovery-delete-'))
      expect(path.dirname(path.resolve(folder))).toBe(path.resolve(tmpdir()))
      expect(path.basename(folder).startsWith('discovery-delete-')).toBe(true)
      const mediaPath = path.join(folder, 'retained.jpg')
      await writeFile(mediaPath, 'retained original media')
      const artwork = await db().artwork.create({
        data: { title: `${prefix}-retained`, images: { create: { path: mediaPath } } },
        include: { images: true }
      })
      try {
        const reference = await db().artworkExternalRef.create({
          data: {
            artworkId: artwork.id,
            providerKey: 'e-hentai',
            externalId: sharedExternalId,
            canonicalUrl: intake.submittedUrl,
            locator: {},
            status: 'SUCCESS'
          }
        })
        const importJob = await db().systemJob.create({
          data: {
            ...scanJobData(`${prefix}-import-job`, 'unused', new Date()),
            type: 'ARCHIVE_IMPORT',
            executionLane: 'BACKGROUND_WRITER',
            definitionVersion: 2,
            payload: { archiveImportId: `${prefix}-import`, defaultTagIds: [] }
          }
        })
        const archive = await db().archiveImport.create({
          data: {
            id: `${prefix}-import`,
            systemJobId: importJob.id,
            providerKey: 'e-hentai',
            externalId: sharedExternalId,
            submittedUrl: intake.submittedUrl,
            canonicalUrl: intake.submittedUrl,
            locator: {},
            normalizedMetadata: {},
            rawMetadata: {},
            metadataHash: 'a'.repeat(64),
            creatorBucket: 'test',
            stagingPath: `${prefix}/staging`,
            status: 'RUNNING',
            publishedArtworkId: artwork.id
          }
        })
        await db().archiveIntakeItem.update({
          where: { id: intake.id },
          data: { archiveImportId: archive.id, status: 'ENQUEUED' }
        })
        await db().archiveUploaderCatalogItem.updateMany({
          where: { id: { in: [owned.catalogItemId, other.catalogItemId] } },
          data: { lastArchiveImportId: archive.id }
        })
        const ignored = await db().archiveUploaderIgnoredItem.create({
          data: {
            providerKey: 'e-hentai',
            externalId: secondExternalId,
            sourceId: owned.sourceId,
            sourceDisplayName: 'Deleted source snapshot',
            title: 'Retained ignore',
            ignoredByUserId: prefix
          }
        })
        const event = await db().systemJobEvent.create({ data: { jobId: owned.jobId, type: 'job.completed' } })
        const preserved = await Promise.all([
          db().archiveIntakeSubmission.findUnique({ where: { id: submitted.id } }),
          db().archiveIntakeItem.findUnique({ where: { id: intake.id } }),
          db().archiveImport.findUnique({ where: { id: archive.id } }),
          db().artwork.findUnique({ where: { id: artwork.id } }),
          db().image.findMany({ where: { artworkId: artwork.id } }),
          db().archiveUploaderCatalogItem.findUnique({ where: { id: other.catalogItemId } })
        ])
        await expect(getArchiveDiscoverySourceDeletePreview({ sourceId: owned.sourceId }, deps)).resolves.toMatchObject(
          { scanRunCount: 1, catalogItemCount: 1, blockingRun: null }
        )
        await deleteArchiveDiscoverySource({ sourceId: owned.sourceId }, deps)
        expect(
          await Promise.all([
            db().archiveIntakeSubmission.findUnique({ where: { id: submitted.id } }),
            db().archiveIntakeItem.findUnique({ where: { id: intake.id } }),
            db().archiveImport.findUnique({ where: { id: archive.id } }),
            db().artwork.findUnique({ where: { id: artwork.id } }),
            db().image.findMany({ where: { artworkId: artwork.id } }),
            db().archiveUploaderCatalogItem.findUnique({ where: { id: other.catalogItemId } })
          ])
        ).toEqual(preserved)
        expect(await db().archiveUploaderScanRun.count({ where: { id: owned.runId } })).toBe(0)
        expect(await db().archiveUploaderScanItem.count({ where: { id: owned.scanItemId } })).toBe(0)
        expect(await db().archiveUploaderCatalogItem.count({ where: { sourceId: owned.sourceId } })).toBe(0)
        expect(await db().systemJob.count({ where: { id: { in: [owned.jobId, importJob.id] } } })).toBe(2)
        expect(await db().systemJobEvent.count({ where: { id: event.id } })).toBe(1)
        expect(await db().artworkExternalRef.findUnique({ where: { id: reference.id } })).toEqual(reference)
        expect(await db().archiveUploaderIgnoredItem.findUnique({ where: { id: ignored.id } })).toMatchObject({
          sourceId: null,
          sourceDisplayName: 'Deleted source snapshot'
        })
        expect(await readFile(mediaPath, 'utf8')).toBe('retained original media')
      } finally {
        await db().image.deleteMany({ where: { artworkId: artwork.id } })
        // This mkdtemp directory was checked before creating the fixture.
        await rm(folder, { recursive: true, force: true })
      }
    }
  )

  it.each(['PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSED', 'COMPLETED'] as const)(
    'blocks deletion with a %s scan or its nonterminal job',
    async (status) => {
      const owned = await seedCompletedScan('delete-blocked', '6010')
      await db().archiveUploaderScanRun.update({ where: { id: owned.runId }, data: { status } })
      if (status === 'COMPLETED') {
        await db().systemJob.update({ where: { id: owned.jobId }, data: { status: 'PENDING', finishedAt: null } })
      }
      const deps = { database: db() }
      expect((await getArchiveDiscoverySourceDeletePreview({ sourceId: owned.sourceId }, deps))?.blockingRun?.id).toBe(
        owned.runId
      )
      await expect(deleteArchiveDiscoverySource({ sourceId: owned.sourceId }, deps)).rejects.toMatchObject({
        code: 'STATE_CONFLICT'
      })
      expect(await db().archiveUploaderCatalogItem.count({ where: { sourceId: owned.sourceId } })).toBe(1)
    }
  )

  it('rolls back all cascades if the delete transaction fails before commit', async () => {
    const owned = await seedCompletedScan('delete-rollback', '6011')
    await expect(
      deleteArchiveDiscoverySource(
        { sourceId: owned.sourceId },
        {
          database: databaseBeforeCommit(async () => {
            throw new Error('injected rollback')
          })
        }
      )
    ).rejects.toThrow('injected rollback')
    expect(await db().archiveUploaderSource.count({ where: { id: owned.sourceId } })).toBe(1)
    expect(await db().archiveUploaderScanRun.count({ where: { id: owned.runId } })).toBe(1)
    expect(await db().archiveUploaderScanItem.count({ where: { id: owned.scanItemId } })).toBe(1)
    expect(await db().archiveUploaderCatalogItem.count({ where: { id: owned.catalogItemId } })).toBe(1)
  })

  it('makes concurrent repeated deletion idempotent', async () => {
    const owned = await seedCompletedScan('delete-repeated', '6012')
    const remove = (database: PrismaClient) => deleteArchiveDiscoverySource({ sourceId: owned.sourceId }, { database })
    expect(await raceSourceOperations(remove, remove)).toMatchObject([
      { status: 'fulfilled', value: { deleted: true } },
      { status: 'fulfilled', value: { deleted: false } }
    ])
  })

  it.each(['add', 'ignore', 'scan'] as const)(
    'rejects stale %s when deletion wins the source lock',
    async (operation) => {
      const owned = await seedCompletedScan(`delete-first-${operation}`, '6020')
      const results = await raceSourceOperations(
        (database) => deleteArchiveDiscoverySource({ sourceId: owned.sourceId }, { database }),
        (database) => disposition(operation, owned, database)
      )
      expect(results[0]).toMatchObject({ status: 'fulfilled', value: { deleted: true } })
      expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'STATE_CONFLICT' } })
      expect(await db().archiveIntakeSubmission.count({ where: { requestedByUserId: prefix } })).toBe(0)
      expect(await db().archiveUploaderIgnoredItem.count({ where: { ignoredByUserId: prefix } })).toBe(0)
      expect(await db().systemJob.count({ where: { requestedByUserId: prefix } })).toBe(0)
    }
  )

  it.each(['add', 'ignore', 'scan'] as const)(
    'preserves the result when %s wins before deletion',
    async (operation) => {
      const owned = await seedCompletedScan(`delete-second-${operation}`, '6021')
      const results = await raceSourceOperations(
        (database) => disposition(operation, owned, database),
        (database) => deleteArchiveDiscoverySource({ sourceId: owned.sourceId }, { database })
      )
      expect(results[0]?.status).toBe('fulfilled')
      if (operation === 'scan') {
        expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'STATE_CONFLICT' } })
        expect(await db().archiveUploaderSource.count({ where: { id: owned.sourceId } })).toBe(1)
      } else {
        expect(results[1]).toMatchObject({ status: 'fulfilled', value: { deleted: true } })
        if (operation === 'add') {
          expect(await db().archiveIntakeItem.count({ where: { submission: { requestedByUserId: prefix } } })).toBe(1)
        } else {
          expect(await db().archiveUploaderIgnoredItem.findFirst({ where: { ignoredByUserId: prefix } })).toMatchObject(
            { sourceId: null }
          )
        }
      }
    }
  )

  it('waits for cancellation to commit and then permits an explicit deletion', async () => {
    const owned = await seedCompletedScan('delete-cancel', '6022')
    await db().systemJob.update({ where: { id: owned.jobId }, data: { status: 'PENDING', finishedAt: null } })
    await db().archiveUploaderScanRun.update({
      where: { id: owned.runId },
      data: { status: 'PENDING', finishedAt: null }
    })
    const cancelling = deferred()
    const release = deferred()
    const pending = cancelArchiveUploaderScan(
      { sourceId: owned.sourceId, runId: owned.runId },
      {
        database: databaseBeforeCommit(async () => {
          cancelling.resolve()
          await release.promise
        })
      }
    )
    await cancelling.promise
    try {
      await expect(
        deleteArchiveDiscoverySource({ sourceId: owned.sourceId }, { database: db() })
      ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    } finally {
      release.resolve()
    }
    await pending
    expect(await db().archiveUploaderSource.count({ where: { id: owned.sourceId } })).toBe(1)
    await expect(deleteArchiveDiscoverySource({ sourceId: owned.sourceId }, { database: db() })).resolves.toMatchObject(
      { deleted: true }
    )
    expect(await db().systemJob.findUnique({ where: { id: owned.jobId } })).toMatchObject({ status: 'CANCELLED' })
  })
})

function scanJobData(id: string, scanRunId: string, now: Date) {
  return {
    id,
    type: 'ARCHIVE_UPLOADER_SCAN' as const,
    executionLane: 'ARCHIVE_RESOLVE' as const,
    definitionVersion: 1,
    status: 'PENDING' as const,
    triggerSource: 'MANUAL' as const,
    payload: { scanRunId },
    queuePriority: 20,
    effectivePriority: 20,
    availableAt: now,
    maxAttempts: 3,
    createdAt: now,
    updatedAt: now
  }
}

async function seedCompletedScan(suffix: string, uploaderUid: string) {
  const sourceId = `${prefix}-source-${suffix}`
  const runId = `${prefix}-run-${suffix}`
  const jobId = `${prefix}-job-${suffix}`
  const scanItemId = `${prefix}-scan-item-${suffix}`
  const catalogItemId = `${prefix}-catalog-item-${suffix}`
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
      searchIdentityKind: 'UID',
      searchIdentityValue: uploaderUid,
      status: 'COMPLETED',
      itemCount: 1,
      newCount: 1,
      finishedAt: new Date('2026-09-02T00:01:00.000Z')
    }
  })
  await db().archiveUploaderScanItem.create({
    data: {
      id: scanItemId,
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
  await db().archiveUploaderCatalogItem.create({
    data: {
      id: catalogItemId,
      sourceId,
      providerKey: 'e-hentai',
      externalId: sharedExternalId,
      canonicalUrl: `https://e-hentai.org/g/${sharedExternalId}/private-token/`,
      title: 'Shared gallery',
      thumbnailUrl: 'https://ehgt.org/thumb.jpg?secret=1',
      uploaderName: `Uploader ${suffix}`,
      postedAt: new Date('2026-09-01T00:00:00.000Z'),
      relationships: {},
      classification: 'NEW',
      comparisonKnown: true,
      comparisonFingerprint: 'a'.repeat(64),
      firstSeenAt: new Date('2026-09-02T00:01:00.000Z'),
      lastSeenAt: new Date('2026-09-02T00:01:00.000Z'),
      lastScanRunId: runId
    }
  })
  return { sourceId, runId, jobId, scanItemId, catalogItemId }
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
  await prisma.archiveUploaderSource.deleteMany({
    where: { OR: [{ id: { startsWith: prefix } }, { displayName: { startsWith: prefix } }] }
  })
  await prisma.archiveIntakeSubmission.deleteMany({
    where: { OR: [{ id: { startsWith: prefix } }, { requestedByUserId: { startsWith: prefix } }] }
  })
  await prisma.systemJob.deleteMany({
    where: { OR: [{ id: { startsWith: prefix } }, { requestedByUserId: { startsWith: prefix } }] }
  })
  await prisma.artwork.deleteMany({ where: { title: { startsWith: prefix } } })
}

function databaseWithFirstLockHooks(
  hooks: { before?: () => Promise<void>; after?: () => Promise<void> },
  namespace: 'identity' | 'source' = 'identity'
) {
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
                const query = args[0] as Prisma.Sql
                const sourceLock = query.values[0] === 20_260_902
                if (sourceLock !== (namespace === 'source')) {
                  return Reflect.apply(transactionTarget.$queryRaw, transactionTarget, args)
                }
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

function databaseBeforeCommit(hook: () => Promise<void>) {
  return new Proxy(db(), {
    get(target, property, receiver) {
      if (property !== '$transaction') return Reflect.get(target, property, receiver)
      return (operation: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
        target.$transaction(async (transaction) => {
          const result = await operation(transaction)
          await hook()
          return result
        })
    }
  })
}

async function raceSourceOperations(
  first: (database: PrismaClient) => Promise<unknown>,
  second: (database: PrismaClient) => Promise<unknown>
) {
  const locked = deferred()
  const release = deferred()
  const reached = deferred()
  const firstResult = first(
    databaseWithFirstLockHooks(
      {
        after: async () => {
          locked.resolve()
          await release.promise
        }
      },
      'source'
    )
  )
  await locked.promise
  const secondResult = second(databaseWithFirstLockHooks({ before: async () => reached.resolve() }, 'source'))
  await reached.promise
  release.resolve()
  return Promise.allSettled([firstResult, secondResult])
}

function disposition(
  operation: 'add' | 'ignore' | 'scan',
  owned: { sourceId: string; catalogItemId: string },
  database: PrismaClient
) {
  const dependencies = { database, uuid: prefixedUuidFactory('delete-race') }
  if (operation === 'scan') {
    return triggerArchiveUploaderScan({ sourceId: owned.sourceId, mode: 'LATEST' }, prefix, dependencies)
  }
  if (operation === 'ignore') {
    return ignoreArchiveUploaderScanItems(
      { sourceId: owned.sourceId, itemIds: [owned.catalogItemId] },
      prefix,
      dependencies
    )
  }
  return addArchiveUploaderScanItems(
    { sourceId: owned.sourceId, itemIds: [owned.catalogItemId], submissionAttemptId: randomUUID() },
    prefix,
    dependencies
  )
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
