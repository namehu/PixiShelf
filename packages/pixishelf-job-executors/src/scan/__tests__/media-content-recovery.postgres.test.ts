import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  PrismaClient,
  inspectMediaContentRecovery,
  grantMediaContentRecovery,
  resumeGrantedMediaContentRecovery,
  type Prisma
} from '@pixishelf/db'
import {
  MutableQueueClock,
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ClaimedJob,
  type ExecutionContext,
  type EnqueuedChildJob,
  type QueueDatabase
} from '@pixishelf/job-runtime'
import { type JobType, type PendingReplacePayload, type MigrationPayload } from '@pixishelf/job-contracts'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginExecutorMediaWrite, resolveExecutorMediaDirectory } from '../media-content-write.ts'
import { readExecutorMediaRecoveryDomainSnapshot } from '../media-content-recovery.ts'
import { cleanupFixtureContentDirectories } from './content-directory-cleanup.ts'
import { executePendingReplace } from '../../pending-replace/executor.ts'
import { createPrismaPendingReplaceDatabase } from '../../pending-replace/prisma-database.ts'
import { createNodePendingReplaceFileSystem } from '../../pending-replace/file-system.ts'
import { createManifestFingerprint } from '../../pending-replace/snapshot.ts'
import { executeMigration } from '../../migration/executor.ts'
import { createPrismaMigrationDatabase } from '../../migration/prisma-database.ts'
import { MigrationPermanentError } from '../../migration/types.ts'
import type { ExecutorMediaWrite } from '../media-content-write.ts'
import { createNodeMigrationFileSystem } from '../../migration/file-system.ts'
import { createVideoProcessingExecutorRegistrations } from '../../video-processing/executors.ts'
import { getStreamingArtifactPaths } from '../../video-processing/streaming-optimization.ts'
import type { VideoProcessRunner } from '../../video-processing/types.ts'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const suite = url ? describe.sequential : describe.skip
const prefix = `content-recovery-${randomUUID()}`
const roots: string[] = []
const clock = new MutableQueueClock(new Date())
const repo = db ? new PostgresQueueRepository(db as unknown as QueueDatabase, { clock, leaseDurationMs: 60_000 }) : null
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

suite('offline grants restore existing executor checkpoints', () => {
  beforeEach(cleanup)
  afterAll(async () => {
    await cleanup()
    await db?.$disconnect()
  })

  it.each(['offline-recovery', 'cancel'] as const)(
    'settles pending replacement COMMITTING through %s',
    async (mode) => {
      const root = await temporaryRoot()
      const artwork = await db!.artwork.create({ data: { title: prefix } })
      await db!.image.create({
        data: {
          artworkId: artwork.id,
          path: '/artworks/123_p0.jpg',
          size: 11n,
          width: 1,
          height: 1,
          sortOrder: 0,
          mediaType: 'IMAGE'
        }
      })
      const batchId = `${prefix}-batch`,
        itemId = `${prefix}-item`
      const payload: PendingReplacePayload = { mode: 'BATCH', batchId, itemIds: [itemId], appendTagIds: [] }
      const jobId = await seedJob('PENDING_REPLACE', 'pending', payload)
      await db!.pendingReplaceBatch.create({
        data: { id: batchId, sourceRoot: '/pending-replaces', status: 'RUNNING' }
      })
      const manifest = [
        {
          name: 'incoming.jpg',
          size: 11,
          mtimeMs: 1,
          sha256: hash('new-content'),
          kind: 'media',
          targetName: '123_p0.jpg'
        }
      ]
      const media = (name: string, storedPath: string, contents: string) => ({
        sourceName: name,
        targetName: '123_p0.jpg',
        path: storedPath,
        size: 11,
        databaseSize: 11,
        sha256: hash(contents),
        width: 1,
        height: 1,
        order: 0,
        mtimeMs: 1,
        mediaType: 'IMAGE'
      })
      await db!.pendingReplaceItem.create({
        data: {
          id: itemId,
          batchId,
          artworkId: artwork.id,
          externalId: '123',
          sourceDirectory: '/pending-replaces/source__ext-123',
          sourceDirectoryName: 'source__ext-123',
          targetDirectory: '/artworks',
          status: 'COMMITTING',
          fingerprint: createManifestFingerprint(manifest as never),
          sourceManifest: manifest,
          oldMediaSnapshot: [media('123_p0.jpg', '/artworks/123_p0.jpg', 'old-content')],
          newMediaSnapshot: [media('incoming.jpg', '/pending-replaces/source__ext-123/incoming.jpg', 'new-content')],
          targetFileSnapshot: [{ name: '123_p0.jpg', size: 11, mtimeMs: 1, sha256: hash('old-content') }],
          warnings: [],
          backupDirectory: `/replace-backups/${batchId}/${itemId}`
        }
      })
      await db!.pendingReplaceOperation.create({ data: { systemJobId: jobId, batchId, mode: 'BATCH' } })
      for (const directory of [
        'artworks',
        `.replace-work/${batchId}/${itemId}/source`,
        `.replace-work/${batchId}/${itemId}/normalized`,
        `replace-backups/${batchId}/${itemId}`
      ])
        await fs.mkdir(path.join(root, directory), { recursive: true })
      await fs.writeFile(path.join(root, 'artworks/123_p0.jpg'), 'new-content')
      await fs.writeFile(path.join(root, `replace-backups/${batchId}/${itemId}/123_p0.jpg`), 'old-content')
      const port = createPrismaPendingReplaceDatabase(db!)
      const first = await claim('PENDING_REPLACE')
      const [item] = await port.loadItems(batchId, [itemId])
      await port.beginContentWrite({ context: context(first), scanRoot: root, item: item!, action: 'replace' })
      if (mode === 'cancel') {
        const begin = port.beginContentWrite
        port.beginContentWrite = async (input) => {
          const write = await begin(input)
          await db!.systemJob.update({
            where: { id: jobId },
            data: { status: 'CANCELLING', cancelRequestedAt: clock.now() }
          })
          return write
        }
        await executePendingReplace(context<PendingReplacePayload>(first), {
          database: port,
          fileSystem: createNodePendingReplaceFileSystem(),
          config: { scanRoot: root }
        })
        await assertCancelled(jobId, 'ROLLED_BACK')
        expect(await fs.readFile(path.join(root, 'artworks/123_p0.jpg'), 'utf8')).toBe('old-content')
        return
      }
      await expire()
      const second = await claim('PENDING_REPLACE')
      const dependencies = {
        database: port,
        fileSystem: createNodePendingReplaceFileSystem(),
        config: { scanRoot: root },
        now: () => clock.now()
      }
      await executePendingReplace(context<PendingReplacePayload>(second), dependencies)
      expect((await db!.systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('PAUSED')
      expect((await db!.pendingReplaceItem.findUniqueOrThrow({ where: { id: itemId } })).status).toBe('COMMITTING')
      await authorize(jobId, `pending-replace:${itemId}`)
      const third = await resumeAndClaim(jobId, 'PENDING_REPLACE')
      await executePendingReplace(context<PendingReplacePayload>(third), dependencies)
      expect((await db!.systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('COMPLETED')
      expect((await db!.pendingReplaceItem.findUniqueOrThrow({ where: { id: itemId } })).status).toBe('SUCCESS')
      expect(await fs.readFile(path.join(root, 'artworks/123_p0.jpg'), 'utf8')).toBe('new-content')
      expect(await fs.readFile(path.join(root, `replace-backups/${batchId}/${itemId}/123_p0.jpg`), 'utf8')).toBe(
        'old-content'
      )
      await assertConsumed(jobId)
    }
  )

  it.each(['offline-recovery', 'cancel'] as const)('settles migration source cleanup through %s', async (mode) => {
    const root = await temporaryRoot()
    const artwork = await db!.artwork.create({ data: { title: prefix, storagePath: 'target' } })
    const image = await db!.image.create({
      data: { artworkId: artwork.id, path: '/target/page.jpg', size: 7n, sortOrder: 0 }
    })
    const payload: MigrationPayload = {
      selection: { mode: 'ARTWORK_IDS', artworkIds: [artwork.id] },
      safety: { transferMode: 'move', verifyAfterCopy: true, cleanupSource: true }
    }
    const jobId = await seedJob('MIGRATION', 'migration', payload)
    await fs.mkdir(path.join(root, 'source'))
    await fs.mkdir(path.join(root, 'target'))
    await fs.writeFile(path.join(root, 'source/page.jpg'), 'content')
    await fs.writeFile(path.join(root, 'target/page.jpg'), 'content')
    const stat = await fs.stat(path.join(root, 'source/page.jpg'))
    const item = await db!.migrationJobItem.create({
      data: {
        systemJobId: jobId,
        artworkIdSnapshot: artwork.id,
        status: 'RUNNING',
        phase: 'CLEANING_SOURCE',
        sourceDirectory: 'source',
        targetDirectory: 'target',
        files: {
          create: {
            ordinal: 0,
            imageId: image.id,
            sourceRelativePath: '/source/page.jpg',
            targetRelativePath: '/target/page.jpg',
            stagedRelativePath: '.migration-staging/fixture/page.jpg',
            status: 'PUBLISHED',
            sourceSize: 7n,
            sourceMtimeMs: BigInt(Math.trunc(stat.mtimeMs)),
            sourceSha256: hash('content'),
            stagedSha256: hash('content')
          }
        }
      }
    })
    const port = createPrismaMigrationDatabase(db!)
    const plan = (await port.loadPlan(jobId, artwork.id, 10))!
    const first = await claim('MIGRATION')
    await port.beginContentWrite({ context: context(first), scanRoot: root, plan })
    if (mode === 'cancel') {
      const begin = port.beginContentWrite
      port.beginContentWrite = async (input) => {
        const write = await begin(input)
        await db!.systemJob.update({
          where: { id: jobId },
          data: { status: 'CANCELLING', cancelRequestedAt: clock.now() }
        })
        return write
      }
      await executeMigration(context<MigrationPayload>(first), {
        database: port,
        fileSystem: createNodeMigrationFileSystem(),
        config: { scanRoot: root }
      })
      await assertCancelled(jobId, 'COMPLETED')
      expect((await db!.migrationJobItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('CANCELLED')
      expect(await fs.readFile(path.join(root, 'target/page.jpg'), 'utf8')).toBe('content')
      return
    }
    await expire()
    const second = await claim('MIGRATION')
    const dependencies = {
      database: port,
      fileSystem: createNodeMigrationFileSystem(),
      config: { scanRoot: root },
      now: () => clock.now()
    }
    await executeMigration(context<MigrationPayload>(second), dependencies)
    expect((await db!.systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('PAUSED')
    expect(await fs.readFile(path.join(root, 'source/page.jpg'), 'utf8')).toBe('content')
    await authorize(jobId, `migration:${item.id}`)
    const third = await resumeAndClaim(jobId, 'MIGRATION')
    await executeMigration(context<MigrationPayload>(third), dependencies)
    expect((await db!.systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('COMPLETED')
    expect((await db!.migrationJobItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('COMPLETED')
    await expect(fs.stat(path.join(root, 'source/page.jpg'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(path.join(root, 'target/page.jpg'), 'utf8')).toBe('content')
    await assertConsumed(jobId)
  })

  it.each([
    'same-path-success',
    'same-path-finish-failure',
    'missing-source',
    'partial-copy-permanent',
    'last-attempt-eio'
  ] as const)('keeps migration claims recoverable at %s', async (fault) => {
    const root = await temporaryRoot()
    const artist = await db!.artist.create({
      data: { name: prefix, externalRefs: { create: { providerKey: 'pixiv', externalId: `${prefix}-artist` } } }
    })
    const targetDirectory = `${prefix}-artist/${prefix}-work`
    const samePath = fault.startsWith('same-path')
    const source = samePath ? `${targetDirectory}/page.jpg` : 'source/page.jpg'
    const target = `${targetDirectory}/page.jpg`
    const artwork = await db!.artwork.create({
      data: {
        title: prefix,
        artistId: artist.id,
        createdVia: 'PIXIV_SCAN',
        externalRefs: {
          create: {
            providerKey: 'pixiv',
            externalId: `${prefix}-work`,
            canonicalUrl: 'https://example.test/recovery',
            locator: {}
          }
        }
      }
    })
    const image = await db!.image.create({
      data: { artworkId: artwork.id, path: `/${source}`, size: 7n, sortOrder: 0 }
    })
    await fs.mkdir(path.dirname(path.join(root, source)), { recursive: true })
    await fs.writeFile(path.join(root, source), 'content')
    const payload: MigrationPayload = {
      selection: { mode: 'ARTWORK_IDS', artworkIds: [artwork.id] },
      safety: { transferMode: 'move', verifyAfterCopy: true, cleanupSource: true }
    }
    const jobId = await seedJob('MIGRATION', `review-${fault}`, payload)
    if (fault === 'last-attempt-eio') await db!.systemJob.update({ where: { id: jobId }, data: { maxAttempts: 1 } })
    const item = await db!.migrationJobItem.create({
      data: {
        systemJobId: jobId,
        artworkIdSnapshot: artwork.id,
        sourceDirectory: path.posix.dirname(source),
        targetDirectory,
        files: {
          create: {
            ordinal: 0,
            imageId: image.id,
            sourceRelativePath: `/${source}`,
            targetRelativePath: `/${target}`,
            stagedRelativePath: '.migration-staging/review/page.jpg'
          }
        }
      }
    })
    const port = createPrismaMigrationDatabase(db!)
    const fileSystem = createNodeMigrationFileSystem()
    const first = await claim('MIGRATION')
    let originalWrite: ExecutorMediaWrite | undefined
    const begin = port.beginContentWrite
    port.beginContentWrite = async (input) => {
      const write = await begin(input)
      originalWrite ??= write
      if (fault === 'missing-source' && input.context.job.attempt === first.attempt)
        await fs.rm(path.join(root, source))
      return write
    }
    const finish = port.finishContentWrite
    if (fault === 'same-path-finish-failure')
      port.finishContentWrite = async () => {
        throw new Error('after SKIPPED DML before finish')
      }
    const copy = fileSystem.copyFileExclusive
    if (fault === 'partial-copy-permanent')
      fileSystem.copyFileExclusive = async (from, to) => {
        await copy(from, to)
        throw new MigrationPermanentError('SOURCE_CHANGED', 'injected after copy')
      }
    if (fault === 'last-attempt-eio')
      fileSystem.copyFileExclusive = async () => {
        throw Object.assign(new Error('injected I/O failure'), { code: 'EIO' })
      }
    const dependencies = { database: port, fileSystem, config: { scanRoot: root } }
    await executeMigration(context<MigrationPayload>(first), dependencies)
    const after = await db!.migrationJobItem.findUniqueOrThrow({ where: { id: item.id }, include: { files: true } })
    if (fault === 'same-path-success') {
      expect(after.status).toBe('SKIPPED')
      expect(
        (await db!.mediaContentPathWrite.findMany({ where: { jobId } })).every((write) => write.status === 'COMPLETED')
      ).toBe(true)
      return
    }
    expect(['FAILED', 'SKIPPED', 'CANCELLED']).not.toContain(after.status)
    expect(after.files.every((file) => !['FAILED', 'COMPLETED'].includes(file.status))).toBe(true)
    if (fault !== 'same-path-finish-failure') {
      expect(after.status).toBe('ACTION_REQUIRED')
      expect((await db!.systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('PAUSED')
    }
    expect(
      (await db!.mediaContentPathWrite.findMany({ where: { jobId } })).every((write) => write.status === 'ACTIVE')
    ).toBe(true)
    if (fault === 'missing-source') await fs.writeFile(path.join(root, source), 'content')
    port.finishContentWrite = finish
    fileSystem.copyFileExclusive = copy
    const grantId = await authorize(jobId, `migration:${item.id}`)
    const resumed = await db!.$transaction((tx) =>
      resumeGrantedMediaContentRecovery(tx, {
        grantId,
        operator: 'fixture',
        confirmAllWritersStopped: true,
        now: clock.now(),
        readDomainSnapshot: readExecutorMediaRecoveryDomainSnapshot
      })
    )
    expect(resumed.status).toBe('READY')
    const next = await claim('MIGRATION')
    await executeMigration(context<MigrationPayload>(next), dependencies)
    expect((await db!.migrationJobItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      samePath ? 'SKIPPED' : 'COMPLETED'
    )
    expect((await db!.systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('COMPLETED')
    expect(await fs.readFile(path.join(root, target), 'utf8')).toBe('content')
    await expect(db!.$transaction((tx) => finish(tx, originalWrite!))).rejects.toThrow()
  })

  it.each(['offline-recovery', 'cancel'] as const)('settles a prior remux backup through %s', async (mode) => {
    const root = await temporaryRoot()
    const artwork = await db!.artwork.create({ data: { title: prefix } })
    const image = await db!.image.create({
      data: { artworkId: artwork.id, path: 'video.mp4', mediaType: 'VIDEO', sortOrder: 0, size: 14n }
    })
    const payload = { imageId: image.id, relativePath: image.path, mode: 'REMUX_FASTSTART' }
    const jobId = await seedJob('VIDEO_STREAMING_OPTIMIZATION', 'video', payload)
    const first = await claim('VIDEO_STREAMING_OPTIMIZATION')
    const ctx = context(first)
    const directory = await resolveExecutorMediaDirectory({ context: ctx, sourceRoot: root, relativeDirectory: '' })
    await beginExecutorMediaWrite({
      context: ctx,
      directory,
      scope: { kind: 'PATH', relativePath: 'video.mp4' },
      sessionId: `video-remux:${jobId}`,
      imageIds: [image.id]
    })
    const backup = getStreamingArtifactPaths(path.join(root, 'video.mp4'), `${jobId}-a1`).backupPath
    await fs.writeFile(backup, 'original-video')
    if (mode === 'offline-recovery') await expire()
    const runner: VideoProcessRunner = async (request) => {
      if (mode === 'cancel') {
        await db!.systemJob.update({
          where: { id: jobId },
          data: { status: 'CANCELLING', cancelRequestedAt: clock.now() }
        })
        throw new Error('cancel during preparation')
      }
      if (request.command === 'ffprobe')
        return {
          stdout: JSON.stringify({
            streams: [{ codec_type: 'video', codec_name: 'h264', width: 1, height: 1 }],
            format: { duration: '10' }
          }),
          stderr: ''
        }
      await fs.copyFile(request.args[request.args.indexOf('-i') + 1]!, request.args.at(-1)!)
      return { stdout: '', stderr: '' }
    }
    const executor = createVideoProcessingExecutorRegistrations({
      database: db!,
      config: { scanRoot: root, chapterPreviewRoot: root, ffmpegThreads: 1 },
      processRunner: runner,
      now: () => clock.now()
    }).find((entry) => entry.jobType === 'VIDEO_STREAMING_OPTIMIZATION')!
    if (mode === 'cancel') {
      await executor.execute(context(first))
      await assertCancelled(jobId, 'ROLLED_BACK')
      expect(await fs.readFile(path.join(root, 'video.mp4'), 'utf8')).toBe('original-video')
      return
    }
    const second = await claim('VIDEO_STREAMING_OPTIMIZATION')
    await executor.execute(context(second))
    expect((await db!.systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('PAUSED')
    expect(await fs.readFile(backup, 'utf8')).toBe('original-video')
    await expect(fs.stat(path.join(root, 'video.mp4'))).rejects.toMatchObject({ code: 'ENOENT' })
    await authorize(jobId, `video-remux:${jobId}`)
    const third = await resumeAndClaim(jobId, 'VIDEO_STREAMING_OPTIMIZATION')
    await executor.execute(context(third))
    expect((await db!.systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('COMPLETED')
    expect(await fs.readFile(path.join(root, 'video.mp4'), 'utf8')).toBe('original-video')
    await assertConsumed(jobId)
  })
})

async function temporaryRoot() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'content-recovery-')))
  roots.push(root)
  return root
}
async function seedJob(type: JobType, label: string, payload: unknown) {
  const id = `${prefix}-${label}`
  await db!.systemJob.create({
    data: {
      id,
      type,
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: 1,
      maxAttempts: 10,
      payload: payload as Prisma.InputJsonValue,
      availableAt: clock.now()
    }
  })
  return id
}
async function claim(type: JobType) {
  const job = await repo!.claim('recovery-fixture', 'BACKGROUND_WRITER', [
    { jobType: type, executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
  ])
  expect(job).not.toBeNull()
  return job!
}
const fence = (job: ClaimedJob) => ({
  jobId: job.id,
  workerId: job.workerId,
  executionToken: job.executionToken,
  attempt: job.attempt
})
function context<T = unknown>(job: ClaimedJob): ExecutionContext<T, EnqueuedChildJob> {
  return {
    job,
    payload: job.payload as T,
    signal: new AbortController().signal,
    progress: (update) => repo!.updateProgress({ ...fence(job), ...update }),
    enqueueChild: async () => {
      throw new Error('not used')
    },
    mutateInTransaction: (operation) => repo!.withFencedMutationTransaction(fence(job), operation),
    finalizeInTransaction: async (operation) => {
      await repo!.withFencedExecutionTransaction(fence(job), operation)
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  }
}
async function expire() {
  clock.advance(61_000)
  await repo!.recoverExpiredExecution('BACKGROUND_WRITER')
  clock.advance(600_000)
}
async function authorize(jobId: string, sessionId: string) {
  const readDomainSnapshot = readExecutorMediaRecoveryDomainSnapshot
  const inspected = await db!.$transaction((tx) =>
    inspectMediaContentRecovery(tx, { jobId, sessionId, now: clock.now(), readDomainSnapshot })
  )
  expect(inspected.status).toBe('READY')
  if (inspected.status !== 'READY') throw new Error(inspected.status)
  const granted = await db!.$transaction((tx) =>
    grantMediaContentRecovery(tx, {
      snapshot: inspected.value.snapshot,
      expectedDigest: inspected.value.digest,
      backupCheckpointRef: 'fixture://same-point-db-and-media',
      operator: 'isolated-test',
      confirmAllWritersStopped: true,
      now: clock.now(),
      readDomainSnapshot
    })
  )
  expect(granted.status).toBe('READY')
  if (granted.status !== 'READY') throw new Error(granted.status)
  return granted.value.grantId
}
async function resumeAndClaim(jobId: string, type: JobType) {
  await db!.systemJob.update({
    where: { id: jobId },
    data: { status: 'PENDING', pauseRequestedAt: null, cancelRequestedAt: null, availableAt: clock.now() }
  })
  return claim(type)
}
async function assertCancelled(jobId: string, status: 'COMPLETED' | 'ROLLED_BACK') {
  expect((await db!.systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('CANCELLED')
  const writes = await db!.mediaContentPathWrite.findMany({ where: { jobId } })
  expect(writes.length).toBeGreaterThan(0)
  expect(writes.every((write) => write.status === status)).toBe(true)
  for (const write of writes) {
    expect(await db!.artworkContentSource.count({ where: { writeToken: write.writeToken } })).toBe(0)
    expect(await db!.mediaContentSource.count({ where: { writeToken: write.writeToken } })).toBe(0)
  }
}
async function assertConsumed(jobId: string) {
  const writes = await db!.mediaContentPathWrite.findMany({ where: { jobId } })
  expect(writes.length).toBeGreaterThan(0)
  expect(writes.every((write) => write.status === 'COMPLETED' && write.executionAttempt === 3)).toBe(true)
  expect(await db!.mediaContentRecoveryGrant.count({ where: { jobId, status: 'CONSUMED' } })).toBe(1)
}
async function cleanup() {
  if (!db) return
  await db.mediaContentRecoveryGrant.deleteMany({ where: { jobId: { startsWith: prefix } } })
  await cleanupFixtureContentDirectories(db, roots)
  await db.pendingReplaceOperation.deleteMany({ where: { systemJobId: { startsWith: prefix } } })
  await db.pendingReplaceBatch.deleteMany({ where: { id: { startsWith: prefix } } })
  await db.jobResourceLease.deleteMany({ where: { ownerJobId: { startsWith: prefix } } })
  await db.systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
  await db.artwork.deleteMany({ where: { title: prefix } })
  await db.artist.deleteMany({ where: { name: prefix } })
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
}
