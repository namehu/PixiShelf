// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
const hooks = vi.hoisted(() => ({
  wrap: null as ((tx: any) => any) | null,
  after: null as (() => Promise<void>) | null,
  timeout: false
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', async () => {
  const { db } = await import('../../../../pixishelf-db/src/__tests__/artwork-dedup-maintenance-fixture')
  if (!db) return { prisma: {} }
  return {
    prisma: new Proxy(db!, {
      get(target, key) {
        if (key === '$transaction') {
          return (run: (tx: unknown) => Promise<unknown>) =>
            target.$transaction(
              async (tx) => {
                if (hooks.timeout) await tx.$executeRawUnsafe("SET LOCAL lock_timeout='150ms'")
                const result = await run(hooks.wrap ? hooks.wrap(tx) : tx)
                if (hooks.after) await hooks.after()
                return result
              },
              { timeout: 10000 }
            )
        }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      }
    })
  }
})
import {
  Prisma,
  claimArtworkDedupScope,
  completeArtworkDedupPrepare,
  captureMediaContentDirectory,
  captureArtworkDedupSources
} from '@pixishelf/db'
import {
  MutableQueueClock,
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ExecutionContext,
  type EnqueuedChildJob,
  type QueueDatabase
} from '@pixishelf/job-runtime'
import type { ArchiveMaintenancePayload } from '@pixishelf/job-contracts'
import {
  db,
  seed,
  prepared,
  cleanupFixture,
  prefix
} from '../../../../pixishelf-db/src/__tests__/artwork-dedup-maintenance-fixture'
import { resolveMediaContentRoots } from '../../../../pixishelf-job-executors/src/media-content/roots.ts'
import { beginExecutorMediaDirectoryWrites } from '../../../../pixishelf-job-executors/src/scan/media-content-write.ts'
import { executeArchiveMaintenance } from '../../../../pixishelf-job-executors/src/archive/maintenance-executor.ts'
import { beginContentUpload } from '../content-source-guard'
import { uploadMediaChapterManifest } from '../media-chapter-upload'
import { setArtworkRating } from '../../artwork-rating-service'
import { deleteUser } from '../../user-service'
const operationIds: string[] = [],
  tokens: string[] = [],
  ownJobs: string[] = [],
  sourceIds: string[] = []
let root: string, binding: Awaited<ReturnType<typeof resolveMediaContentRoots>>
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
if (url) {
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/dedup_executor_next') {
    throw new Error('Use the authorized synthetic executor database')
  }
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
async function stopJob(id: string, status: 'COMPLETED' | 'PAUSED' = 'COMPLETED') {
  await db!.systemJob.update({
    where: { id },
    data: { status, leaseToken: null, leaseExpiresAt: null, workerId: null, heartbeatAt: null }
  })
}
async function ready() {
  const f = await db!.$transaction((tx) => seed(tx))
  const execution = await db!.$transaction((tx) => prepared(tx, f))
  operationIds.push(execution.operationId)
  const roots = {
    version: 1,
    source: { logicalRoot: binding.source.logicalRoot, rootIdentity: binding.source.rootIdentity },
    archive: { logicalRoot: binding.archive.logicalRoot, rootIdentity: binding.archive.rootIdentity },
    archiveRelativePrefix: ''
  }
  await db!.artworkDedupOperation.update({ where: { id: execution.operationId }, data: { rootBindings: roots } })
  await db!.artworkDedupOperationFile.updateMany({
    where: { operationId: execution.operationId },
    data: { rootIdentity: binding.source.rootIdentity }
  })
  const op = await db!.$transaction((tx) => completeArtworkDedupPrepare(tx, { execution }))
  expect(op.status).toBe('READY')
  await db!.artworkDedupOperation.update({
    where: { id: op.id },
    data: {
      status: 'ISOLATING',
      mode: 'ISOLATE',
      backupCheckpointRef: prefix,
      backupConfirmedAt: new Date(),
      externalWritesStoppedAt: new Date()
    }
  })
  await db!.systemJob.update({
    where: { id: execution.jobId },
    data: { payload: { operationId: op.id, executionVersion: 1, mode: 'ISOLATE' } }
  })
  const image = await db!.image.findFirstOrThrow({ where: { artworkId: f.members[0]![0] } })
  return { f, execution, expectedVersion: op.version, image }
}
const claim = (f: Awaited<ReturnType<typeof ready>>, tx: Prisma.TransactionClient) =>
  claimArtworkDedupScope(tx, { execution: f.execution, expectedVersion: f.expectedVersion })
function chapter(f: Awaited<ReturnType<typeof ready>>) {
  const writeToken = randomUUID()
  tokens.push(writeToken)
  return {
    scanRoot: root,
    absolutePath: `${prefix}/${randomUUID()}.chapters.json`,
    userId: f.f.actor.id,
    sessionId: randomUUID(),
    writeToken,
    declaredFileSize: 4,
    totalChunks: 1,
    relatedImage: { imageId: f.image.id, artworkId: f.image.artworkId!, path: f.image.path }
  }
}
function catalogProbe(artworkId: number, userId: string) {
  let hits = 0
  return {
    hits: () => hits,
    wrap<T extends object>(tx: T): T {
      let seen = false
      return new Proxy(tx, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver)
          if (key !== '$queryRawUnsafe') return value
          return async (...args: unknown[]) => {
            if (!seen && String(args[0]).includes('pg_advisory_xact_lock(7341902118)')) {
              seen = true
              await db!.$transaction(async (other) => {
                await other.$executeRawUnsafe("SET LOCAL lock_timeout='250ms'")
                await other.$queryRawUnsafe('SELECT pg_advisory_xact_lock(7341902118)::text')
                expect(await other.$queryRaw`SELECT id FROM "Artwork" WHERE id=${artworkId} FOR UPDATE`).toHaveLength(1)
                expect(await other.$queryRaw`SELECT id FROM "UserBA" WHERE id=${userId} FOR UPDATE`).toHaveLength(1)
              })
              hits++
            }
            return Reflect.apply(value as (...a: unknown[]) => unknown, target, args)
          }
        }
      })
    }
  }
}
async function maintenanceJob(
  artworkId: number,
  payload: ArchiveMaintenancePayload = { action: 'TRASH_ARCHIVE', artworkId }
) {
  const now = new Date(),
    id = `${prefix}-${randomUUID()}`
  const row = await db!.systemJob.create({
    data: {
      id,
      type: 'ARCHIVE_MAINTENANCE',
      status: 'PENDING',
      triggerSource: 'MANUAL',
      payload,
      requestedByUserId: prefix,
      availableAt: now,
      queuePriority: 0,
      effectivePriority: 0
    }
  })
  ownJobs.push(id)
  expect(
    await db!.systemJob.count({
      where: { type: 'ARCHIVE_MAINTENANCE', status: { in: ['PENDING', 'RETRY_WAIT'] }, id: { notIn: ownJobs } }
    })
  ).toBe(0)
  const repository = new PostgresQueueRepository(db! as unknown as QueueDatabase, {
    clock: new MutableQueueClock(now),
    transactionTimeoutMs: 10000
  })
  const job = (await repository.claim(prefix, [
    { jobType: 'ARCHIVE_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
  ]))!
  expect(job.id).toBe(id)
  const fence = { jobId: id, executionToken: job.executionToken, workerId: prefix, attempt: job.attempt }
  const context: ExecutionContext<ArchiveMaintenancePayload, EnqueuedChildJob> = {
    job,
    payload: row.payload as ArchiveMaintenancePayload,
    signal: new AbortController().signal,
    progress: (input) => repository.updateProgress({ ...fence, ...input }),
    enqueueChild: vi.fn(),
    mutateInTransaction: (work) => repository.withFencedMutationTransaction(fence, work),
    finalizeInTransaction: async (work) => {
      await repository.withFencedExecutionTransaction(fence, work)
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  }
  return { context, repository, fence }
}
describe.skipIf(!db)('B1 remaining App and maintenance admission evidence', () => {
  beforeAll(async () => {
    expect(await db!.mediaContentDirectoryState.count({ where: { relativeDirectory: '' } })).toBe(0)
    root = await mkdtemp(path.join(os.tmpdir(), 'dedup-b1-evidence-'))
    await mkdir(path.join(root, prefix))
    binding = await resolveMediaContentRoots({ sourceRoot: root, archiveRoot: root, expectedPixivRootIdentity: null })
    const result = await db!.$transaction((tx) =>
      captureMediaContentDirectory(tx, {
        directory: {
          logicalRoot: binding.source.logicalRoot,
          rootIdentity: binding.source.rootIdentity,
          relativeDirectory: prefix
        }
      })
    )
    expect(result.status).toBe('READY')
  })
  afterEach(async () => {
    hooks.wrap = null
    hooks.after = null
    hooks.timeout = false
    const sources = await db!.artworkDedupOperationSource.findMany({
      where: { operationId: { in: operationIds } },
      select: { sourceId: true }
    })
    await db!.artworkDedupClaim.deleteMany({ where: { operationId: { in: operationIds } } })
    await db!.artworkDedupOperationSource.deleteMany({ where: { operationId: { in: operationIds } } })
    await db!.artworkDedupSourceIdentity.deleteMany({
      where: { id: { in: [...sources.map((s) => s.sourceId), ...sourceIds] } }
    })
    await db!.mediaContentSource.updateMany({
      where: { writeToken: { in: tokens } },
      data: { writeToken: null, writeStartedAt: null }
    })
    await db!.artworkContentSource.updateMany({
      where: { writeToken: { in: tokens } },
      data: { writeToken: null, writeStartedAt: null }
    })
    const jobIds = [
      ...ownJobs,
      ...(
        await db!.artworkDedupOperation.findMany({ where: { id: { in: operationIds } }, select: { jobId: true } })
      ).flatMap((op) => (op.jobId ? [op.jobId] : []))
    ]
    await db!.mediaContentSource.updateMany({
      where: {
        writeToken: {
          in: (
            await db!.mediaContentPathWrite.findMany({
              where: { jobId: { in: ownJobs } },
              select: { writeToken: true }
            })
          ).map((w) => w.writeToken)
        }
      },
      data: { writeToken: null, writeStartedAt: null }
    })
    await db!.artworkContentSource.updateMany({
      where: { artwork: { title: prefix } },
      data: { writeToken: null, writeStartedAt: null }
    })
    await db!.mediaContentPathWrite.deleteMany({
      where: { OR: [{ writeToken: { in: tokens } }, { jobId: { in: ownJobs } }] }
    })
    await db!.jobResourceLease.deleteMany({ where: { ownerJobId: { in: ownJobs } } })
    for (const id of jobIds) if (await db!.systemJob.findUnique({ where: { id } })) await stopJob(id)
    await cleanupFixture()
  })
  afterAll(async () => {
    await db!.mediaContentSource.updateMany({
      where: { directory: { rootIdentity: binding.source.rootIdentity } },
      data: { directoryStateId: null }
    })
    await db!.mediaContentPathWrite.deleteMany({ where: { directory: { rootIdentity: binding.source.rootIdentity } } })
    await db!.mediaContentDirectoryState.deleteMany({ where: { rootIdentity: binding.source.rootIdentity } })
    await db!.archiveImport.deleteMany({ where: { systemJobId: { in: ownJobs } } })
    await db!.jobResourceLease.deleteMany({ where: { ownerJobId: { in: ownJobs } } })
    await db!.systemJob.deleteMany({ where: { id: { in: ownJobs } } })
    await rm(root, { recursive: true, force: true })
    await cleanupFixture()
  })
  it('first chapter begin holds real root/source locks; actual claim waits then rejects the committed media writer', async () => {
    const f = await ready(),
      input = chapter(f),
      acquired = deferred(),
      release = deferred()
    hooks.after = async () => {
      acquired.resolve()
      await release.promise
    }
    const writing = beginContentUpload(input)
    await acquired.promise
    try {
      await expect(
        db!.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL lock_timeout='150ms'")
          await claim(f, tx)
        })
      ).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } })
    } finally {
      release.resolve()
      await writing
      hooks.after = null
    }
    expect(await db!.mediaContentSource.findUnique({ where: { imageId: f.image.id } })).toMatchObject({
      writeToken: input.writeToken
    })
    await expect(db!.$transaction((tx) => claim(f, tx))).rejects.toMatchObject({ code: 'STALE' })
    expect(await db!.artworkDedupClaim.count({ where: { operationId: f.execution.operationId } })).toBe(0)
  })
  it('actual claim holds the shared root; first chapter begin waits then refuses with zero declaration', async () => {
    const f = await ready(),
      input = chapter(f),
      acquired = deferred(),
      release = deferred()
    const claiming = db!.$transaction(
      async (tx) => {
        await claim(f, tx)
        acquired.resolve()
        await release.promise
      },
      { timeout: 10000 }
    )
    await acquired.promise
    hooks.timeout = true
    try {
      await expect(beginContentUpload(input)).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } })
    } finally {
      release.resolve()
      await claiming
      hooks.timeout = false
    }
    await expect(beginContentUpload(input)).rejects.toMatchObject({ status: 'WRITING' })
    expect(await db!.mediaContentPathWrite.count({ where: { writeToken: input.writeToken } })).toBe(0)
    expect((await db!.mediaContentSource.findUnique({ where: { imageId: f.image.id } }))?.writeToken ?? null).toBeNull()
  })
  it('path-only chapter upload declares the actual matching Image before returning its existing authorization requirement', async () => {
    const f = await db!.$transaction((tx) => seed(tx)),
      id = f.members[0]![0]!
    const image = await db!.image.findFirstOrThrow({ where: { artworkId: id } }),
      videoPath = `${prefix}/${image.id}.mp4`,
      token = randomUUID()
    tokens.push(token)
    await db!.artwork.update({ where: { id }, data: { storagePath: prefix } })
    await db!.image.update({ where: { id: image.id }, data: { path: videoPath, mediaType: 'VIDEO' } })
    await writeFile(path.join(root, videoPath), 'synthetic-video')
    await expect(
      uploadMediaChapterManifest({
        scanRoot: root,
        userId: f.actor.id,
        expectedUserId: f.actor.id,
        uploadSessionId: randomUUID(),
        uploadToken: token,
        uploadRequestId: randomUUID(),
        artworkId: id,
        imageId: null,
        videoPath,
        manifestText: JSON.stringify({
          version: 1,
          duration: 1,
          chapters: [{ index: 1, start: 0, end: 1, duration: 1, title: 'one' }]
        })
      })
    ).rejects.toMatchObject({ status: 409, message: 'Replacement authorization required' })
    expect(await db!.mediaContentSource.findUnique({ where: { imageId: image.id } })).toMatchObject({
      writeToken: token
    })
    expect(await db!.mediaContentPathWrite.findUnique({ where: { writeToken: token } })).toMatchObject({
      status: 'READY'
    })
    expect(await db!.image.findUnique({ where: { id: image.id } })).toMatchObject({ chaptersPath: null })
  })
  it.each(['rating', 'user-cascade'] as const)(
    '%s reaches catalog before holding Artwork/User and completes the actual trigger-producing write',
    async (action) => {
      const f = await db!.$transaction((tx) => seed(tx)),
        id = f.members[0]![0]!
      if (action === 'user-cascade') {
        await db!.artworkLike.create({ data: { userId: f.other.id, artworkId: id, level: 2 } })
      }
      const probe = catalogProbe(id, action === 'rating' ? f.actor.id : f.other.id)
      hooks.wrap = probe.wrap
      if (action === 'rating') expect(await setArtworkRating(f.actor.id, id, 3)).toMatchObject({ level: 3 })
      else {
        await deleteUser(f.other.id)
        expect(await db!.artworkLike.count({ where: { artworkId: id, userId: f.other.id } })).toBe(0)
        expect(await db!.userBA.findUnique({ where: { id: f.other.id } })).toBeNull()
      }
      expect(probe.hits()).toBe(1)
      expect(await db!.artwork.findUnique({ where: { id } })).not.toBeNull()
    }
  )
  it('real maintenance declaration survives writer turnover and blocks actual claim at the shared root', async () => {
    const f = await ready()
    await stopJob(f.execution.jobId, 'PAUSED')
    const id = f.f.members[0]![1]!,
      now = new Date()
    await db!.artwork.update({
      where: { id },
      data: { createdVia: 'URL_ARCHIVE', source: 'URL_ARCHIVE', archiveLifecycleState: 'TRASHING', deletedAt: now }
    })
    const ref = await db!.artworkExternalRef.create({
      data: {
        artworkId: id,
        providerKey: 'b1-evidence',
        externalId: randomUUID(),
        canonicalUrl: 'https://example.test/',
        locator: {}
      }
    })
    await db!.archiveRevision.create({
      data: {
        artworkId: id,
        externalRefId: ref.id,
        archivePath: prefix,
        trashPath: `.trash/archive/${id}/rev`,
        manifestPath: `${prefix}/manifest.json`,
        mediaSnapshot: [],
        metadataHash: 'a'.repeat(64),
        isCurrent: true
      }
    })
    const m = await maintenanceJob(id),
      original = m.context.mutateInTransaction,
      stopped = new Error('controlled stop after durable maintenance begin')
    m.context.mutateInTransaction = async (work) => {
      const result = await original(work)
      if (result && typeof result === 'object' && 'handles' in result) throw stopped
      return result
    }
    await expect(executeArchiveMaintenance(m.context, { database: db!, config: { scanRoot: root } })).rejects.toBe(
      stopped
    )
    const writes = await db!.mediaContentPathWrite.findMany({ where: { jobId: m.fence.jobId } })
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.every((w) => w.status === 'ACTIVE')).toBe(true)
    const directory = await db!.mediaContentDirectoryState.findUniqueOrThrow({
      where: { logicalRoot_relativeDirectory: { logicalRoot: binding.source.logicalRoot, relativeDirectory: prefix } }
    })
    expect(directory.rootIdentity).toBe(binding.source.rootIdentity)
    expect(
      writes.some(
        (write) =>
          write.scope === 'DIRECTORY' &&
          write.directoryId === directory.id &&
          write.sessionId === `archive-maintenance:${m.fence.jobId}`
      )
    ).toBe(true)
    await m.repository.withFencedExecutionTransaction(m.fence, async (scope) => {
      await scope.fail({ errorCode: 'INTERNAL_ERROR', error: 'Synthetic stopped maintenance' })
    })
    await db!.systemJob.update({
      where: { id: f.execution.jobId },
      data: {
        status: 'RUNNING',
        workerId: prefix,
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() + 60000)
      }
    })
    await expect(db!.$transaction((tx) => claim(f, tx))).rejects.toMatchObject({ code: 'CONTENT_WRITING' })
    expect(await db!.artworkDedupClaim.count({ where: { operationId: f.execution.operationId } })).toBe(0)
  })
  it('actual persistent claim refuses a maintenance-owned directory begin after the original writer leaves the lane', async () => {
    const f = await ready()
    await db!.$transaction((tx) => claim(f, tx))
    await stopJob(f.execution.jobId)
    const held = await db!.artworkDedupOperationSource.findMany({
      where: { operationId: f.execution.operationId },
      include: { source: true }
    })
    expect(
      held.some(
        (row) =>
          row.source.logicalRoot === binding.source.logicalRoot &&
          row.source.rootIdentity === binding.source.rootIdentity &&
          row.source.canonicalPath === f.image.path &&
          row.source.status === 'HOLD' &&
          row.source.ownerOperationId === f.execution.operationId
      )
    ).toBe(true)
    const m = await maintenanceJob(f.image.artworkId!)
    await expect(
      beginExecutorMediaDirectoryWrites({
        context: m.context,
        directories: [
          {
            logicalRoot: binding.source.logicalRoot,
            rootIdentity: binding.source.rootIdentity,
            relativeDirectory: prefix
          }
        ],
        artworkIds: [f.image.artworkId!],
        sessionId: `archive-maintenance:${m.fence.jobId}`
      })
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(await db!.mediaContentPathWrite.count({ where: { jobId: m.fence.jobId } })).toBe(0)
    expect(await db!.artworkDedupClaim.count({ where: { operationId: f.execution.operationId } })).toBe(2)
  })
  it('RECONCILE leaves both source-HOLD staging and persistent URL-HOLD artwork unmaterialized', async () => {
    const f = await db!.$transaction((tx) => seed(tx)),
      id = f.members[0]![0]!,
      now = new Date()
    const operation = await db!.artworkDedupOperation.create({
      data: {
        runId: f.run.id,
        artistId: f.artist.id,
        requestedBy: f.actor.id,
        idempotencyKey: randomUUID(),
        requestDigest: prefix,
        runVersion: 1,
        frozenReviewRevision: 0,
        selectionKind: 'EXPLICIT'
      }
    })
    operationIds.push(operation.id)
    const artwork = await db!.artwork.update({
      where: { id },
      data: { createdVia: 'URL_ARCHIVE', source: 'URL_ARCHIVE', archiveLifecycleState: 'TRASHING', deletedAt: now }
    })
    const externalId = randomUUID(),
      ref = await db!.artworkExternalRef.create({
        data: {
          artworkId: id,
          providerKey: 'b1-evidence',
          externalId,
          canonicalUrl: 'https://example.test/',
          locator: {}
        }
      })
    await db!.archiveRevision.create({
      data: {
        artworkId: id,
        externalRefId: ref.id,
        archivePath: `${prefix}/rev`,
        trashPath: `.trash/archive/${id}/rev`,
        manifestPath: `${prefix}/rev/manifest.json`,
        metadataHash: 'a'.repeat(64),
        mediaSnapshot: [],
        isCurrent: true,
        purgeAfter: new Date(now.getTime() - 1000)
      }
    })
    await db!.artworkDedupOperationArtwork.create({
      data: {
        operationId: operation.id,
        artworkId: id,
        groupId: f.groupIds[0]!,
        role: 'COPY',
        status: 'RECOVERY_REQUIRED',
        title: prefix,
        sourceLabel: 'URL',
        artworkCreatedAt: artwork.createdAt,
        isUrl: true,
        frozenMediaRevision: artwork.mediaRevision,
        snapshotRevision: 0n,
        mediaEpoch: 0n,
        membersSignature: 'a'.repeat(64),
        contentSha256: 'a'.repeat(64),
        algorithmVersion: 1,
        memberCount: 1n,
        organizationSignature: 'a'.repeat(64),
        sourceSignature: 'a'.repeat(64),
        creatorSignature: 'a'.repeat(64)
      }
    })
    const importId = `${prefix}-${randomUUID()}`
    ownJobs.push(importId)
    await db!.systemJob.create({
      data: { id: importId, type: 'ARCHIVE_IMPORT', status: 'COMPLETED', payload: { archiveImportId: importId } }
    })
    const stage = await db!.archiveImport.create({
      data: {
        id: importId,
        systemJobId: importId,
        providerKey: 'b1-evidence',
        externalId: importId,
        submittedUrl: 'https://example.test/',
        canonicalUrl: 'https://example.test/',
        locator: {},
        normalizedMetadata: {},
        rawMetadata: {},
        metadataHash: 'a'.repeat(64),
        creatorBucket: 'fixture',
        stagingPath: `.archive-staging/${importId}`,
        status: 'FAILED',
        retainUntil: new Date(now.getTime() - 1000)
      }
    })
    const [source] = await db!.$transaction((tx) =>
      captureArtworkDedupSources(tx, {
        identities: [{ kind: 'PROVIDER', providerKey: stage.providerKey, externalId: stage.externalId }]
      })
    )
    sourceIds.push(source!.sourceId)
    await db!.artworkDedupSourceIdentity.update({
      where: { id: source!.sourceId },
      data: { status: 'HOLD', ownerOperationId: operation.id }
    })
    // Refuse to run a global materializer if any unrelated disposable fixture is eligible.
    expect(
      await db!.archiveImport.count({
        where: {
          id: { not: importId },
          OR: [
            { cleanupRequestedAt: { not: null } },
            { status: { in: ['FAILED', 'CANCELLED'] }, retainUntil: { lte: now } }
          ]
        }
      })
    ).toBe(0)
    expect(
      await db!.artwork.count({
        where: {
          id: { not: id },
          createdVia: 'URL_ARCHIVE',
          archiveLifecycleState: { in: ['TRASHING', 'RESTORING', 'TRASHED'] }
        }
      })
    ).toBe(0)
    const m = await maintenanceJob(id, { action: 'RECONCILE' }),
      beforeJobs = await db!.systemJob.count({ where: { requestedByUserId: prefix } })
    await executeArchiveMaintenance(m.context, { database: db!, config: { scanRoot: root }, now: () => now })
    expect(m.context.enqueueChild).not.toHaveBeenCalled()
    expect(await db!.systemJob.findUniqueOrThrow({ where: { id: m.fence.jobId } })).toMatchObject({
      status: 'COMPLETED',
      result: { action: 'RECONCILE', discovered: 2, skipped: 2, materialized: 0, reused: 0 }
    })
    expect(await db!.systemJob.count({ where: { requestedByUserId: prefix } })).toBe(beforeJobs)
    expect(await db!.archiveImport.findUniqueOrThrow({ where: { id: importId } })).toEqual(stage)
    expect(await db!.artwork.findUniqueOrThrow({ where: { id } })).toEqual(artwork)
  })
})
