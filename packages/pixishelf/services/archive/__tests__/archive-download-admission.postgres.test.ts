import { randomUUID } from 'node:crypto'
import { PrismaClient, disconnectDatabase, type Prisma } from '@pixishelf/db'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { controlArchiveDownloads } from '../archive-download-control'
import { requestArchiveStagingCleanup } from '../archive-maintenance-service'

const url = process.env.PIXISHELF_TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const prefix = `dl-admit-${randomUUID()}`
const user = `${prefix}-admin`
const db = new PrismaClient(url ? { datasourceUrl: url } : undefined)

async function seed(
  suffix: string,
  options: {
    phase?: 'DOWNLOAD' | 'PUBLISH' | 'LEGACY'
    status?: 'FAILED' | 'PAUSED' | 'COMPLETED'
    identity?: string
    cleanup?: boolean
  } = {}
) {
  const phase = options.phase ?? 'DOWNLOAD'
  const status = options.status ?? 'FAILED'
  const id = `${prefix}-${suffix}`
  const jobId = `${id}-job`
  await db.systemJob.create({
    data: {
      id: jobId,
      type: phase === 'DOWNLOAD' ? 'ARCHIVE_DOWNLOAD' : phase === 'PUBLISH' ? 'ARCHIVE_PUBLISH' : 'ARCHIVE_IMPORT',
      executionLane: phase === 'DOWNLOAD' ? 'ARCHIVE_DOWNLOAD' : 'BACKGROUND_WRITER',
      status,
      requestedByUserId: user,
      payload: { archiveImportId: id, defaultTagIds: [2, 5] }
    }
  })
  await db.archiveImport.create({
    data: {
      id,
      systemJobId: jobId,
      phase,
      status,
      providerKey: prefix,
      externalId: options.identity ?? suffix,
      submittedUrl: 'https://fixture.invalid/gallery',
      canonicalUrl: 'https://fixture.invalid/gallery',
      locator: {},
      normalizedMetadata: {},
      rawMetadata: {},
      metadataHash: 'fixture',
      creatorBucket: 'fixture',
      stagingPath: id,
      ...(options.cleanup ? { cleanupRequestedAt: new Date() } : {})
    }
  })
  return { id, jobId }
}

function retry(taskIds: string[]) {
  return controlArchiveDownloads(
    {
      idempotencyKey: randomUUID(),
      requestedByUserId: user,
      taskIds,
      action: 'RETRY'
    },
    { database: db }
  )
}

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

suite('download admission PostgreSQL contracts', () => {
  beforeAll(async () => db.$connect())
  afterEach(async () => {
    await db.archiveBulkOperation.deleteMany({ where: { requestedByUserId: user } })
    const jobs = await db.systemJob.findMany({ where: { requestedByUserId: user }, select: { id: true } })
    await db.archiveImport.deleteMany({ where: { systemJobId: { in: jobs.map(({ id }) => id) } } })
    await db.systemJob.deleteMany({ where: { requestedByUserId: user } })
  })
  afterAll(async () => disconnectDatabase(db))

  it('records the completion time after queue submission while preserving the original available time', async () => {
    const task = await seed('completion-time')
    const queuedAt = new Date(Date.now() - 60_000)
    const completedAt = new Date(Date.now() + 60_000)
    let clockReads = 0
    const operation = await controlArchiveDownloads(
      {
        idempotencyKey: randomUUID(),
        requestedByUserId: user,
        taskIds: [task.id],
        action: 'RETRY'
      },
      { database: db, now: () => (clockReads++ === 0 ? queuedAt : completedAt) }
    )
    expect(clockReads).toBe(2)
    expect(operation!.completedAt).toEqual(completedAt)
    expect(operation!.completedAt!.getTime()).toBeGreaterThanOrEqual(operation!.createdAt.getTime())
    const retryJob = await db.systemJob.findUniqueOrThrow({ where: { id: operation!.items[0]!.relatedId! } })
    expect(retryJob.availableAt).toEqual(queuedAt)
  })

  it('excludes business-invalid targets without rolling back the eligible download or using legacy recovery', async () => {
    const good = await seed('eligible')
    const cleanup = await seed('cleanup', { cleanup: true })
    const completed = await seed('completed', { status: 'COMPLETED' })
    const publish = await seed('publish', { phase: 'PUBLISH' })
    const legacy = await seed('legacy', { phase: 'LEGACY' })
    const operation = await retry([good.id, cleanup.id, completed.id, publish.id, legacy.id, 'missing'])
    const results = new Map(operation!.items.map((item) => [item.targetId, item]))
    expect(operation!.counts).toMatchObject({ applied: 1, skipped: 2, conflict: 3, failed: 0 })
    expect(results.get(good.id)?.result).toBe('APPLIED')
    expect(results.get(cleanup.id)?.code).toBe('CLEANUP_IN_PROGRESS')
    expect(results.get(completed.id)?.code).toBe('INVALID_STATE')
    expect(results.get(publish.id)?.code).toBe('PHASE_CONFLICT')
    expect(results.get(legacy.id)?.code).toBe('PHASE_CONFLICT')
    expect(
      await db.systemJob.count({
        where: { parentJobId: { in: [cleanup.jobId, completed.jobId, publish.jobId, legacy.jobId] } }
      })
    ).toBe(0)
  })

  it('gives existing active sources precedence and chooses the same batch winner by task ID', async () => {
    const active = await seed('active', { identity: 'busy-source', status: 'PAUSED' })
    const blocked = await seed('blocked', { identity: 'busy-source' })
    const later = await seed('z-later', { identity: 'shared-failed-source' })
    const earlier = await seed('a-earlier', { identity: 'shared-failed-source' })
    const operation = await retry([later.id, blocked.id, earlier.id])
    expect(operation!.counts).toMatchObject({ applied: 1, conflict: 2 })
    expect(operation!.items.find((item) => item.targetId === earlier.id)?.result).toBe('APPLIED')
    expect(operation!.items.find((item) => item.targetId === later.id)?.code).toBe('ACTIVE_SOURCE_CONFLICT')
    expect(operation!.items.find((item) => item.targetId === blocked.id)?.code).toBe('ACTIVE_SOURCE_CONFLICT')
    expect((await db.archiveImport.findUniqueOrThrow({ where: { id: active.id } })).systemJobId).toBe(active.jobId)
    expect(await db.systemJob.count({ where: { parentJobId: { in: [later.jobId, blocked.jobId] } } })).toBe(0)
  })

  it('creates no retry job when concurrent cleanup wins the import CAS after admission reads', async () => {
    const task = await seed('cas-loser')
    const locked = gate(),
      release = gate()
    const cleanup = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM archive_imports WHERE id = ${task.id} FOR UPDATE`
        locked.resolve()
        await release.promise
        await tx.archiveImport.update({ where: { id: task.id }, data: { cleanupRequestedAt: new Date() } })
      },
      { timeout: 15000 }
    )
    await locked.promise
    const pending = retry([task.id])
    try {
      const deadline = Date.now() + 4000
      let blocked = false
      while (Date.now() < deadline) {
        const rows = await db.$queryRaw<{ blocked: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
            AND wait_event_type = 'Lock' AND query LIKE '%UPDATE archive_imports AS target%') AS blocked`
        if (rows[0]?.blocked) {
          blocked = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(blocked).toBe(true)
    } finally {
      release.resolve()
      await cleanup
    }
    const result = await pending
    expect(result!.items[0]).toMatchObject({ result: 'CONFLICT', code: 'STATE_CONFLICT' })
    expect(await db.systemJob.count({ where: { parentJobId: task.jobId } })).toBe(0)
    expect(await db.archiveImportExecution.count({ where: { archiveImportId: task.id } })).toBe(0)
    expect((await db.archiveImport.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('FAILED')
  })

  it('rejects a cleanup snapshot after a retry changes its old job binding', async () => {
    const task = await seed('cleanup-snapshot')
    const observed = gate(),
      continueCleanup = gate()
    const database = {
      $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        db.$transaction(
          async (tx) =>
            callback(
              new Proxy(tx, {
                get(target, property, receiver) {
                  if (property !== 'archiveImport') return Reflect.get(target, property, receiver)
                  return new Proxy(target.archiveImport, {
                    get(imports, method, importReceiver) {
                      if (method !== 'updateMany') return Reflect.get(imports, method, importReceiver)
                      return async (args: Prisma.ArchiveImportUpdateManyArgs) => {
                        observed.resolve()
                        await continueCleanup.promise
                        return imports.updateMany(args)
                      }
                    }
                  })
                }
              })
            ),
          { timeout: 15000 }
        )
    }
    const cleanup = requestArchiveStagingCleanup(
      { archiveImportId: task.id, requestedByUserId: user },
      { database: database as never, now: () => new Date() }
    )
    // Attach the rejection handler before releasing the competing transaction.
    const outcome = cleanup.then(
      () => null,
      (error: unknown) => error
    )
    await observed.promise
    try {
      expect((await retry([task.id]))!.counts.applied).toBe(1)
    } finally {
      continueCleanup.resolve()
    }
    expect(await outcome).toMatchObject({ code: 'STATE_CONFLICT' })
    const current = await db.archiveImport.findUniqueOrThrow({ where: { id: task.id } })
    expect(current.systemJobId).not.toBe(task.jobId)
    expect(current.cleanupRequestedAt).toBeNull()
    expect(await db.systemJob.count({ where: { type: 'ARCHIVE_MAINTENANCE', requestedByUserId: user } })).toBe(0)
  })
})
