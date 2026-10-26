import { randomUUID } from 'node:crypto'
import { PrismaClient, type Prisma } from '@pixishelf/db'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  controlArtworkDedup,
  getArtworkDedupRun,
  listArtworkDedupGroups,
  startArtworkDedup
} from '../artwork-dedup-service'
import {
  cancelJobCommand,
  changeJobPriorityCommand,
  enqueueJob,
  pauseJobCommand,
  resumeJobCommand,
  retryJobCommand
} from '../background-task/job-command-service'
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const actor = `dedup-api-${randomUUID()}`
const artists: number[] = []
async function fixture() {
  const artist = await db!.artist.create({ data: { name: actor } })
  artists.push(artist.id)
  const a = await db!.artwork.create({
    data: {
      title: actor,
      creators: {
        create: { artistId: artist.id, evidence: { create: { evidenceKey: 'manual', provenance: 'MANUAL' } } }
      }
    }
  })
  return {
    artist,
    artwork: a,
    input: { artistId: artist.id, expectedUserId: actor, idempotencyKey: randomUUID(), mode: 'INCREMENTAL' as const }
  }
}
describe.skipIf(!db)('artwork detection API PostgreSQL', () => {
  beforeAll(async () => { await db!.workerInstance.create({ data: { workerId: actor, status: 'READY', heartbeatAt: new Date(), hostname: 'fixture', processId: process.pid, serviceVersion: 'fixture', capabilities: [{ jobType: 'ARTWORK_DEDUP_SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [4] }] } }) })
  afterEach(async () => {
    const runs = await db!.artworkDedupRun.findMany({
      where: { requestedBy: actor },
      select: { id: true, jobId: true }
    })
    const jobs = await db!.systemJob.findMany({ where: { requestedByUserId: actor }, select: { id: true } })
    await db!.artworkDedupRun.deleteMany({ where: { id: { in: runs.map((r) => r.id) } } })
    await db!.systemJob.deleteMany({ where: { id: { in: jobs.map((j) => j.id) } } })
    await db!.artwork.deleteMany({ where: { title: actor } })
    await db!.artist.deleteMany({ where: { id: { in: artists.splice(0) } } })
  })
  afterAll(async () => {
    if (db) await db.workerInstance.delete({ where: { workerId: actor } })
    await db?.$disconnect()
  })
  it('requires upgraded scan capability, preserves replay and marks legacy results exact-only', async () => {
    const f = await fixture()
    await db!.workerInstance.update({ where: { workerId: actor }, data: { capabilities: [{ jobType: 'ARTWORK_DEDUP_SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }] } })
    await expect(startArtworkDedup(actor, f.input, db!)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    expect(await db!.artworkDedupRun.count({ where: { artistId: f.artist.id } })).toBe(0)
    await db!.workerInstance.update({ where: { workerId: actor }, data: { capabilities: [{ jobType: 'ARTWORK_DEDUP_SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1, 2, 3, 4] }] } })
    const run = await startArtworkDedup(actor, f.input, db!)
    expect(run.includesContainment).toBe(true)
    expect(run.includesPartial).toBe(true)
    expect(await db!.systemJob.findUnique({ where: { id: run.jobId! } })).toMatchObject({ definitionVersion: 4 })
    await db!.systemJob.update({ where: { id: run.jobId! }, data: { definitionVersion: 3 } })
    expect(await getArtworkDedupRun(actor, { runId: run.runId, expectedUserId: actor }, db!)).toMatchObject({ includesContainment: true, includesPartial: false })
    await db!.systemJob.update({ where: { id: run.jobId! }, data: { definitionVersion: 1 } })
    expect((await getArtworkDedupRun(actor, { runId: run.runId, expectedUserId: actor }, db!))?.includesContainment).toBe(false)
  })
  it('concurrent same-key start replays one stable run; different keys retain one active artist', async () => {
    const f = await fixture()
    const [a, b] = await Promise.all([startArtworkDedup(actor, f.input, db!), startArtworkDedup(actor, f.input, db!)])
    expect(a.runId).toBe(b.runId)
    await expect(startArtworkDedup(actor, { ...f.input, idempotencyKey: randomUUID() }, db!)).rejects.toMatchObject({
      code: 'CONFLICT'
    })
    await expect(startArtworkDedup(actor, { ...f.input, mode: 'FULL' }, db!)).rejects.toMatchObject({
      code: 'CONFLICT'
    })
    expect(await db!.systemJob.count({ where: { requestedByUserId: actor } })).toBe(1)
    expect(await db!.artworkDedupItem.count({ where: { runId: a.runId } })).toBe(1)
  })
  it('CAS controls are idempotent, paused runs hold active eligibility and instance facts are shared', async () => {
    const f = await fixture()
    const run = await startArtworkDedup(actor, f.input, db!)
    const request = {
      runId: run.runId,
      expectedUserId: actor,
      expectedVersion: run.version,
      idempotencyKey: randomUUID(),
      action: 'pause' as const
    }
    const paused = await controlArtworkDedup(actor, request, db!)
    expect(paused.status).toBe('PAUSED')
    expect(paused.version).toBeGreaterThan(run.version)
    expect((await controlArtworkDedup(actor, request, db!)).version).toBe(paused.version)
    await expect(controlArtworkDedup(actor, { ...request, idempotencyKey: randomUUID() }, db!)).rejects.toMatchObject({
      code: 'CONFLICT'
    })
    await expect(startArtworkDedup(actor, { ...f.input, idempotencyKey: randomUUID() }, db!)).rejects.toMatchObject({
      code: 'CONFLICT'
    })
    expect(
      (await getArtworkDedupRun('another-admin', { artistId: f.artist.id, expectedUserId: 'another-admin' }, db!))
        ?.runId
    ).toBe(run.runId)
    const resumed = await controlArtworkDedup(
      'another-admin',
      {
        runId: run.runId,
        expectedUserId: 'another-admin',
        expectedVersion: paused.version,
        idempotencyKey: randomUUID(),
        action: 'resume'
      },
      db!
    )
    expect(resumed.status).toBe('PENDING')
    expect(
      await db!.systemJob.findUnique({
        where: { id: run.jobId! },
        select: { triggerSource: true, queuePriority: true, effectivePriority: true }
      })
    ).toEqual({ triggerSource: 'SYSTEM', queuePriority: 900, effectivePriority: 900 })
  })
  it('retry retains frozen IDs and stable runId while rejecting changed input or another active run', async () => {
    const f = await fixture()
    const run = await startArtworkDedup(actor, f.input, db!)
    const cancelled = await controlArtworkDedup(
      actor,
      {
        runId: run.runId,
        expectedUserId: actor,
        expectedVersion: run.version,
        idempotencyKey: randomUUID(),
        action: 'cancel'
      },
      db!
    )
    await db!.artworkDedupRun.update({ where: { id: run.runId }, data: { partialAfterArtworkId: f.artwork.id, partialAfterCandidateId: f.artwork.id, relationCacheVersion: 'cached-version', visualCandidatePairs: ['1:2'], originalReusedPairs: 7, originalComparedPairs: 3, visualReusedComparisons: 5, visualComparedComparisons: 2 } })
    await db!.artworkDedupItem.updateMany({ where: { runId: run.runId }, data: { visualSignature: 'cached-visual-signature' } })
    await db!.artwork.create({
      data: {
        title: actor,
        creators: {
          create: { artistId: f.artist.id, evidence: { create: { evidenceKey: 'manual', provenance: 'MANUAL' } } }
        }
      }
    })
    const retried = await controlArtworkDedup(
      actor,
      {
        runId: run.runId,
        expectedUserId: actor,
        expectedVersion: cancelled.version,
        idempotencyKey: randomUUID(),
        action: 'retry'
      },
      db!
    )
    expect(retried.runId).toBe(run.runId)
    expect(retried.executionVersion).toBe(2)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({ relationCacheVersion: null, visualCandidatePairs: [], originalReusedPairs: 0, originalComparedPairs: 0, visualReusedComparisons: 0, visualComparedComparisons: 0 })
    expect(await db!.artworkDedupItem.findMany({ where: { runId: run.runId } })).toEqual([expect.objectContaining({ visualSignature: null })])
    expect(await db!.artworkDedupRun.findUnique({ where: { id: run.runId } })).toMatchObject({ partialAfterArtworkId: 0, partialAfterCandidateId: 0 })
    expect(retried.jobId).not.toBe(run.jobId)
    expect(await db!.artworkDedupItem.count({ where: { runId: run.runId } })).toBe(1)
    expect(await listArtworkDedupGroups(actor, { runId: run.runId, expectedUserId: actor, limit: 20 }, db!)).toEqual({
      items: [],
      nextCursor: null
    })
  })
  it.each([['MATCH', 'CANCELLED'], ['VISUAL', 'FAILED']] as const)('rebuilds partial evidence from the start after %s / %s', async (stage, status) => {
    const f = await fixture()
    const second = await db!.artwork.create({ data: { title: actor, creators: { create: { artistId: f.artist.id, evidence: { create: { evidenceKey: 'manual', provenance: 'MANUAL' } } } } } })
    const run = await startArtworkDedup(actor, { ...f.input, includeSuspectedVersions: true }, db!)
    const pairId = `retry-partial-${randomUUID()}`
    const [leftArtworkId, rightArtworkId] = [f.artwork.id, second.id].sort((a, b) => a - b)
    await db!.$transaction(async (tx) => {
      await tx.systemJob.update({ where: { id: run.jobId! }, data: { status } })
      await tx.artworkDedupRun.update({ where: { id: run.runId }, data: { status, stage, partialAfterArtworkId: leftArtworkId, partialAfterCandidateId: rightArtworkId } })
      const image = await tx.image.create({ data: { artworkId: leftArtworkId, path: `${actor}/retry.png` } })
      await tx.artworkDedupVisualPair.create({ data: { id: pairId, runId: run.runId, relationKind: 'PARTIAL', leftArtworkId, rightArtworkId, summary: { evidenceVersion: 'sha256-multiset-overlap-v1', leftArtworkId, rightArtworkId, leftFileCount: '5', rightFileCount: '5', pairedCount: '4', exactCount: '4', similarCount: '0', leftUnmatchedCount: '1', rightUnmatchedCount: '1', leftUncheckedCount: '0', rightUncheckedCount: '0' }, pages: { create: { ordinal: 1, kind: 'UNMATCHED', leftImageId: image.id, leftIndex: 0 } } } })
    })
    const persisted = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })
    const retried = await controlArtworkDedup(actor, { runId: run.runId, expectedUserId: actor, expectedVersion: persisted.version, idempotencyKey: randomUUID(), action: 'retry' }, db!)
    expect(retried).toMatchObject({ stage: 'STAT', includesPartial: true, executionVersion: 2 })
    expect(await db!.artworkDedupRun.findUnique({ where: { id: run.runId } })).toMatchObject({ partialAfterArtworkId: 0, partialAfterCandidateId: 0 })
    expect(await db!.artworkDedupVisualPair.count({ where: { runId: run.runId } })).toBe(0)
    expect(await db!.artworkDedupVisualPage.count({ where: { pairId } })).toBe(0)
    expect(await db!.artworkDedupItem.count({ where: { runId: run.runId } })).toBe(2)
  })
  it('rejects every generic control and SQL priority promotion without side effects', async () => {
    const f = await fixture()
    const run = await startArtworkDedup(actor, f.input, db!)
    for (const action of [pauseJobCommand, cancelJobCommand, resumeJobCommand, retryJobCommand]) {
      await expect(action({ jobId: run.jobId! }, db!)).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
    }
    await expect(changeJobPriorityCommand({ jobId: run.jobId!, priority: 100 }, db!)).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION'
    })
    await expect(
      enqueueJob(
        {
          type: 'ARTWORK_DEDUP_SCAN',
          triggerSource: 'SYSTEM',
          priority: 900,
          payload: { runId: run.runId, executionVersion: 1 }
        },
        db!
      )
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
    await expect(
      db!.systemJob.update({ where: { id: run.jobId! }, data: { effectivePriority: 899 } })
    ).rejects.toThrow()
    expect((await getArtworkDedupRun(actor, { runId: run.runId, expectedUserId: actor }, db!))?.status).toBe('PENDING')
  })
  it('account mismatch and failed transaction leave no detection or queue rows', async () => {
    const f = await fixture()
    await expect(startArtworkDedup('other', f.input, db!)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const abort = new Error('forced database abort')
    const broken = {
      $transaction: <T>(body: (tx: Prisma.TransactionClient) => Promise<T>) =>
        db!.$transaction(async (tx) => {
          await body(tx)
          throw abort
        })
    }
    await expect(startArtworkDedup(actor, f.input, broken as never)).rejects.toBe(abort)
    expect(await db!.artworkDedupRun.count({ where: { requestedBy: actor } })).toBe(0)
    expect(await db!.systemJob.count({ where: { requestedByUserId: actor } })).toBe(0)
  })
})
