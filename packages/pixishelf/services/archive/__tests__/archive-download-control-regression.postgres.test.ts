import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import { captureArtworkDedupSources, PrismaClient, disconnectDatabase } from '@pixishelf/db'
import { archiveImportV2PayloadSchema, serializeArtworkDedupSourceSnapshot } from '@pixishelf/job-contracts'
import {
  ArchiveExecutorError,
  createArchiveExecutorRegistrations,
  type ArchiveMediaProvider
} from '@pixishelf/job-executors'
import {
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type QueueDatabase
} from '@pixishelf/job-runtime'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ARCHIVE_PUBLISH_ADVISORY_LOCK_ID } from '../archive-coordination'
import { controlArchiveDownloads } from '../archive-download-control'
import { listArchiveTasks } from '../archive-task-service'

const url = process.env.PIXISHELF_TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const prefix = `download-regression-${randomUUID()}`
const user = `${prefix}-user`
const db = new PrismaClient({ ...(url ? { datasourceUrl: url } : {}), log: [{ emit: 'event', level: 'query' }] })
let measuring = false
let statements: string[] = []
db.$on('query', (event) => {
  if (measuring) statements.push(event.query)
})

async function seedDownload(suffix: string, status: 'FAILED' | 'PAUSED') {
  const task = { jobId: `${prefix}-${suffix}-job`, importId: `${prefix}-${suffix}-import` }
  await db.systemJob.create({ data: {
    id: task.jobId, type: 'ARCHIVE_DOWNLOAD', executionLane: 'ARCHIVE_DOWNLOAD', status,
    triggerSource: 'MANUAL', queuePriority: 10, effectivePriority: 10, requestedByUserId: user,
    payload: { archiveImportId: task.importId, defaultTagIds: [] }
  } })
  await db.archiveImport.create({ data: {
    id: task.importId, systemJobId: task.jobId, phase: 'DOWNLOAD', providerKey: 'regression', externalId: suffix,
    submittedUrl: 'https://fixture.invalid', canonicalUrl: 'https://fixture.invalid', locator: {}, status,
    normalizedMetadata: {}, rawMetadata: {}, metadataHash: 'fixture', creatorBucket: 'fixture', stagingPath: task.importId,
    totalItems: 1, failedItems: 1,
    items: { create: { pageIndex: 1, sourcePageUrl: 'https://fixture.invalid/item', locator: {}, expectedFilename: '1', status: 'FAILED', attempts: 3 } }
  } })
  await db.archiveImportExecution.create({ data: { jobId: task.jobId, archiveImportId: task.importId, phase: 'DOWNLOAD' } })
  return task
}

suite('download control independent PostgreSQL regression', () => {
  beforeAll(async () => db.$connect())
  afterEach(async () => {
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS download_regression_fault ON system_job_events')
    await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS download_regression_fault()')
    await db.archiveBulkOperation.deleteMany({ where: { requestedByUserId: user } })
    const jobs = await db.systemJob.findMany({ where: { requestedByUserId: user }, select: { id: true } })
    await db.archiveImport.deleteMany({ where: { systemJobId: { in: jobs.map(({ id }) => id) } } })
    await db.systemJob.deleteMany({ where: { id: { in: jobs.map(({ id }) => id) } } })
    await db.artworkDedupSourceIdentity.deleteMany({ where: { providerKey: 'e-hentai', externalId: { startsWith: prefix } } })
  })
  afterAll(async () => disconnectDatabase(db))

  it.each(['RETRY', 'RESUME'] as const)('%s completes while creator and publication advisory locks are held', async (action) => {
    const task = await seedDownload(`locked-${action}`, action === 'RETRY' ? 'FAILED' : 'PAUSED')
    let release!: () => void
    let ready!: () => void
    const held = new Promise<void>((resolve) => { ready = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(7341902118)::text')
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
      ready()
      await gate
    }, { timeout: 15000 })
    await held
    try {
      const result = await controlArchiveDownloads({ idempotencyKey: randomUUID(), taskIds: [task.importId], action, requestedByUserId: user }, { database: db })
      expect(result?.items[0]?.result).toBe('APPLIED')
    } finally {
      release()
      await holder
    }
  }, 10000)

  it('rolls back all jobs and the operation on a late write failure, allowing the same key to retry', async () => {
    const tasks = await Promise.all([seedDownload('rollback-a', 'FAILED'), seedDownload('rollback-b', 'FAILED')])
    const key = randomUUID()
    const input = { idempotencyKey: key, taskIds: tasks.map((task) => task.importId), action: 'RETRY' as const, requestedByUserId: user }
    await db.$executeRawUnsafe("CREATE FUNCTION download_regression_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected late failure'; END $$")
    await db.$executeRawUnsafe('CREATE TRIGGER download_regression_fault BEFORE INSERT ON system_job_events FOR EACH ROW EXECUTE FUNCTION download_regression_fault()')
    await expect(controlArchiveDownloads(input, { database: db })).rejects.toThrow()
    expect(await db.archiveBulkOperation.count({ where: { idempotencyKey: key } })).toBe(0)
    expect(await db.systemJob.count({ where: { parentJobId: { in: tasks.map((task) => task.jobId) } } })).toBe(0)
    expect(await db.archiveImport.count({ where: { id: { in: input.taskIds }, status: 'FAILED' } })).toBe(2)
    await db.$executeRawUnsafe('DROP TRIGGER download_regression_fault ON system_job_events')
    const result = await controlArchiveDownloads(input, { database: db })
    expect(result?.counts.applied).toBe(2)
    expect((await controlArchiveDownloads(input, { database: db }))?.id).toBe(result?.id)
  })

  it('serializes concurrent retries of the same target into a single child', async () => {
    const task = await seedDownload('race', 'FAILED')
    const run = () => controlArchiveDownloads({ idempotencyKey: randomUUID(), taskIds: [task.importId], action: 'RETRY', requestedByUserId: user }, { database: db })
    const results = await Promise.all([run(), run()])
    expect(results.reduce((count, result) => count + (result?.counts.applied ?? 0), 0)).toBe(1)
    expect(await db.systemJob.count({ where: { parentJobId: task.jobId } })).toBe(1)
  })

  it('uses a fixed number of database operations for 1, 10 and 100 targets', async () => {
    const counts: number[] = []
    for (const size of [1, 10, 100]) {
      const tasks = []
      for (let index = 0; index < size; index++) tasks.push(await seedDownload(`size-${size}-${index}`, 'FAILED'))
      statements = []
      measuring = true
      let result
      try {
        result = await controlArchiveDownloads({ idempotencyKey: randomUUID(), taskIds: tasks.map((task) => task.importId), action: 'RETRY', requestedByUserId: user }, { database: db })
      } finally {
        measuring = false
      }
      expect(result?.counts.applied).toBe(size)
      expect(statements.some((query) => /archive_import_items/i.test(query))).toBe(false)
      counts.push(statements.length)
    }
    expect(counts[1]).toBe(counts[0])
    expect(counts[2]).toBe(counts[0])
    expect(counts[0]).toBeGreaterThan(0)
  }, 30000)

  it('claims a DOWNLOAD while creator and publication locks are held', async () => {
    const task = await seedDownload('claim', 'PAUSED')
    await controlArchiveDownloads({ idempotencyKey: randomUUID(), taskIds: [task.importId], action: 'RESUME', requestedByUserId: user }, { database: db })
    let release!: () => void
    let ready!: () => void
    const held = new Promise<void>((resolve) => { ready = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(7341902118)::text')
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
      ready()
      await gate
    }, { timeout: 15000 })
    await held
    try {
      const queue = new PostgresQueueRepository(db as unknown as QueueDatabase)
      const claim = await queue.claim(`${prefix}-worker`, [{ jobType: 'ARCHIVE_DOWNLOAD', executionLane: 'ARCHIVE_DOWNLOAD', definitionVersions: [1] }])
      expect(claim?.id).toBe(task.jobId)
    } finally {
      release()
      await holder
    }
  }, 10000)

  it('continues an unbound paused original as display and reuses its completed original page', async () => {
    const externalId = `${prefix}-switch`
    const task = await seedDownload(externalId, 'PAUSED')
    const dedupSourceSnapshot = await db.$transaction(async (tx) =>
      serializeArtworkDedupSourceSnapshot(
        await captureArtworkDedupSources(tx, { identities: [{ kind: 'PROVIDER', providerKey: 'e-hentai', externalId }] })
      )
    )
    await db.archiveImport.update({
      where: { id: task.importId },
      data: {
        providerKey: 'e-hentai',
        requestedQuality: 'ORIGINAL',
        selectedQuality: 'ORIGINAL',
        dedupSourceSnapshot,
        totalItems: 2,
        items: { create: { pageIndex: 0, sourcePageUrl: 'https://fixture.invalid/0', locator: {}, expectedFilename: '0' } }
      }
    })
    const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-switch-quality-'))
    try {
      const png = await sharp({ create: { width: 2, height: 3, channels: 3, background: 'blue' } }).png().toBuffer()
      const expectedSha1 = createHash('sha1').update(png).digest('hex')
      const descriptor = `${expectedSha1}-${png.length}-2-3-png`
      const requests: Array<{ index: number; quality: string }> = []
      const openMedia: ArchiveMediaProvider['openMedia'] = async (item, context) => {
        requests.push({ index: item.index, quality: context.quality })
        if (item.index === 1 && context.quality === 'ORIGINAL') {
          throw new ArchiveExecutorError('ORIGINAL_UNAVAILABLE', 'Fixture login required', { pause: true })
        }
        const variant = context.quality === 'ORIGINAL' ? `${descriptor}/x` : `${'a'.repeat(40)}-200-4-6-png/${descriptor}`
        return {
          downloadUrl: `https://fixture.hath.network/om/1/${variant}/0/name.png`,
          expectedSha1,
          stream: Readable.from([png]),
          mimeType: 'image/png',
          contentLength: png.length,
          originalFilename: 'name.png',
          quality: context.quality,
          ehDelivery: { requestedQuality: context.quality, originalResponse: false },
          remoteHost: 'fixture.hath.network'
        }
      }
      const executor = createArchiveExecutorRegistrations({
        database: db,
        config: { scanRoot: root, mediaConcurrency: 1 },
        providers: { get: () => ({ key: 'e-hentai', openMedia }) }
      }).find((entry) => entry.jobType === 'ARCHIVE_DOWNLOAD' && entry.definitionVersion === 1)!
      const queue = new PostgresQueueRepository(db as unknown as QueueDatabase)
      const run = async () => {
        const job = (await queue.claim(`${prefix}-worker`, [
          { jobType: 'ARCHIVE_DOWNLOAD', executionLane: 'ARCHIVE_DOWNLOAD', definitionVersions: [1] }
        ]))!
        expect(job?.id).toBe(task.jobId)
        const fence = { jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt }
        await executor.execute({
          job,
          payload: archiveImportV2PayloadSchema.parse(job.payload),
          signal: new AbortController().signal,
          progress: (update) => queue.updateProgress({ ...fence, ...update }),
          enqueueChild: async () => { throw new Error('Unexpected out-of-transaction enqueue') },
          mutateInTransaction: (operation) => queue.withFencedMutationTransaction(fence, operation),
          checkpointInTransaction: async (operation) => (await queue.withFencedProgressTransaction(fence, operation)).result,
          finalizeInTransaction: async (operation) => {
            await queue.withFencedExecutionTransaction(fence, operation)
            return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
          },
          logger: { debug() {}, info() {}, warn() {}, error() {} }
        })
      }
      const resume = (useDisplayQuality: boolean) =>
        controlArchiveDownloads({
          idempotencyKey: randomUUID(), taskIds: [task.importId], action: 'RESUME', requestedByUserId: user, useDisplayQuality
        }, { database: db })

      expect((await resume(false))?.counts.applied).toBe(1)
      await run()
      const readTask = () => db.archiveImport.findUniqueOrThrow({
        where: { id: task.importId },
        include: { items: { orderBy: { pageIndex: 'asc' } } }
      })
      const paused = await readTask()
      expect(paused).toMatchObject({ status: 'PAUSED', selectedQuality: 'ORIGINAL', decisionCode: null })
      expect(paused.items[0]).toMatchObject({ status: 'COMPLETED', quality: 'ORIGINAL' })
      expect((await listArchiveTasks({ taskId: task.importId }, { database: db })).items[0]).toMatchObject({
        kind: null,
        canUseDisplayQuality: true
      })
      expect((await resume(true))?.counts.applied).toBe(1)
      const queued = await readTask()
      expect(queued).toMatchObject({ status: 'PENDING', requestedQuality: 'ORIGINAL', selectedQuality: 'DISPLAY' })
      expect(queued.items[0]).toEqual(paused.items[0])
      await run()
      expect(requests).toEqual([
        { index: 0, quality: 'ORIGINAL' },
        { index: 1, quality: 'ORIGINAL' },
        { index: 1, quality: 'DISPLAY' }
      ])
      const sealed = await readTask()
      expect(sealed.phase).toBe('PUBLISH')
      expect(sealed.items.map(({ quality }) => quality)).toEqual(['ORIGINAL', 'DISPLAY'])
      expect(sealed.items[0]?.sha256).toBe(paused.items[0]?.sha256)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    { completionBaseRevisionId: 'base', completionSnapshot: {} },
    { upgradeBaseRevisionId: 'base', upgradeSnapshot: {} },
    { sealedManifestSha256: 'a'.repeat(64) },
    { phase: 'PUBLISH' as const }
  ])('refuses a quality switch for protected downloads: %j', async (restriction) => {
    const task = await seedDownload('switch-blocked', 'PAUSED')
    await db.archiveImport.update({
      where: { id: task.importId },
      data: { selectedQuality: 'ORIGINAL', ...restriction }
    })
    const result = await controlArchiveDownloads({
      idempotencyKey: randomUUID(), taskIds: [task.importId], action: 'RESUME', requestedByUserId: user,
      useDisplayQuality: true
    }, { database: db })
    expect(result?.counts.applied).toBe(0)
    expect(await db.archiveImport.findUniqueOrThrow({ where: { id: task.importId } })).toMatchObject({
      status: 'PAUSED', selectedQuality: 'ORIGINAL'
    })
  })

  it('rejects an entire mixed multi-row insert when a non-download job references a merged artist', async () => {
    const ids = [`${prefix}-guard-download`, `${prefix}-guard-other`]
    await expect(db.$transaction(async (tx) => {
      const source = await tx.artist.create({ data: { name: `${prefix}-source` } })
      const target = await tx.artist.create({ data: { name: `${prefix}-target` } })
      await tx.artist.update({ where: { id: source.id }, data: { mergedIntoId: target.id, mergedAt: new Date() } })
      await tx.systemJob.createMany({ data: [
        { id: ids[0]!, type: 'ARCHIVE_DOWNLOAD', executionLane: 'ARCHIVE_DOWNLOAD', requestedByUserId: user, payload: { artistId: source.id } },
        { id: ids[1]!, type: 'SCAN', executionLane: 'BACKGROUND_WRITER', requestedByUserId: user, payload: { artistId: source.id } }
      ] })
    })).rejects.toThrow()
    expect(await db.systemJob.count({ where: { id: { in: ids } } })).toBe(0)
  })
})
