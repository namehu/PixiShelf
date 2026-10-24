import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import {
  Prisma,
  PrismaClient,
  buildArtworkDedupGroups,
  captureArtworkContentSnapshot,
  editArtworkCreators,
  freezeArtworkDedupRun,
  saveArtworkDedupMediaPage
} from '../../../pixishelf-db/src/index.js'
import { MutableQueueClock } from '../queue-clock.js'
import {
  BACKGROUND_WRITER_LANE_RESOURCE,
  JobExecutionFenceError,
  PostgresQueueRepository,
  type QueueDatabase
} from '../queue-repository.js'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const suite = url ? describe.sequential : describe.skip
const changes = ['source', 'member', 'creator'] as const
type Change = (typeof changes)[number]

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function waitAtBarrier<T>(signal: Promise<T>, operation: Promise<unknown>) {
  return Promise.race([
    signal,
    operation.then(() => {
      throw new Error('Operation finished before the test barrier')
    })
  ])
}
async function backendPid(tx: Prisma.TransactionClient) {
  const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() pid`
  return row!.pid
}
async function expectBlocked(waiter: number, blocker: number) {
  await expect
    .poll(
      async () => {
        const [row] = await db!.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT ${blocker}::integer = ANY(pg_blocking_pids(${waiter}::integer)) blocked
    `
        return row!.blocked
      },
      { timeout: 5_000, interval: 20 }
    )
    .toBe(true)
}
function afterValidation(tx: Prisma.TransactionClient, pause: () => Promise<void>) {
  let statements = 0
  return new Proxy(tx, {
    get(target, key) {
      if (key === '$executeRaw') {
        return async (...args: unknown[]) => {
          const result = await (target.$executeRaw as (...args: unknown[]) => Promise<number>)(...args)
          // The first mutation is the final evidence check. Pause after its SQL
          // snapshot, exactly where a writer could previously invalidate the group.
          if (++statements === 1) await pause()
          return result
        }
      }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    }
  }) as Prisma.TransactionClient
}
async function seed() {
  const prefix = `dedup-publish-${randomUUID()}`
  const clock = new MutableQueueClock(new Date())
  const fence = { jobId: prefix, workerId: prefix, executionToken: randomUUID(), attempt: 1 }
  const fixture = await db!.$transaction(async (tx) => {
    const artist = await tx.artist.create({ data: { name: prefix } })
    const artworks = []
    for (let n = 0; n < 2; n++) {
      const artwork = await tx.artwork.create({
        data: {
          title: prefix,
          creators: {
            create: {
              artistId: artist.id,
              evidence: { create: { evidenceKey: 'manual', provenance: 'MANUAL' } }
            }
          }
        }
      })
      const image = await tx.image.create({ data: { artworkId: artwork.id, path: `${prefix}/${n}.jpg`, size: 3n } })
      artworks.push({ artworkId: artwork.id, imageId: image.id, path: image.path })
    }
    const { run } = await freezeArtworkDedupRun(tx, {
      artistId: artist.id,
      requestedBy: prefix,
      idempotencyKey: prefix,
      mode: 'INCREMENTAL'
    })
    const execution = { runId: run.id, jobId: fence.jobId, executionVersion: 1 }
    await tx.systemJob.create({
      data: {
        id: fence.jobId,
        type: 'ARTWORK_DEDUP_SCAN',
        payload: { runId: run.id, executionVersion: 1 },
        queuePriority: 900,
        effectivePriority: 900
      }
    })
    await tx.artworkDedupRun.update({ where: { id: run.id }, data: { jobId: fence.jobId } })
    await tx.systemJob.update({
      where: { id: fence.jobId },
      data: {
        status: 'RUNNING',
        workerId: fence.workerId,
        leaseToken: fence.executionToken,
        attempt: fence.attempt,
        leaseExpiresAt: new Date(clock.now().getTime() + 60_000)
      }
    })
    // Never replace another test's lease: a busy dedicated database fails setup
    // and rolls back this fixture instead of claiming unrelated work.
    await tx.jobResourceLease.create({
      data: {
        resourceKey: BACKGROUND_WRITER_LANE_RESOURCE,
        ownerJobId: fence.jobId,
        workerId: fence.workerId,
        leaseToken: fence.executionToken,
        expiresAt: new Date(clock.now().getTime() + 60_000),
        heartbeatAt: clock.now()
      }
    })
    for (const artwork of artworks) {
      const captured = await captureArtworkContentSnapshot(tx, { artworkId: artwork.artworkId })
      if (captured.status !== 'READY') throw new Error(captured.status)
      const snapshot = captured.value
      await saveArtworkDedupMediaPage(tx, {
        execution,
        artworkId: artwork.artworkId,
        entries: [
          {
            imageId: artwork.imageId,
            sourcePath: artwork.path,
            sourceRevision: 0n,
            logicalRoot: 'source-media:v1',
            rootIdentity: prefix,
            relativeDirectory: prefix,
            directoryId: prefix,
            directoryGeneration: 0n,
            canonicalPath: artwork.path,
            size: 3n,
            sha256: 'c'.repeat(64)
          }
        ]
      })
      await tx.artworkContentFingerprint.create({
        data: {
          artworkId: artwork.artworkId,
          sourceRevision: snapshot.revision,
          mediaEpoch: snapshot.mediaEpoch,
          algorithmVersion: 1,
          fileCount: 1n,
          membersSignature: 'b'.repeat(64),
          contentSha256: 'a'.repeat(64),
          completedAt: clock.now()
        }
      })
      await tx.artworkDedupItem.update({
        where: { runId_artworkId: { runId: run.id, artworkId: artwork.artworkId } },
        data: {
          status: 'COMPLETE',
          snapshotRevision: snapshot.revision,
          mediaEpoch: snapshot.mediaEpoch,
          memberCount: 1n,
          membersSignature: 'b'.repeat(64),
          contentSha256: 'a'.repeat(64)
        }
      })
    }
    return { artistId: artist.id, execution, artworks }
  })
  const repository = new PostgresQueueRepository(db! as unknown as QueueDatabase, {
    clock,
    transactionTimeoutMs: 20_000
  })
  return { ...fixture, fence, clock, repository, prefix }
}
type Fixture = Awaited<ReturnType<typeof seed>>
async function isolated(body: (fixture: Fixture) => Promise<void>) {
  const fixture = await seed()
  try {
    await body(fixture)
  } finally {
    await db!.artworkDedupRun.delete({ where: { id: fixture.execution.runId } })
    await db!.systemJob.delete({ where: { id: fixture.execution.jobId } })
    await db!.artwork.deleteMany({ where: { id: { in: fixture.artworks.map((row) => row.artworkId) } } })
    await db!.artist.delete({ where: { id: fixture.artistId } })
  }
}
async function change(tx: Prisma.TransactionClient, fixture: Fixture, kind: Change) {
  const artwork = fixture.artworks[0]!
  if (kind === 'source') {
    await tx.image.update({ where: { id: artwork.imageId }, data: { path: `${fixture.prefix}/changed.jpg` } })
  } else if (kind === 'member') {
    await tx.image.delete({ where: { id: artwork.imageId } })
  } else {
    await editArtworkCreators(tx, artwork.artworkId, [fixture.artistId], 'REMOVE')
  }
}
async function expectPublished(fixture: Fixture, expected: { groupCount: number; changedArtworks: number }) {
  expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: fixture.execution.runId } })).toMatchObject({
    status: 'COMPLETED',
    stage: 'DONE',
    ...expected
  })
  expect(await db!.artworkDedupGroupMember.count({ where: { runId: fixture.execution.runId } })).toBe(
    expected.groupCount * 2
  )
  expect(await db!.jobResourceLease.count({ where: { ownerJobId: fixture.fence.jobId } })).toBe(0)
}

suite('artwork dedup final publication lock boundary', () => {
  afterAll(async () => {
    await db?.$disconnect()
  })

  it.each(changes)('holds %s changes until the fenced completion commits', async (kind) =>
    isolated(async (f) => {
      const validated = deferred<number>()
      const releaseCompletion = deferred()
      const writerPid = deferred<number>()
      const operations: Promise<unknown>[] = []
      try {
        const completing = f.repository.withFencedExecutionTransaction<Prisma.TransactionClient>(
          f.fence,
          async (scope) => {
            const pid = await backendPid(scope.transaction)
            await buildArtworkDedupGroups(
              afterValidation(scope.transaction, async () => {
                validated.resolve(pid)
                await releaseCompletion.promise
              }),
              { execution: f.execution }
            )
            await scope.complete()
          }
        )
        operations.push(completing)
        const detectorPid = await waitAtBarrier(validated.promise, completing)
        const writing = db!.$transaction(
          async (tx) => {
            writerPid.resolve(await backendPid(tx))
            await change(tx, f, kind)
            // This read occurs before the writer's commit: completion must already
            // be visible, not merely staged in scope.complete's callback.
            return tx.artworkDedupRun.findUniqueOrThrow({ where: { id: f.execution.runId } })
          },
          { timeout: 20_000 }
        )
        operations.push(writing)
        await expectBlocked(await waitAtBarrier(writerPid.promise, writing), detectorPid)
        expect(await db!.artworkDedupGroup.count({ where: { runId: f.execution.runId } })).toBe(0)
        releaseCompletion.resolve()
        await completing
        expect(await writing).toMatchObject({ status: 'COMPLETED', groupCount: 1, changedArtworks: 0 })
        await expectPublished(f, { groupCount: 1, changedArtworks: 0 })
        if (kind !== 'creator') {
          const source = await db!.artworkContentSource.findUniqueOrThrow({
            where: { artworkId: f.artworks[0]!.artworkId }
          })
          const item = await db!.artworkDedupItem.findUniqueOrThrow({
            where: {
              runId_artworkId: { runId: f.execution.runId, artworkId: f.artworks[0]!.artworkId }
            }
          })
          expect(source.revision).toBeGreaterThan(item.snapshotRevision!)
        }
      } finally {
        releaseCompletion.resolve()
        await Promise.allSettled(operations)
      }
    })
  )

  it.each(changes)('rechecks %s changes that hold the lock before publication', async (kind) =>
    isolated(async (f) => {
      const changed = deferred<number>()
      const releaseWriter = deferred()
      const detectorPid = deferred<number>()
      const operations: Promise<unknown>[] = []
      try {
        const writing = db!.$transaction(
          async (tx) => {
            await change(tx, f, kind)
            changed.resolve(await backendPid(tx))
            await releaseWriter.promise
          },
          { timeout: 20_000 }
        )
        operations.push(writing)
        const writerPid = await waitAtBarrier(changed.promise, writing)
        const completing = f.repository.withFencedExecutionTransaction<Prisma.TransactionClient>(
          f.fence,
          async (scope) => {
            detectorPid.resolve(await backendPid(scope.transaction))
            await buildArtworkDedupGroups(scope.transaction, { execution: f.execution })
            await scope.complete()
          }
        )
        operations.push(completing)
        await expectBlocked(await waitAtBarrier(detectorPid.promise, completing), writerPid)
        releaseWriter.resolve()
        await Promise.all([writing, completing])
        await expectPublished(f, { groupCount: 0, changedArtworks: 1 })
        expect(
          await db!.artworkDedupItem.findUniqueOrThrow({
            where: {
              runId_artworkId: { runId: f.execution.runId, artworkId: f.artworks[0]!.artworkId }
            }
          })
        ).toMatchObject({ status: 'CHANGED', errorCode: 'CONTENT_CHANGED' })
      } finally {
        releaseWriter.resolve()
        await Promise.allSettled(operations)
      }
    })
  )

  it('rolls back all groups if the actual final fence expires after validation', async () =>
    isolated(async (f) => {
      await expect(
        f.repository.withFencedExecutionTransaction<Prisma.TransactionClient>(f.fence, async (scope) => {
          const result = await buildArtworkDedupGroups(scope.transaction, { execution: f.execution })
          expect(result.groupCount).toBe(1)
          await scope.complete()
          f.clock.advance(60_001)
        })
      ).rejects.toBeInstanceOf(JobExecutionFenceError)
      expect(await db!.artworkDedupGroup.count({ where: { runId: f.execution.runId } })).toBe(0)
      expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: f.execution.runId } })).toMatchObject({
        status: 'RUNNING',
        stage: 'STAT',
        groupCount: 0
      })
      await db!.$transaction(async (tx) => {
        await change(tx, f, 'creator')
        await change(tx, f, 'source')
      })
    }))
})
