import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  PrismaClient,
  freezeArtworkDedupRun,
  freezeArtworkDedupOperation,
  completeArtworkDedupPrepare,
  claimArtworkDedupOperationReader,
  recordArtworkDedupOperationReaderOwner,
  releaseArtworkDedupOperationReader,
  type Prisma
} from '@pixishelf/db'
import {
  MutableQueueClock,
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ClaimedJob,
  type QueueDatabase,
  type QueueSqlExecutor,
  type ExecutionContext,
  type EnqueuedChildJob
} from '@pixishelf/job-runtime'
import type { ArtworkDedupScanPayload } from '@pixishelf/job-contracts'
import { executeArtworkDedup } from '../executor.ts'
import { DedupReaderSupervisor } from '../reader.ts'
import { prepareArtworkInventory, prepareArtworkDirectory, type DedupPrepareContext } from '../maintenance-prepare.ts'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const suite = db ? describe.sequential : describe.skip
const prefix = `prepare-executor-${randomUUID()}`
const clock = new MutableQueueClock(new Date('2026-10-24T00:00:00Z'))
const repository = db
  ? new PostgresQueueRepository(db as unknown as QueueDatabase, { clock, transactionTimeoutMs: 20000 })
  : null
const workerRequire = createRequire(new URL('../../../../pixishelf-worker/package.json', import.meta.url))
const readerOptions = {
  entrypoint: new URL('../reader-child.ts', import.meta.url).pathname,
  execArgv: ['--import', workerRequire.resolve('tsx')]
}
const artists: number[] = [],
  artworks: number[] = [],
  runs: string[] = [],
  jobs: string[] = []
let root: string, userId: string
const fence = (job: ClaimedJob) => ({
  jobId: job.id,
  workerId: job.workerId,
  executionToken: job.executionToken,
  attempt: job.attempt
})
function scanContext(job: ClaimedJob): ExecutionContext<ArtworkDedupScanPayload, EnqueuedChildJob> {
  return {
    job,
    payload: job.payload as ArtworkDedupScanPayload,
    signal: new AbortController().signal,
    progress: (update) => repository!.updateProgress({ ...fence(job), ...update }),
    enqueueChild: async () => {
      throw new Error('Unexpected child')
    },
    mutateInTransaction: (operation) => repository!.withFencedMutationTransaction(fence(job), operation),
    finalizeInTransaction: async (operation) => {
      await repository!.withFencedExecutionTransaction(fence(job), operation)
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} }
  }
}
beforeAll(async () => {
  if (!db) return
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-prepare-')))
  userId = (await db.userBA.create({ data: { id: prefix, email: `${prefix}@test.invalid`, name: 'fixture' } })).id
})
afterAll(async () => {
  if (!db) return
  const identities = (
    await db.artworkDedupMedia.findMany({
      where: { runId: { in: runs } },
      distinct: ['rootIdentity'],
      select: { rootIdentity: true }
    })
  ).map((row) => row.rootIdentity)
  await db.artworkDedupOperation.deleteMany({ where: { runId: { in: runs } } })
  await db.artworkDedupRun.deleteMany({ where: { id: { in: runs } } })
  await db.systemJob.deleteMany({ where: { id: { in: jobs } } })
  await db.artwork.deleteMany({ where: { id: { in: artworks } } })
  await db.artist.deleteMany({ where: { id: { in: artists } } })
  await db.userBA.delete({ where: { id: userId } })
  await db.mediaContentDirectoryState.deleteMany({ where: { rootIdentity: { in: identities } } })
  await db.$disconnect()
  await fs.rm(root, { recursive: true, force: true })
})
async function fixture(count = 1, kind: 'LOCAL_DIRECTORY' | 'PIXIV_SCAN' = 'LOCAL_DIRECTORY') {
  const artist = await db!.artist.create({ data: { name: prefix } })
  artists.push(artist.id)
  const ids: number[] = []
  for (let n = 0; n < 2; n++) {
    const directory = `${randomUUID()}`
    await fs.mkdir(path.join(root, directory))
    const externalId = String(500000 + artworks.length)
    const metaSource = kind === 'PIXIV_SCAN' ? `${directory}/${externalId}-meta.json` : null
    const art = await db!.artwork.create({
      data: {
        title: prefix,
        createdVia: kind,
        storagePath: directory,
        storageKey: directory,
        externalId,
        metaSource,
        creators: {
          create: {
            artistId: artist.id,
            evidence: { create: { provenance: 'MANUAL', evidenceKey: 'manual', present: true } }
          }
        }
      }
    })
    artworks.push(art.id)
    ids.push(art.id)
    if (metaSource)
      await fs.writeFile(
        path.join(root, metaSource),
        JSON.stringify({ id: externalId, userId: '9', user: 'fixture', title: 'fixture' })
      )
    for (let i = 0; i < count; i++) {
      const relative = `${directory}/${String(i).padStart(4, '0')}.bin`
      await fs.writeFile(path.join(root, relative), Buffer.alloc(8, i % 255))
      await db!.image.create({ data: { artworkId: art.id, path: relative, size: 8n, sortOrder: i } })
    }
  }
  const scan = await db!.$transaction(async (tx) => {
    const { run } = await freezeArtworkDedupRun(tx, {
      artistId: artist.id,
      requestedBy: userId,
      idempotencyKey: randomUUID(),
      mode: 'FULL'
    })
    runs.push(run.id)
    const job = await tx.systemJob.create({
      data: {
        type: 'ARTWORK_DEDUP_SCAN',
        executionLane: 'BACKGROUND_WRITER',
        status: 'PENDING',
        triggerSource: 'SYSTEM',
        queuePriority: 900,
        effectivePriority: 900,
        availableAt: clock.now(),
        payload: { runId: run.id, executionVersion: 1 }
      }
    })
    jobs.push(job.id)
    await tx.artworkDedupRun.update({ where: { id: run.id }, data: { jobId: job.id } })
    return job
  })
  const scanJob = await repository!.claim(prefix, [
    { jobType: 'ARTWORK_DEDUP_SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
  ])
  expect(scanJob?.id).toBe(scan.id)
  await executeArtworkDedup(scanContext(scanJob!), {
    database: db!,
    sourceRoot: root,
    archiveRoot: root,
    readerOptions,
    now: () => clock.now().getTime()
  })
  const run = await db!.artworkDedupRun.findUniqueOrThrow({ where: { jobId: scan.id } })
  expect(run).toMatchObject({ status: 'COMPLETED', groupCount: 1 })
  const op = await db!.$transaction(async (tx) => {
    const { operation } = await freezeArtworkDedupOperation(tx, {
      userId,
      runId: run.id,
      expectedRunVersion: run.version,
      expectedReviewRevision: 0,
      idempotencyKey: randomUUID(),
      selection: { kind: 'ALL_RECOMMENDED', excludedGroupIds: [] }
    })
    const job = await tx.systemJob.create({
      data: {
        type: 'ARTWORK_DEDUP_MAINTENANCE',
        executionLane: 'BACKGROUND_WRITER',
        status: 'PENDING',
        triggerSource: 'SYSTEM',
        queuePriority: 900,
        effectivePriority: 900,
        availableAt: clock.now(),
        payload: { operationId: operation.id, executionVersion: 1, mode: 'PREPARE' }
      }
    })
    jobs.push(job.id)
    await tx.artworkDedupOperation.update({ where: { id: operation.id }, data: { jobId: job.id } })
    return { id: operation.id, jobId: job.id }
  })
  const job = await repository!.claim(prefix, [
    { jobType: 'ARTWORK_DEDUP_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
  ])
  expect(job?.id).toBe(op.jobId)
  const execution = { operationId: op.id, jobId: op.jobId, executionVersion: 1 }
  const transaction: DedupPrepareContext['transaction'] = <T>(action: (tx: Prisma.TransactionClient) => Promise<T>) =>
    repository!.withFencedMutationTransaction<Prisma.TransactionClient & QueueSqlExecutor, T>(fence(job!), (tx) =>
      action(tx)
    )
  const readerToken = randomUUID()
  await transaction((tx) => claimArtworkDedupOperationReader(tx, { execution, readerToken }))
  const reader = new DedupReaderSupervisor(readerOptions).create()
  const owner = await reader.start()
  await transaction((tx) => recordArtworkDedupOperationReaderOwner(tx, { execution, readerToken, owner }))
  const signal = new AbortController().signal
  const roots = await reader.resolveRoots(
    { operation: 'roots', sourceRoot: root, archiveRoot: root, expectedPixivRootIdentity: null },
    signal
  )
  const context: DedupPrepareContext = { execution, transaction, reader, roots, signal, shouldYield: () => false }
  return {
    context,
    ids,
    job: job!,
    item: (artworkId: number) =>
      db!.artworkDedupOperationArtwork.findUniqueOrThrow({
        where: { operationId_artworkId: { operationId: op.id, artworkId } }
      }),
    async close() {
      await reader.close()
      await db!.$transaction((tx) => releaseArtworkDedupOperationReader(tx, { execution, readerToken }))
      await db!.systemJob.update({ where: { id: job!.id }, data: { leaseToken: job!.leaseToken } })
      await repository!.fail({ ...fence(job!), errorCode: 'INTERNAL_ERROR', error: 'Fixture finished' })
    }
  }
}
async function finishInventory(f: Awaited<ReturnType<typeof fixture>>, id: number) {
  for (let n = 0; n < 100; n++) if (await prepareArtworkInventory(f.context, await f.item(id))) return
  throw new Error('Unbounded inventory')
}
async function finishDirectory(f: Awaited<ReturnType<typeof fixture>>, id: number) {
  for (let n = 0; n < 100; n++) if (await prepareArtworkDirectory(f.context, await f.item(id))) return
  throw new Error('Unbounded directory')
}
suite('readonly maintenance PREPARE with real PostgreSQL and controlled child', () => {
  it('resumes 51 media and a committed source without rereading; Pixiv flat neighbors are excluded', async () => {
    const f = await fixture(51, 'PIXIV_SCAN')
    try {
      const id = f.ids[0]!,
        art = await db!.artwork.findUniqueOrThrow({ where: { id } })
      await fs.writeFile(path.join(root, art.storagePath!, 'neighbor.txt'), 'not owned')
      expect(await prepareArtworkInventory(f.context, await f.item(id))).toBe(false)
      expect((await f.item(id)).fileCount).toBe(50n)
      expect(f.context.reader.metrics.inspections).toBe(50)
      let yieldAfterSource = false
      const original = f.context.reader.inspectSource.bind(f.context.reader)
      f.context.reader.inspectSource = async (input) => {
        const result = await original(input)
        yieldAfterSource = true
        return result
      }
      f.context.shouldYield = () => yieldAfterSource
      expect(await prepareArtworkInventory(f.context, await f.item(id))).toBe(false)
      expect((await f.item(id)).fileCount).toBe(52n)
      const bytes = f.context.reader.metrics.bytesRead
      f.context.shouldYield = () => false
      expect(await prepareArtworkInventory(f.context, await f.item(id))).toBe(true)
      expect(f.context.reader.metrics.bytesRead).toBe(bytes)
      await finishDirectory(f, id)
      expect(
        await db!.artworkDedupOperationFile.count({
          where: { operationId: f.context.execution.operationId, artworkId: id }
        })
      ).toBe(52)
      expect(await fs.readFile(path.join(root, art.storagePath!, 'neighbor.txt'), 'utf8')).toBe('not owned')
      expect(
        await db!.artworkDedupOperationFile.count({
          where: { operationId: f.context.execution.operationId, canonicalPath: { endsWith: 'neighbor.txt' } }
        })
      ).toBe(0)
    } finally {
      await f.close()
    }
  }, 30000)
  it('marks unregistered attachments as blocked and persists directory cursor progress', async () => {
    const f = await fixture()
    try {
      const id = f.ids[0]!,
        art = await db!.artwork.findUniqueOrThrow({ where: { id } })
      await fs.mkdir(path.join(root, art.storagePath!, 'unknown'))
      await fs.writeFile(path.join(root, art.storagePath!, 'unknown', 'private.bin'), 'unknown')
      await finishInventory(f, id)
      f.context.shouldYield = () => true
      expect(await prepareArtworkDirectory(f.context, await f.item(id))).toBe(false)
      expect((await f.item(id)).inspectionCheckpoint).toMatchObject({ version: 1, visited: 1 })
      f.context.shouldYield = () => false
      await finishDirectory(f, id)
      const rows = await db!.artworkDedupOperationFile.findMany({
        where: { operationId: f.context.execution.operationId, artworkId: id, requiresReview: true }
      })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        role: 'UNKNOWN',
        fileType: 'DIRECTORY',
        status: 'BLOCKED',
        ownershipStatus: 'UNCONFIRMED',
        blockReason: 'UNREVIEWED_ATTACHMENT'
      })
      expect(await fs.readFile(path.join(root, art.storagePath!, 'unknown', 'private.bin'), 'utf8')).toBe('unknown')
    } finally {
      await f.close()
    }
  }, 20000)
  it.each(['HARD_LINK', 'MISSING', 'SHARED_PATH'] as const)(
    'does not authorize a %s file',
    async (problem) => {
      const f = await fixture()
      try {
        const id = f.ids[0]!,
          image = await db!.image.findFirstOrThrow({ where: { artworkId: id } })
        if (problem === 'HARD_LINK') await fs.link(path.join(root, image.path), path.join(root, `${randomUUID()}.bin`))
        if (problem === 'MISSING') await fs.unlink(path.join(root, image.path))
        if (problem === 'SHARED_PATH') await db!.image.create({ data: { path: image.path, size: 8n } })
        try {
          await finishInventory(f, id)
          const row = await db!.artworkDedupOperationFile.findFirstOrThrow({
            where: { operationId: f.context.execution.operationId, imageId: image.id }
          })
          expect(row.status).toBe('BLOCKED')
          if (problem !== 'MISSING') expect(row.blockReason).toBe(problem)
          if (problem === 'SHARED_PATH') expect(row.ownershipStatus).toBe('SHARED')
        } finally {
          if (problem === 'SHARED_PATH') await db!.image.deleteMany({ where: { artworkId: null, path: image.path } })
        }
      } finally {
        await f.close()
      }
    },
    20000
  )
  it.each(['SNAPSHOT', 'LEASE'] as const)(
    'rejects %s changes after the read before committing its media cursor',
    async (change) => {
      const f = await fixture()
      try {
        const id = f.ids[0]!,
          original = f.context.reader.inspectMaintenance.bind(f.context.reader)
        f.context.reader.inspectMaintenance = async (input) => {
          const result = await original(input)
          if (change === 'SNAPSHOT')
            await db!.image.create({ data: { artworkId: id, path: `${randomUUID()}.bin`, size: 8n } })
          else await db!.systemJob.update({ where: { id: f.job.id }, data: { leaseToken: randomUUID() } })
          return result
        }
        await expect(prepareArtworkInventory(f.context, await f.item(id))).rejects.toThrow()
        expect((await f.item(id)).afterImageId).toBe(0)
        expect(
          await db!.artworkDedupOperationFile.count({ where: { operationId: f.context.execution.operationId } })
        ).toBe(0)
      } finally {
        await f.close()
      }
    },
    20000
  )
  it('rejects a directory modified between pages without discarding its persisted cursor', async () => {
    const f = await fixture(2)
    try {
      const id = f.ids[0]!,
        art = await db!.artwork.findUniqueOrThrow({ where: { id } })
      await finishInventory(f, id)
      f.context.shouldYield = () => true
      expect(await prepareArtworkDirectory(f.context, await f.item(id))).toBe(false)
      const before = (await f.item(id)).inspectionCheckpoint
      await fs.writeFile(path.join(root, art.storagePath!, 'late.bin'), 'late')
      f.context.shouldYield = () => false
      await expect(prepareArtworkDirectory(f.context, await f.item(id))).rejects.toMatchObject({ code: 'FILE_CHANGED' })
      expect((await f.item(id)).inspectionCheckpoint).toEqual(before)
    } finally {
      await f.close()
    }
  }, 20000)
  it.each(['SYMLINK', 'DIRECTORY', 'FIFO'] as const)(
    'blocks a known media replaced by %s after inventory without duplicating counts',
    async (kind) => {
      const f = await fixture()
      try {
        const id = f.ids[0]!,
          image = await db!.image.findFirstOrThrow({ where: { artworkId: id } })
        await finishInventory(f, id)
        await fs.unlink(path.join(root, image.path))
        if (kind === 'DIRECTORY') await fs.mkdir(path.join(root, image.path))
        else if (kind === 'SYMLINK') await fs.symlink('missing-target', path.join(root, image.path))
        else execFileSync('mkfifo', [path.join(root, image.path)])
        await finishDirectory(f, id)
        const row = await db!.artworkDedupOperationFile.findFirstOrThrow({
          where: { operationId: f.context.execution.operationId, imageId: image.id }
        })
        expect(row).toMatchObject({
          status: 'BLOCKED',
          blockReason: 'FILE_CHANGED',
          fileType: kind === 'FIFO' ? 'OTHER' : kind
        })
        expect((await f.item(id)).fileCount).toBe(1n)
        expect(
          (await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: f.context.execution.operationId } }))
            .preparedFiles
        ).toBe(1n)
        const other = f.ids[1]!
        await finishInventory(f, other)
        await finishDirectory(f, other)
        expect(
          (await f.context.transaction((tx) => completeArtworkDedupPrepare(tx, { execution: f.context.execution })))
            .status
        ).toBe('FAILED')
      } finally {
        await f.close()
      }
    },
    20000
  )
  it('publishes a complete preview from exact rows, counting only COPY bytes and preserving originals', async () => {
    const f = await fixture(2)
    try {
      for (const id of f.ids) {
        await finishInventory(f, id)
        await finishDirectory(f, id)
      }
      const op = await f.context.transaction((tx) =>
        completeArtworkDedupPrepare(tx, { execution: f.context.execution })
      )
      expect(op).toMatchObject({ status: 'READY', preparedFiles: 4n, logicalBytes: 16n })
      for (const image of await db!.image.findMany({ where: { artworkId: { in: f.ids } } }))
        expect((await fs.stat(path.join(root, image.path))).size).toBe(8)
    } finally {
      await f.close()
    }
  }, 20000)
})
