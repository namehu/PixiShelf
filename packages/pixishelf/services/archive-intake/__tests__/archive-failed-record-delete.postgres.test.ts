import { randomUUID } from 'node:crypto'
import { createDatabaseClient, disconnectDatabase, Prisma } from '@pixishelf/db'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { deleteArchiveFailedRecords } from '../archive-failed-record-delete-service'
import { getArchiveIntakeSummary, retryArchiveIntakeMany } from '../archive-intake-service'
import { archiveRequestFingerprint } from '@/services/archive/archive-bulk-operation'
import { retryJobCommand } from '@/services/background-task/job-command-service'
import {
  getArchiveUploaderCatalogCounts,
  listArchiveUploaderCatalogState
} from '@/services/archive-uploader/archive-uploader-catalog-state'

const url = process.env.PIXISHELF_TEST_DATABASE_URL
const db = createDatabaseClient(url ? { datasourceUrl: url } : undefined)
const suite = `failed-delete-${randomUUID()}`
const old = new Date('2026-01-01T00:00:00Z')
let sequence = 0
const uid = () => `${suite}-${++sequence}`
const sourceUrl = (gid: string) => `https://e-hentai.org/g/${gid}/abcdef1234/`

async function fixture() {
  const gid = String(8_000_000 + sequence++)
  const submission = await db.archiveIntakeSubmission.create({
    data: {
      id: uid(),
      idempotencyKey: uid(),
      requestHash: 'a'.repeat(64),
      requestedByUserId: suite,
      rawCount: 2,
      acceptedCount: 2
    }
  })
  const items = []
  for (let i = 0; i < 2; i++) {
    const id = uid()
    const job = await db.systemJob.create({
      data: {
        id: uid(),
        type: 'ARCHIVE_RESOLVE_ITEM',
        executionLane: 'ARCHIVE_RESOLVE',
        status: 'FAILED',
        requestedByUserId: suite,
        payload: { intakeItemId: id }
      }
    })
    items.push(
      await db.archiveIntakeItem.create({
        data: {
          id,
          submissionId: submission.id,
          submittedUrl: i === 0 ? sourceUrl(gid) : sourceUrl(gid).replace('abcdef1234', 'ffff123456'),
          normalizedUrlHash: 'b'.repeat(64),
          status: 'FAILED',
          retryable: false,
          errorCode: 'REMOTE_NOT_FOUND',
          currentSystemJobId: job.id,
          finishedAt: old,
          updatedAt: old
        }
      })
    )
  }
  const sources = []
  const catalogs = []
  for (let i = 0; i < 2; i++) {
    const source = await db.archiveUploaderSource.create({
      data: {
        id: uid(),
        providerKey: 'e-hentai',
        identityKind: 'UID',
        identityValue: uid(),
        normalizedIdentity: uid(),
        displayName: suite,
        latestSeenExternalId: gid,
        historyCursor: 'keep-cursor'
      }
    })
    sources.push(source)
    const job = await db.systemJob.create({
      data: {
        id: uid(),
        type: 'ARCHIVE_UPLOADER_SCAN',
        executionLane: 'ARCHIVE_RESOLVE',
        status: 'COMPLETED',
        requestedByUserId: suite
      }
    })
    const run = await db.archiveUploaderScanRun.create({
      data: {
        id: uid(),
        sourceId: source.id,
        systemJobId: job.id,
        mode: 'LATEST',
        searchIdentityKind: 'UID',
        searchIdentityValue: '123',
        status: 'COMPLETED',
        itemCount: 1
      }
    })
    await db.archiveUploaderScanItem.create({
      data: {
        id: uid(),
        runId: run.id,
        providerKey: 'e-hentai',
        externalId: gid,
        canonicalUrl: sourceUrl(gid),
        title: suite,
        metadataFingerprint: 'c'.repeat(64),
        relationships: [],
        classification: 'NEW'
      }
    })
    catalogs.push(
      await db.archiveUploaderCatalogItem.create({
        data: {
          id: uid(),
          sourceId: source.id,
          providerKey: 'e-hentai',
          externalId: gid,
          canonicalUrl: sourceUrl(gid),
          title: suite,
          relationships: [],
          classification: 'NEW',
          firstSeenAt: old,
          lastSeenAt: old,
          updatedAt: old,
          lastIntakeItemId: items[0]!.id,
          lastOutcome: 'FAILED',
          lastOutcomeAt: old,
          lastErrorCode: 'REMOTE_NOT_FOUND'
        }
      })
    )
  }
  return { gid, submission, items, sources, catalogs }
}
async function importFixture(gid: string, status: 'COMPLETED' | 'FAILED' | 'RUNNING') {
  const artwork = await db.artwork.create({ data: { title: suite } })
  const job = await db.systemJob.create({
    data: {
      id: uid(),
      type: 'ARCHIVE_IMPORT',
      status: status === 'RUNNING' ? 'RUNNING' : status,
      requestedByUserId: suite
    }
  })
  const archive = await db.archiveImport.create({
    data: {
      id: uid(),
      systemJobId: job.id,
      providerKey: 'e-hentai',
      externalId: gid,
      submittedUrl: sourceUrl(gid),
      canonicalUrl: sourceUrl(gid),
      locator: {},
      normalizedMetadata: {},
      rawMetadata: {},
      metadataHash: 'd'.repeat(64),
      creatorBucket: suite,
      stagingPath: uid(),
      status,
      publishedArtworkId: artwork.id
    }
  })
  return { artwork, job, archive }
}
const remove = (
  itemIds: string[],
  targetType: 'INTAKE_ITEM' | 'DISCOVERY_ITEM' = 'INTAKE_ITEM',
  idempotencyKey = uid()
) => deleteArchiveFailedRecords({ itemIds, targetType, idempotencyKey }, suite, { database: db })

describe.skipIf(!url)('delete failed archive records PostgreSQL', () => {
  afterEach(async () => {
    await db.archiveUploaderSource.deleteMany({ where: { id: { startsWith: suite } } })
    await db.archiveIntakeSubmission.deleteMany({ where: { requestedByUserId: suite } })
    await db.archiveBulkOperation.deleteMany({ where: { requestedByUserId: suite } })
    await db.systemJob.deleteMany({ where: { requestedByUserId: suite } })
    await db.artwork.deleteMany({ where: { title: suite } })
  })
  afterAll(() => disconnectDatabase(db))

  it('deletes unresolved duplicates across sources, clears counts and preserves local imports, jobs, batches and cursors', async () => {
    const f = await fixture()
    expect(
      (await listArchiveUploaderCatalogState(db, { sourceId: f.sources[0]!.id, view: 'ATTENTION', limit: 10 })).items[0]
        ?.deletableFailure
    ).toBe(true)
    const local = await importFixture(f.gid, 'COMPLETED')
    const result = await remove([f.items[0]!.id])
    expect(result?.counts.applied).toBe(1)
    expect(await db.archiveIntakeItem.count({ where: { submissionId: f.submission.id } })).toBe(0)
    expect(await db.archiveUploaderCatalogItem.count({ where: { externalId: f.gid } })).toBe(0)
    expect(await db.archiveUploaderScanItem.count({ where: { externalId: f.gid } })).toBe(0)
    expect(await db.archiveIntakeSubmission.findUnique({ where: { id: f.submission.id } })).not.toBeNull()
    expect(await db.archiveImport.findUnique({ where: { id: local.archive.id } })).toEqual(local.archive)
    expect(await db.artwork.findUnique({ where: { id: local.artwork.id } })).toEqual(local.artwork)
    expect(await db.systemJob.findUnique({ where: { id: f.items[0]!.currentSystemJobId! } })).not.toBeNull()
    expect(await db.archiveUploaderSource.findUnique({ where: { id: f.sources[0]!.id } })).toEqual(f.sources[0])
    expect((await getArchiveIntakeSummary({ database: db })).counts.FAILED ?? 0).toBe(0)
    expect((await getArchiveUploaderCatalogCounts(db, [f.sources[0]!.id])).get(f.sources[0]!.id)?.attention ?? 0).toBe(
      0
    )
    await expect(retryJobCommand({ jobId: f.items[0]!.currentSystemJobId! }, db)).rejects.toThrow('收件记录已删除')
    expect(await db.systemJob.count({ where: { parentJobId: f.items[0]!.currentSystemJobId! } })).toBe(0)
  })

  it('handles legacy catalog failures after intake retention and permits later rediscovery', async () => {
    const f = await fixture()
    await db.archiveIntakeItem.deleteMany({ where: { submissionId: f.submission.id } })
    const result = await remove([f.catalogs[0]!.id], 'DISCOVERY_ITEM')
    expect(result?.counts.applied).toBe(1)
    const data = f.catalogs[0]!
    const rediscovered = await db.archiveUploaderCatalogItem.create({
      data: {
        id: uid(),
        sourceId: data.sourceId,
        providerKey: data.providerKey,
        externalId: data.externalId,
        canonicalUrl: data.canonicalUrl,
        title: data.title,
        relationships: [],
        classification: 'NEW',
        firstSeenAt: old,
        lastSeenAt: old
      }
    })
    expect(rediscovered.lastOutcome).toBeNull()
    expect((await getArchiveUploaderCatalogCounts(db, [f.sources[0]!.id])).get(f.sources[0]!.id)?.actionable ?? 0).toBe(
      1
    )
  })

  it('does not touch a new failed submission on replay of a completed request', async () => {
    const f = await fixture()
    const key = uid()
    const first = await remove([f.items[0]!.id], 'INTAKE_ITEM', key)
    const next = await db.archiveIntakeItem.create({
      data: {
        submissionId: f.submission.id,
        submittedUrl: sourceUrl(f.gid),
        normalizedUrlHash: 'b'.repeat(64),
        status: 'FAILED'
      }
    })
    const replay = await remove([f.items[0]!.id], 'INTAKE_ITEM', key)
    expect(replay?.id).toBe(first?.id)
    expect(await db.archiveIntakeItem.findUnique({ where: { id: next.id } })).not.toBeNull()
  })

  it.each(['RUNNING', 'FAILED'] as const)('rejects a %s download without changing records', async (status) => {
    const f = await fixture()
    await importFixture(f.gid, status)
    const listed = await listArchiveUploaderCatalogState(db, { sourceId: f.sources[0]!.id, view: 'ALL', limit: 10 })
    expect(listed.items[0]?.deletableFailure).toBe(false)
    expect((await remove([f.items[0]!.id]))?.counts.conflict).toBe(1)
    expect(await db.archiveIntakeItem.count({ where: { submissionId: f.submission.id } })).toBe(2)
    expect(await db.archiveUploaderCatalogItem.count({ where: { externalId: f.gid } })).toBe(2)
  })

  it('reports a batch conflict independently from successful deletion', async () => {
    const blocked = await fixture()
    const good = await fixture()
    await retryArchiveIntakeMany({ idempotencyKey: uid(), itemIds: [blocked.items[1]!.id] }, suite, { database: db })
    const result = await remove([blocked.items[0]!.id, good.items[0]!.id])
    expect(result?.counts).toMatchObject({ conflict: 1, applied: 1 })
    const discoveryResult = await remove([blocked.catalogs[0]!.id], 'DISCOVERY_ITEM')
    expect(discoveryResult?.items[0]).toMatchObject({
      result: 'CONFLICT',
      message: '同作品仍有活动收件任务，请等待结束后再删除'
    })
    expect(await db.archiveIntakeItem.findUnique({ where: { id: blocked.items[0]!.id } })).not.toBeNull()
    expect(await db.archiveIntakeItem.findUnique({ where: { id: good.items[0]!.id } })).toBeNull()
  })

  it('rejects paused scans including runs with a terminal domain but active job', async () => {
    const f = await fixture()
    const run = await db.archiveUploaderScanRun.findFirstOrThrow({ where: { sourceId: f.sources[0]!.id } })
    await db.systemJob.update({ where: { id: run.systemJobId }, data: { status: 'PAUSED' } })
    expect((await remove([f.catalogs[0]!.id], 'DISCOVERY_ITEM'))?.counts.conflict).toBe(1)
    expect(await db.archiveUploaderScanItem.count({ where: { externalId: f.gid } })).toBe(2)
  })

  it('does not delete a newer failure when resuming an interrupted request', async () => {
    const f = await fixture()
    const key = uid()
    const ids = [f.items[0]!.id]
    await db.archiveBulkOperation.create({
      data: {
        idempotencyKey: key,
        requestedByUserId: suite,
        commandType: 'DELETE_FAILED_RECORDS',
        requestedCount: 1,
        createdAt: old,
        requestHash: archiveRequestFingerprint({
          commandType: 'DELETE_FAILED_RECORDS',
          targetType: 'INTAKE_ITEM',
          targetIds: ids,
          requestOptions: null
        })
      }
    })
    await db.archiveIntakeItem.update({ where: { id: ids[0] }, data: { errorCode: 'REMOTE_NOT_FOUND' } })
    expect((await remove(ids, 'INTAKE_ITEM', key))?.counts.conflict).toBe(1)
    expect(await db.archiveIntakeItem.count({ where: { submissionId: f.submission.id } })).toBe(2)
  })

  it('serializes concurrent deletion and retry without deleting an active retry', async () => {
    const f = await fixture()
    const [deleted, retried] = await Promise.all([
      remove([f.items[0]!.id]),
      retryArchiveIntakeMany({ idempotencyKey: uid(), itemIds: [f.items[0]!.id] }, suite, { database: db })
    ])
    if (retried?.counts.applied === 1) {
      expect(deleted?.counts.conflict).toBe(1)
      expect(await db.archiveIntakeItem.findUnique({ where: { id: f.items[0]!.id } })).toMatchObject({
        status: 'QUEUED'
      })
    } else {
      expect(deleted?.counts.applied).toBe(1)
      expect(retried?.counts.skipped).toBe(1)
    }
  })

  it('waits for the source lock and observes a concurrently started scan', async () => {
    const f = await fixture()
    const sourceId = f.sources[0]!.id
    const run = await db.archiveUploaderScanRun.findFirstOrThrow({ where: { sourceId } })
    let acquired!: () => void
    let release!: () => void
    let attempted!: () => void
    const acquiredPromise = new Promise<void>((resolve) => {
      acquired = resolve
    })
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve
    })
    const attemptedPromise = new Promise<void>((resolve) => {
      attempted = resolve
    })
    const writer = db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(20260902::integer, hashtext(${sourceId}::text))::text`)
      acquired()
      await releasePromise
      await tx.systemJob.update({ where: { id: run.systemJobId }, data: { status: 'PENDING' } })
      await tx.archiveUploaderScanRun.update({ where: { id: run.id }, data: { status: 'PENDING' } })
    })
    await acquiredPromise
    const database = new Proxy(db, {
      get(target, key) {
        if (key !== '$transaction') return Reflect.get(target, key)
        return (callback: (tx: Prisma.TransactionClient) => unknown) =>
          target.$transaction(async (tx) =>
            callback(
              new Proxy(tx, {
                get(transaction, property) {
                  if (property !== '$queryRaw') return Reflect.get(transaction, property)
                  return (...args: unknown[]) => {
                    const sql = args[0] as { values?: unknown[] }
                    if (Array.isArray(sql.values) && sql.values.includes(sourceId)) attempted()
                    return Reflect.apply(transaction.$queryRaw, transaction, args)
                  }
                }
              })
            )
          )
      }
    })
    const deletion = deleteArchiveFailedRecords(
      { itemIds: [f.items[0]!.id], targetType: 'INTAKE_ITEM', idempotencyKey: uid() },
      suite,
      { database }
    )
    try {
      await attemptedPromise
    } finally {
      release()
    }
    await writer
    expect((await deletion)?.counts.conflict).toBe(1)
    expect(await db.archiveUploaderCatalogItem.count({ where: { externalId: f.gid } })).toBe(2)
  })

  it('rolls back catalog removal when a later delete fails', async () => {
    const f = await fixture()
    const database = new Proxy(db, {
      get(target, key) {
        if (key !== '$transaction') return Reflect.get(target, key)
        return (callback: (tx: Prisma.TransactionClient) => unknown) =>
          target.$transaction(async (tx) =>
            callback(
              new Proxy(tx, {
                get(transaction, property) {
                  if (property === 'archiveUploaderScanItem') {
                    return new Proxy(transaction.archiveUploaderScanItem, {
                      get(delegate, method) {
                        if (method === 'deleteMany') {
                          return () => {
                            throw new Error('injected deletion failure')
                          }
                        }
                        return Reflect.get(delegate, method)
                      }
                    })
                  }
                  return Reflect.get(transaction, property)
                }
              })
            )
          )
      }
    })
    const result = await deleteArchiveFailedRecords(
      { itemIds: [f.items[0]!.id], targetType: 'INTAKE_ITEM', idempotencyKey: uid() },
      suite,
      { database }
    )
    expect(result?.counts.failed).toBe(1)
    expect(await db.archiveUploaderCatalogItem.count({ where: { externalId: f.gid } })).toBe(2)
    expect(await db.archiveIntakeItem.count({ where: { submissionId: f.submission.id } })).toBe(2)
  })
})
