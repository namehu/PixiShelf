import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Prisma,
  PrismaClient,
  freezeArtworkDedupRun,
  beginMediaContentPathWrite,
  beginMediaContentSourceWrite,
  finishMediaContentSourceWrite
} from '@pixishelf/db'
import {
  MutableQueueClock,
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ClaimedJob,
  type EnqueuedChildJob,
  type ExecutionContext,
  type QueueDatabase,
  type QueueSqlExecutor
} from '@pixishelf/job-runtime'
import type { ArtworkDedupScanPayload } from '@pixishelf/job-contracts'
import { executeArtworkDedup, type ArtworkDedupDependencies } from '../executor.ts'
import { DedupReaderSupervisor } from '../reader.ts'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const suite = url ? describe.sequential : describe.skip
const prefix = `dedup-executor-${randomUUID()}`
const clock = new MutableQueueClock(new Date('2026-10-23T00:00:00Z'))
const capabilities = [
  { jobType: 'ARTWORK_DEDUP_SCAN' as const, executionLane: 'BACKGROUND_WRITER' as const, definitionVersions: [1] }
]
const repository = db
  ? new PostgresQueueRepository(db as unknown as QueueDatabase, { clock, transactionTimeoutMs: 20_000 })
  : null
const workerRequire = createRequire(new URL('../../../../pixishelf-worker/package.json', import.meta.url))
const readerOptions = {
  entrypoint: new URL('../reader-child.ts', import.meta.url).pathname,
  execArgv: ['--import', workerRequire.resolve('tsx')]
}
let root: string
const artists: number[] = []
const artworks: number[] = []
const runs: string[] = []
const jobs: string[] = []
const externalMediaRoots: string[] = []
let roots: string[] = []
function context(
  job: ClaimedJob,
  controller = new AbortController()
): ExecutionContext<ArtworkDedupScanPayload, EnqueuedChildJob> {
  const fence = { jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt }
  return {
    job,
    payload: job.payload as ArtworkDedupScanPayload,
    signal: controller.signal,
    progress: (update) => repository!.updateProgress({ ...fence, ...update }),
    enqueueChild: async () => {
      throw new Error('Unexpected child')
    },
    mutateInTransaction: (operation) => repository!.withFencedMutationTransaction(fence, operation),
    finalizeInTransaction: async (operation) => {
      await repository!.withFencedExecutionTransaction(fence, operation)
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} }
  }
}
function dependencies(extra: Partial<ArtworkDedupDependencies> = {}): ArtworkDedupDependencies {
  return {
    database: db!,
    sourceRoot: root,
    archiveRoot: root,
    readerOptions,
    now: () => clock.now().getTime(),
    ...extra
  }
}
beforeAll(async () => {
  if (db) root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-executor-')))
})
afterAll(async () => {
  if (!db) return
  roots = (
    await db.artworkDedupMedia.findMany({
      where: { runId: { in: runs } },
      distinct: ['rootIdentity'],
      select: { rootIdentity: true }
    })
  ).map((r) => r.rootIdentity)
  await db.artworkDedupRun.deleteMany({ where: { id: { in: runs } } })
  await db.systemJob.deleteMany({ where: { id: { in: jobs } } })
  await db.artwork.deleteMany({ where: { id: { in: artworks } } })
  await db.artist.deleteMany({ where: { id: { in: artists } } })
  await db.mediaContentDirectoryState.deleteMany({ where: { rootIdentity: { in: roots } } })
  await db.$disconnect()
  if (root) await fs.rm(root, { recursive: true, force: true })
  for (const directory of externalMediaRoots) await fs.rm(directory, { recursive: true, force: true })
})

suite('durable detection executor with real isolated media', () => {
  it('filters by reliable multiset sizes, then reuses durable hashes; FULL rereads only candidates', async () => {
    const artistId = await fixture([
      [11, 12, 11],
      [12, 11, 11],
      [11, 12],
      [31, 11, 11]
    ])
    const cold = await start(artistId)
    await finish(cold.jobId)
    const first = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: cold.runId } })
    expect(first).toMatchObject({
      status: 'COMPLETED',
      stage: 'DONE',
      groupCount: 1,
      duplicateArtworks: 1,
      hashedMedia: 6,
      cacheHitMedia: 0,
      readBytes: 68n,
      readerState: 'IDLE',
      readerToken: null
    })
    expect(await db!.artworkDedupGroupMember.count({ where: { runId: cold.runId } })).toBe(2)
    const hot = await start(artistId)
    await finish(hot.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({
      hashedMedia: 0,
      cacheHitMedia: 6,
      readBytes: 0n,
      groupCount: 1,
      statMedia: 17
    })
    const full = await start(artistId, 'FULL')
    await finish(full.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: full.runId } })).toMatchObject({
      hashedMedia: 6,
      cacheHitMedia: 0,
      readBytes: 68n,
      groupCount: 1
    })
  }, 30_000)
  it('persists file cursors at the byte budget, releases the lane for three seconds and preserves attempt', async () => {
    const artistId = await fixture([
      [32, 32, 32],
      [32, 32, 32]
    ])
    const run = await start(artistId)
    const first = await claim(run.jobId)
    await executeArtworkDedup(context(first), dependencies({ sliceBytes: 32n }))
    const job = await db!.systemJob.findUniqueOrThrow({ where: { id: run.jobId } })
    expect(job).toMatchObject({
      status: 'RETRY_WAIT',
      attempt: 0,
      queuePriority: 900,
      effectivePriority: 900,
      availableAt: new Date(clock.now().getTime() + 3000)
    })
    const checkpoint = await db!.artworkDedupItem.findFirstOrThrow({
      where: { runId: run.runId, status: 'HASHING', afterImageId: { gt: 0 } }
    })
    expect(checkpoint.afterImageId).toBeGreaterThan(0)
    expect(await repository!.claim(prefix, capabilities)).toBeNull()
    clock.advance(3000)
    const second = await claim(run.jobId)
    await executeArtworkDedup(context(second), dependencies())
    const completed = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })
    expect(completed).toMatchObject({
      status: 'COMPLETED',
      hashedMedia: 6,
      cacheHitMedia: 0,
      readBytes: 192n,
      groupCount: 1
    })
    expect(await db!.systemJobEvent.count({ where: { jobId: run.jobId } })).toBeLessThan(15)
  }, 20_000)
  it('pause/resume retains the same run and cursor; cancellation preserves committed file caches', async () => {
    const artistId = await fixture([
      [16, 16],
      [16, 16]
    ])
    const run = await start(artistId)
    await executeArtworkDedup(context(await claim(run.jobId)), dependencies({ sliceBytes: 16n }))
    const cached = await db!.mediaContentFingerprint.count({ where: { image: { artworkId: { in: artworks } } } })
    clock.advance(3000)
    const pausedClaim = await claim(run.jobId)
    await db!.systemJob.update({ where: { id: run.jobId }, data: { status: 'PAUSING', pauseRequestedAt: clock.now() } })
    const pauseController = new AbortController()
    pauseController.abort(new Error('Pause requested'))
    await executeArtworkDedup(context(pausedClaim, pauseController), dependencies())
    expect((await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).status).toBe('PAUSED')
    await db!.systemJob.update({
      where: { id: run.jobId },
      data: { status: 'PENDING', pauseRequestedAt: null, availableAt: clock.now() }
    })
    const resumed = await claim(run.jobId)
    await db!.systemJob.update({
      where: { id: run.jobId },
      data: { status: 'CANCELLING', cancelRequestedAt: clock.now() }
    })
    const cancelController = new AbortController()
    cancelController.abort(new Error('Cancel requested'))
    await executeArtworkDedup(context(resumed, cancelController), dependencies())
    expect((await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).status).toBe('CANCELLED')
    expect(await db!.mediaContentFingerprint.count({ where: { image: { artworkId: { in: artworks } } } })).toBe(cached)
    expect(await db!.artworkDedupGroup.count({ where: { runId: run.runId } })).toBe(0)
  }, 20_000)
  it('missing originals stay incomplete and a root outage fails the whole run', async () => {
    const artistId = await fixture([[7], [7], [9]])
    const missing = await db!.image.findFirstOrThrow({
      where: { artwork: { creators: { some: { artistId } } } },
      orderBy: { id: 'asc' }
    })
    await fs.unlink(path.join(root, missing.path))
    const run = await start(artistId)
    await finish(run.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
      status: 'COMPLETED',
      groupCount: 0,
      failedArtworks: 1
    })
    const outage = await start(artistId)
    await executeArtworkDedup(
      context(await claim(outage.jobId)),
      dependencies({ sourceRoot: path.join(root, 'absent-root') })
    )
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: outage.runId } })).toMatchObject({
      status: 'FAILED',
      errorCode: 'ROOT_CHANGED',
      groupCount: 0
    })
  }, 20_000)
  it('resumes a 501-media artwork after the durable stat cursor without restatting its first page', async () => {
    const artistId = await fixture([Array(501).fill(2)])
    const run = await start(artistId)
    const supervisor = new DedupReaderSupervisor(readerOptions)
    const original = supervisor.create.bind(supervisor)
    let inspected = 0
    supervisor.create = () => {
      const reader = original(),
        inspect = reader.inspect.bind(reader)
      reader.inspect = async (input) => {
        const value = await inspect(input)
        inspected++
        return value
      }
      return reader
    }
    const startTime = clock.now().getTime()
    await executeArtworkDedup(
      context(await claim(run.jobId)),
      dependencies({ supervisor, now: () => startTime + (inspected >= 104 ? 10000 : 0) })
    )
    expect(inspected).toBe(104)
    const checkpoint = await db!.artworkDedupItem.findFirstOrThrow({ where: { runId: run.runId } })
    expect(checkpoint).toMatchObject({ status: 'STATTING', memberCount: 501n })
    expect(await db!.artworkDedupMedia.count({ where: { runId: run.runId } })).toBe(104)
    clock.advance(13000)
    await executeArtworkDedup(context(await claim(run.jobId)), dependencies({ supervisor }))
    expect(inspected).toBe(501)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
      status: 'COMPLETED',
      statMedia: 501,
      hashedMedia: 0
    })
  }, 30_000)
  it('keeps 501-media HASH batches complete across a 100-file checkpoint and a hot run', async () => {
    const artistId = await fixture([Array(501).fill(2), Array(501).fill(2)])
    const cold = await start(artistId)
    let reads = 0,
      inspections = 0
    const measured = (measurement: { reads: number; inspections: number }) => {
      reads += measurement.reads
      inspections += measurement.inspections
    }
    await executeArtworkDedup(
      context(await claim(cold.jobId)),
      dependencies({ sliceBytes: 200n, onMeasurement: measured })
    )
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: cold.runId } })).toMatchObject({
      status: 'RETRY_WAIT',
      stage: 'HASH',
      hashedMedia: 100
    })
    const partial = await db!.artworkDedupItem.findFirstOrThrow({
      where: { runId: cold.runId, afterImageId: { gt: 0 } }
    })
    const ordered = await db!.image.findMany({
      where: { artworkId: partial.artworkId },
      orderBy: { id: 'asc' },
      select: { id: true }
    })
    expect(partial.afterImageId).toBe(ordered[99]!.id)
    clock.advance(3000)
    await executeArtworkDedup(context(await claim(cold.jobId)), dependencies({ onMeasurement: measured }))
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: cold.runId } })).toMatchObject({
      status: 'COMPLETED',
      groupCount: 1,
      hashedMedia: 1002,
      cacheHitMedia: 0,
      readBytes: 2004n
    })
    expect({ reads, inspections }).toEqual({ reads: 1002, inspections: 2004 })
    const hot = await start(artistId)
    reads = 0
    inspections = 0
    await executeArtworkDedup(context(await claim(hot.jobId)), dependencies({ onMeasurement: measured }))
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({
      status: 'COMPLETED',
      groupCount: 1,
      hashedMedia: 0,
      cacheHitMedia: 1002,
      readBytes: 0n
    })
    expect({ reads, inspections }).toEqual({ reads: 0, inspections: 2004 })
  }, 60_000)

  it.each(['insert', 'delete', 'source write', 'directory write'] as const)(
    'rejects a hot cache batch when %s starts after file inspection',
    async (change) => {
      const artistId = await fixture([
        [2, 2, 2],
        [2, 2, 2]
      ])
      const cold = await start(artistId)
      await finish(cold.jobId)
      const images = await db!.image.findMany({
        where: { artwork: { creators: { some: { artistId } } } },
        orderBy: { id: 'asc' }
      })
      const changedArtworkId = images[0]!.artworkId!
      const hot = await start(artistId)
      const supervisor = new DedupReaderSupervisor(readerOptions)
      const create = supervisor.create.bind(supervisor)
      let inspections = 0
      let sourceWrite: Awaited<ReturnType<typeof beginMediaContentSourceWrite>> | undefined
      let pathWriteId: string | undefined
      supervisor.create = () => {
        const reader = create(),
          inspect = reader.inspect.bind(reader)
        reader.inspect = async (input) => {
          const result = await inspect(input)
          // Six STAT inspections precede this first hot HASH inspection.
          if (++inspections === 7) {
            if (change === 'insert')
              await db!.image.create({ data: { artworkId: changedArtworkId, path: `${changedArtworkId}/new.bin` } })
            if (change === 'delete') await db!.image.delete({ where: { id: images[2]!.id } })
            if (change === 'source write')
              sourceWrite = await db!.$transaction((tx) =>
                beginMediaContentSourceWrite(tx, {
                  artworkIds: [],
                  imageIds: [images[0]!.id],
                  writeToken: randomUUID(),
                  now: clock.now()
                })
              )
            if (change === 'directory write') {
              const source = await db!.mediaContentSource.findUniqueOrThrow({
                where: { imageId: images[0]!.id },
                include: { directory: true }
              })
              const directory = source.directory!
              const held = await db!.$transaction((tx) =>
                beginMediaContentPathWrite(tx, {
                  directory: {
                    logicalRoot: 'source-media:v1',
                    rootIdentity: directory.rootIdentity,
                    relativeDirectory: directory.relativeDirectory
                  },
                  scope: { kind: 'DIRECTORY' },
                  owner: { ownerUserId: null, sessionId: randomUUID(), sessionVersion: 1n, execution: null },
                  writeToken: randomUUID(),
                  upload: null,
                  parent: null,
                  now: clock.now()
                })
              )
              expect(held.status).toBe('READY')
              if (held.status !== 'READY') throw new Error(held.status)
              pathWriteId = held.value.writeId
            }
          }
          return result
        }
        return reader
      }
      try {
        await executeArtworkDedup(context(await claim(hot.jobId)), dependencies({ supervisor }))
        expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({
          status: 'COMPLETED',
          changedArtworks: 1,
          groupCount: 0,
          hashedMedia: 0,
          cacheHitMedia: 3
        })
        expect(
          await db!.artworkDedupItem.findUniqueOrThrow({
            where: { runId_artworkId: { runId: hot.runId, artworkId: changedArtworkId } }
          })
        ).toMatchObject({ status: 'CHANGED', afterImageId: 0 })
        expect(
          await db!.artworkDedupMedia.count({
            where: { runId: hot.runId, artworkId: changedArtworkId, sha256: { not: null } }
          })
        ).toBe(0)
      } finally {
        if (sourceWrite)
          await db!.$transaction((tx) =>
            finishMediaContentSourceWrite(tx, { token: sourceWrite!, outcome: 'verified-rollback' })
          )
        if (pathWriteId) await db!.mediaContentPathWrite.delete({ where: { id: pathWriteId } })
      }
    },
    20_000
  )
  it('fails a resumed sparse run when its configured root changed before any candidate hashing', async () => {
    const artistId = await fixture([[2, 2, 2, 2, 2]])
    const run = await start(artistId)
    const supervisor = new DedupReaderSupervisor(readerOptions)
    const original = supervisor.create.bind(supervisor)
    let inspected = 0
    supervisor.create = () => {
      const reader = original(),
        inspect = reader.inspect.bind(reader)
      reader.inspect = async (input) => {
        const value = await inspect(input)
        inspected++
        return value
      }
      return reader
    }
    const startTime = clock.now().getTime()
    await executeArtworkDedup(
      context(await claim(run.jobId)),
      dependencies({ supervisor, now: () => startTime + (inspected >= 4 ? 10000 : 0) })
    )
    const moved = root + '-moved'
    await fs.rename(root, moved)
    await fs.mkdir(root)
    try {
      clock.advance(13000)
      await executeArtworkDedup(context(await claim(run.jobId)), dependencies())
      expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
        status: 'FAILED',
        errorCode: 'ROOT_CHANGED',
        hashedMedia: 0,
        groupCount: 0
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
      await fs.rename(moved, root)
    }
  }, 15_000)
  describe('archive root mapping', () => {
    it.each([
      { boundary: 'STAT', from: 'nested', to: 'nested' },
      { boundary: 'HASH', from: 'nested', to: 'nested' },
      { boundary: 'retry', from: 'nested', to: 'nested' },
      { boundary: 'STAT', from: 'nested', to: 'separate' },
      { boundary: 'STAT', from: 'separate', to: 'nested' }
    ] as const)(
      'rejects $from to $to changes at $boundary before reading old paths',
      async ({ boundary, from, to }) => {
        const media = await archiveFixture(from, to)
        const run = await start(media.artistId)
        await mappingCheckpoint(run.jobId, media.before, boundary === 'HASH' ? 'HASH' : 'STAT')
        const before = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })
        expect(before).toMatchObject({ status: 'RETRY_WAIT', stage: boundary === 'HASH' ? 'HASH' : 'STAT' })
        const savedMedia = await db!.artworkDedupMedia.findMany({
          where: { runId: run.runId },
          orderBy: { imageId: 'asc' }
        })
        expect(savedMedia).toHaveLength(2)
        expect(savedMedia.every((m) => m.canonicalPath.startsWith(media.beforePrefix))).toBe(true)
        expect(before.hashedMedia).toBe(boundary === 'HASH' ? 1 : 0)
        let nextJob = run.jobId
        if (boundary === 'retry') nextJob = await retryMappingRun(run)
        clock.advance(13000)
        let reads = -1,
          inspections = -1
        await executeArtworkDedup(
          context(await claim(nextJob)),
          dependencies({
            archiveRoot: media.after,
            onMeasurement: (measurement) => {
              reads = measurement.reads
              inspections = measurement.inspections
            }
          })
        )
        const after = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })
        expect(after).toMatchObject({
          status: 'FAILED',
          errorCode: 'ROOT_CHANGED',
          groupCount: 0,
          rootBindings: before.rootBindings
        })
        expect(after.executionVersion).toBe(boundary === 'retry' ? 2 : 1)
        expect(reads).toBe(0)
        expect(inspections).toBe(0)
        expect(await db!.artworkDedupGroup.count({ where: { runId: run.runId } })).toBe(0)
        expect(
          await db!.artworkDedupMedia.findMany({ where: { runId: run.runId }, orderBy: { imageId: 'asc' } })
        ).toEqual(boundary === 'retry' ? [] : savedMedia)
      },
      20_000
    )

    it('rechecks the prefix at the end of a slice before publishing groups', async () => {
      const media = await archiveFixture('nested', 'nested')
      const run = await start(media.artistId)
      const supervisor = new DedupReaderSupervisor(readerOptions)
      const create = supervisor.create.bind(supervisor)
      const configured = dependencies({ archiveRoot: media.before, supervisor })
      supervisor.create = () => {
        const reader = create(),
          read = reader.read.bind(reader)
        reader.read = async (input) => {
          const result = await read(input)
          configured.archiveRoot = media.after
          return result
        }
        return reader
      }
      await executeArtworkDedup(context(await claim(run.jobId)), configured)
      expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
        status: 'FAILED',
        errorCode: 'ROOT_CHANGED',
        groupCount: 0,
        rootBindings: { version: 1, archiveRelativePrefix: media.beforePrefix }
      })
      expect(await db!.artworkDedupGroup.count({ where: { runId: run.runId } })).toBe(0)
    }, 15_000)

    it('continues unchanged nested prefixes through STAT and HASH checkpoints', async () => {
      const media = await archiveFixture('nested', 'nested')
      const run = await start(media.artistId)
      await mappingCheckpoint(run.jobId, media.before, 'STAT')
      const saved = (await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).rootBindings
      expect(saved).toMatchObject({ version: 1, archiveRelativePrefix: media.beforePrefix })
      clock.advance(13000)
      await mappingCheckpoint(run.jobId, media.before, 'HASH')
      expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
        status: 'RETRY_WAIT',
        stage: 'HASH',
        hashedMedia: 1,
        rootBindings: saved
      })
      clock.advance(3000)
      await executeArtworkDedup(context(await claim(run.jobId)), dependencies({ archiveRoot: media.before }))
      expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
        status: 'COMPLETED',
        groupCount: 1,
        hashedMedia: 2,
        rootBindings: saved
      })
    }, 20_000)

    it.each(['legacy nested', 'legacy empty', 'missing prefix', 'null with progress'] as const)(
      'refuses %s bindings without silently authorizing the current mapping',
      async (kind) => {
        const media = await archiveFixture(kind === 'legacy empty' ? 'same' : 'nested', 'nested')
        const run = await start(media.artistId)
        await mappingCheckpoint(run.jobId, media.before, 'STAT')
        const before = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })
        const bindings = before.rootBindings as Prisma.JsonObject
        const legacy =
          kind === 'null with progress'
            ? null
            : {
                source: bindings.source!,
                archive: bindings.archive!,
                ...(kind === 'missing prefix' ? { version: 1 } : {})
              }
        await db!.artworkDedupRun.update({ where: { id: run.runId }, data: { rootBindings: legacy ?? Prisma.DbNull } })
        clock.advance(13000)
        await executeArtworkDedup(context(await claim(run.jobId)), dependencies({ archiveRoot: media.before }))
        expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
          status: 'FAILED',
          errorCode: 'ROOT_CHANGED',
          groupCount: 0,
          hashedMedia: 0,
          rootBindings: legacy
        })
        expect(await db!.artworkDedupGroup.count({ where: { runId: run.runId } })).toBe(0)
      },
      20_000
    )
  })
  it('rolls back a cache batch when its PostgreSQL connection dies and never publishes an old result', async () => {
    const artistId = await fixture([[13], [13]])
    const run = await start(artistId)
    const job = await claim(run.jobId)
    const execution = context(job)
    const mutate = execution.mutateInTransaction
    let killNextCommit = false
    const supervisor = new DedupReaderSupervisor(readerOptions)
    const original = supervisor.create.bind(supervisor)
    supervisor.create = () => {
      const reader = original(),
        read = reader.read.bind(reader)
      reader.read = async (input) => {
        const value = await read(input)
        killNextCommit = true
        return value
      }
      return reader
    }
    execution.mutateInTransaction = <TTransaction extends QueueSqlExecutor, TResult>(
      operation: (tx: TTransaction) => Promise<TResult>
    ) =>
      mutate<TTransaction, TResult>(async (tx) => {
        const value = await operation(tx)
        if (killNextCommit) {
          killNextCommit = false
          await tx.$queryRawUnsafe('SELECT pg_terminate_backend(pg_backend_pid())')
        }
        return value
      })
    await executeArtworkDedup(execution, dependencies({ supervisor }))
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
      status: 'FAILED',
      readerToken: null,
      groupCount: 0,
      hashedMedia: 0
    })
    expect(await db!.artworkDedupMedia.count({ where: { runId: run.runId, sha256: { not: null } } })).toBe(0)
  }, 20_000)
  it('recovers the same checkpoint after a real Worker SIGKILL leaves a durable reader latch', async () => {
    const artistId = await fixture([
      [17, 17],
      [17, 17]
    ])
    const run = await start(artistId)
    await executeArtworkDedup(context(await claim(run.jobId)), dependencies({ sliceBytes: 17n }))
    expect((await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).hashedMedia).toBe(1)
    clock.advance(3000)
    const child = spawn(
      process.execPath,
      [...readerOptions.execArgv, new URL('./crash-executor-fixture.ts', import.meta.url).pathname],
      {
        cwd: process.cwd(),
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        serialization: 'advanced',
        env: {
          ...process.env,
          QUEUE_KERNEL_TEST_DATABASE_URL: url!,
          DEDUP_TEST_CLOCK: clock.now().toISOString(),
          DEDUP_TEST_ROOT: root,
          DEDUP_TEST_JOB_ID: run.jobId
        }
      }
    )
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-3000)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Crash fixture did not reach its file boundary: ' + stderr)),
          10000
        )
        child.once('message', () => {
          clearTimeout(timeout)
          resolve()
        })
        child.once('error', reject)
        child.once('exit', () => {
          clearTimeout(timeout)
          reject(new Error('Crash fixture exited early: ' + stderr))
        })
      })
      const crashed = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })
      expect(crashed.readerToken).not.toBeNull()
      expect(crashed.readerOwner).not.toBeNull()
      const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
      child.kill('SIGKILL')
      await closed
      clock.advance(61000)
      await repository!.recoverExpiredExecution()
      await executeArtworkDedup(context(await claim(run.jobId)), dependencies())
      expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
        status: 'COMPLETED',
        hashedMedia: 4,
        readBytes: 68n,
        readerToken: null,
        groupCount: 1
      })
    } finally {
      child.kill('SIGKILL')
    }
  }, 20_000)
  it('rejects a stale execution after reading and clears only its proven closed reader token', async () => {
    const artistId = await fixture([[8], [8]])
    const run = await start(artistId)
    const job = await claim(run.jobId)
    const supervisor = new DedupReaderSupervisor(readerOptions)
    const original = supervisor.create.bind(supervisor)
    supervisor.create = () => {
      const reader = original(),
        read = reader.read.bind(reader)
      reader.read = async (input) => {
        const value = await read(input)
        await db!.systemJob.update({ where: { id: job.id }, data: { leaseToken: randomUUID() } })
        return value
      }
      return reader
    }
    await expect(executeArtworkDedup(context(job), dependencies({ supervisor }))).rejects.toThrow()
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
      readerToken: null,
      groupCount: 0,
      hashedMedia: 0
    })
    expect(
      await db!.mediaContentFingerprint.count({
        where: {
          image: {
            artworkId: {
              in: (
                await db!.artworkDedupItem.findMany({ where: { runId: run.runId }, select: { artworkId: true } })
              ).map((i) => i.artworkId)
            }
          }
        }
      })
    ).toBe(0)
    await db!.systemJob.update({ where: { id: job.id }, data: { leaseToken: job.leaseToken } })
    await repository!.fail({
      jobId: job.id,
      workerId: job.workerId,
      executionToken: job.executionToken,
      attempt: job.attempt,
      errorCode: 'INTERNAL_ERROR',
      error: 'Fixture complete'
    })
  }, 20_000)
})
async function fixture(
  works: number[][],
  options: { source?: 'LOCAL_IMPORT' | 'URL_ARCHIVE'; mediaRoot?: string } = {}
) {
  const artist = await db!.artist.create({ data: { name: `${prefix}-${artists.length}` } })
  artists.push(artist.id)
  for (const sizes of works) {
    const artwork = await db!.artwork.create({
      data: {
        title: `${prefix}-${artworks.length}`,
        source: options.source ?? 'LOCAL_IMPORT',
        creators: {
          create: {
            artistId: artist.id,
            evidence: { create: { provenance: 'MANUAL', evidenceKey: `${prefix}-${artworks.length}`, present: true } }
          }
        }
      }
    })
    artworks.push(artwork.id)
    await fs.mkdir(path.join(options.mediaRoot ?? root, String(artwork.id)))
    for (let i = 0; i < sizes.length; i++) {
      const relative = `${artwork.id}/${i}.bin`
      await fs.writeFile(path.join(options.mediaRoot ?? root, relative), Buffer.alloc(sizes[i]!, sizes[i]))
      await db!.image.create({ data: { artworkId: artwork.id, path: relative, sortOrder: i } })
    }
  }
  return artist.id
}
async function start(artistId: number, mode: 'INCREMENTAL' | 'FULL' = 'INCREMENTAL') {
  const value = await db!.$transaction(async (tx) => {
    const { run } = await freezeArtworkDedupRun(tx, {
      artistId,
      requestedBy: prefix,
      idempotencyKey: randomUUID(),
      mode
    })
    const job = await tx.systemJob.create({
      data: {
        id: `${prefix}-${jobs.length}`,
        type: 'ARTWORK_DEDUP_SCAN',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: 1,
        status: 'PENDING',
        triggerSource: 'SYSTEM',
        queuePriority: 900,
        effectivePriority: 900,
        availableAt: clock.now(),
        maxAttempts: 3,
        payload: { runId: run.id, executionVersion: 1 }
      }
    })
    await tx.artworkDedupRun.update({ where: { id: run.id }, data: { jobId: job.id } })
    return { runId: run.id, jobId: job.id }
  })
  runs.push(value.runId)
  jobs.push(value.jobId)
  return value
}
async function claim(id: string) {
  const job = await repository!.claim(prefix, capabilities)
  expect(job?.id).toBe(id)
  return job!
}
async function finish(id: string) {
  await executeArtworkDedup(context(await claim(id)), dependencies())
  expect((await db!.systemJob.findUniqueOrThrow({ where: { id } })).status).toBe('COMPLETED')
}

async function archiveFixture(from: 'nested' | 'separate' | 'same', to: 'nested' | 'separate') {
  const location = async (kind: 'nested' | 'separate' | 'same') => {
    if (kind === 'same') return root
    if (kind === 'nested') {
      const directory = path.join(root, `archive-${randomUUID()}`)
      await fs.mkdir(directory)
      return directory
    }
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-executor-archive-')))
    externalMediaRoots.push(directory)
    return directory
  }
  const before = await location(from),
    after = await location(to)
  const artistId = await fixture([[32], [32]], { source: 'URL_ARCHIVE', mediaRoot: before })
  const images = await db!.image.findMany({
    where: { artwork: { creators: { some: { artistId } } } },
    orderBy: { id: 'asc' }
  })
  for (const [index, image] of images.entries()) {
    await fs.mkdir(path.dirname(path.join(after, image.path)), { recursive: true })
    await fs.writeFile(path.join(after, image.path), Buffer.alloc(32, index + 1))
  }
  expect(await fs.readFile(path.join(before, images[0]!.path))).toEqual(
    await fs.readFile(path.join(before, images[1]!.path))
  )
  expect(await fs.readFile(path.join(after, images[0]!.path))).not.toEqual(
    await fs.readFile(path.join(after, images[1]!.path))
  )
  return { artistId, before, after, beforePrefix: from === 'nested' ? path.basename(before) : '' }
}
async function mappingCheckpoint(jobId: string, archiveRoot: string, boundary: 'STAT' | 'HASH') {
  if (boundary === 'HASH') {
    await executeArtworkDedup(context(await claim(jobId)), dependencies({ archiveRoot, sliceBytes: 32n }))
    return
  }
  const supervisor = new DedupReaderSupervisor(readerOptions)
  const create = supervisor.create.bind(supervisor)
  let inspections = 0
  supervisor.create = () => {
    const reader = create(),
      inspect = reader.inspect.bind(reader)
    reader.inspect = async (input) => {
      const result = await inspect(input)
      inspections++
      return result
    }
    return reader
  }
  const started = clock.now().getTime()
  await executeArtworkDedup(
    context(await claim(jobId)),
    dependencies({ archiveRoot, supervisor, now: () => started + (inspections >= 2 ? 10000 : 0) })
  )
}
// Recreate the retry transition's durable state; App command/idempotency behavior has separate service coverage.
async function retryMappingRun(run: { runId: string; jobId: string }) {
  const jobId = `${prefix}-${jobs.length}`
  await db!.$transaction(async (tx) => {
    await tx.systemJob.update({ where: { id: run.jobId }, data: { status: 'FAILED' } })
    await tx.artworkDedupMedia.deleteMany({ where: { runId: run.runId } })
    await tx.artworkDedupItem.updateMany({
      where: { runId: run.runId },
      data: {
        status: 'PENDING',
        snapshotRevision: null,
        mediaEpoch: null,
        memberCount: null,
        afterImageId: 0,
        sizeDigest: null,
        contentSha256: null,
        membersSignature: null,
        errorCode: null
      }
    })
    const retried = await tx.artworkDedupRun.update({
      where: { id: run.runId },
      data: {
        executionVersion: { increment: 1 },
        version: { increment: 1 },
        stage: 'STAT',
        finishedAt: null,
        errorCode: null,
        processedArtworks: 0,
        completeArtworks: 0,
        changedArtworks: 0,
        failedArtworks: 0,
        skippedArtworks: 0,
        groupCount: 0,
        duplicateArtworks: 0
      }
    })
    await tx.systemJob.create({
      data: {
        id: jobId,
        type: 'ARTWORK_DEDUP_SCAN',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: 1,
        status: 'PENDING',
        triggerSource: 'SYSTEM',
        queuePriority: 900,
        effectivePriority: 900,
        availableAt: clock.now(),
        maxAttempts: 3,
        payload: { runId: run.runId, executionVersion: retried.executionVersion }
      }
    })
    await tx.artworkDedupRun.update({ where: { id: run.runId }, data: { jobId, status: 'PENDING' } })
  })
  jobs.push(jobId)
  return jobId
}
