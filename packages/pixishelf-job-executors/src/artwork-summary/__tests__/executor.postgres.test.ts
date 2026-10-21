import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@pixishelf/db'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { MutableQueueClock, PostgresQueueRepository, TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ClaimedJob, type EnqueuedChildJob, type ExecutionContext, type QueueDatabase } from '@pixishelf/job-runtime'
import type { ArtworkSummaryPayload } from '@pixishelf/job-contracts'
import { executeArtworkSummary } from '../executor.ts'
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const suite = url ? describe : describe.skip
const prefix = `summary-test-${randomUUID()}`
const clock = new MutableQueueClock(new Date('2026-10-21T00:00:00Z'))
const capabilities = [{ jobType: 'ARTWORK_SUMMARY_GENERATE' as const, executionLane: 'BACKGROUND_WRITER' as const, definitionVersions: [1] }]
const feature = { hash: '0000000000000000', colors: Array(192).fill(100), aspect: 1 }
function context(repository: PostgresQueueRepository, job: ClaimedJob): ExecutionContext<ArtworkSummaryPayload, EnqueuedChildJob> {
  const fence = { jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt }
  return { job, payload: job.payload as ArtworkSummaryPayload, signal: new AbortController().signal,
    progress: (update) => repository.updateProgress({ ...fence, ...update }),
    enqueueChild: async () => { throw Error('unexpected child job') },
    mutateInTransaction: (operation) => repository.withFencedMutationTransaction(fence, operation),
    finalizeInTransaction: async (operation) => { await repository.withFencedExecutionTransaction(fence, operation); return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME },
    logger: { debug() {}, info() {}, warn() {}, error() {} } }
}
afterAll(async () => {
  if (!db) return
  await db.artwork.deleteMany({ where: { title: { startsWith: prefix } } })
  await db.systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
  await db.$disconnect()
})
suite('durable artwork summary', () => {
  it('checkpoints ten images, yields five seconds and atomically publishes only the final snapshot', async () => {
    const artwork = await db!.artwork.create({ data: { title: prefix } })
    await db!.image.createMany({ data: Array.from({ length: 12 }, (_, i) => ({ artworkId: artwork.id, path: `${prefix}/${i}.jpg`, sortOrder: i, mediaType: 'IMAGE' })) })
    const generationId = randomUUID(), jobId = `${prefix}-job`
    await db!.artworkSummary.create({ data: { artworkId: artwork.id, generationId, jobId } })
    await db!.systemJob.create({ data: { id: jobId, type: 'ARTWORK_SUMMARY_GENERATE', executionLane: 'BACKGROUND_WRITER', definitionVersion: 1,
      status: 'PENDING', triggerSource: 'MANUAL', queuePriority: 90, effectivePriority: 90, availableAt: clock.now(), maxAttempts: 3,
      payload: { artworkId: artwork.id, generationId, sourceRevision: 0 } } })
    const repository = new PostgresQueueRepository(db! as unknown as QueueDatabase, { clock })
    const claim = () => repository.claim(prefix, capabilities)
    const probe = { analyze: vi.fn(async () => ({ sourceKey: 'key', feature, failureCode: null })) }
    const first = await claim()
    expect(first?.id).toBe(jobId)
    await executeArtworkSummary(context(repository, first!), { database: db!, scanRoot: '/unused', probe, now: () => clock.now().getTime() })
    expect(probe.analyze).toHaveBeenCalledTimes(10)
    expect((await db!.artworkSummary.findUniqueOrThrow({ where: { artworkId: artwork.id } })).publishedRevision).toBeNull()
    expect(await claim()).toBeNull()
    clock.advance(5_000)
    const second = await claim()
    expect(second?.id).toBe(jobId)
    await executeArtworkSummary(context(repository, second!), { database: db!, scanRoot: '/unused', probe, now: () => clock.now().getTime() })
    expect(probe.analyze).toHaveBeenCalledTimes(12)
    const published = await db!.artworkSummary.findUniqueOrThrow({ where: { artworkId: artwork.id } })
    expect(published.publishedRevision).toBe(0)
    expect(published.groups).toHaveLength(1)
    expect((await db!.systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('COMPLETED')
  })
  it('pauses instead of publishing when the final image leaves an unkillable process', async () => {
    const artwork = await db!.artwork.create({ data: { title: `${prefix}-timeout` } })
    await db!.image.create({ data: { artworkId: artwork.id, path: `${prefix}/timeout.jpg`, mediaType: 'IMAGE' } })
    const generationId = randomUUID(), jobId = `${prefix}-timeout`
    await db!.artworkSummary.create({ data: { artworkId: artwork.id, generationId, jobId } })
    await db!.systemJob.create({ data: { id: jobId, type: 'ARTWORK_SUMMARY_GENERATE', executionLane: 'BACKGROUND_WRITER', definitionVersion: 1,
      status: 'PENDING', triggerSource: 'MANUAL', queuePriority: 90, effectivePriority: 90, availableAt: clock.now(), maxAttempts: 3,
      payload: { artworkId: artwork.id, generationId, sourceRevision: 0 } } })
    const repository = new PostgresQueueRepository(db! as unknown as QueueDatabase, { clock })
    const claimed = await repository.claim(prefix, capabilities)
    expect(claimed?.id).toBe(jobId)
    await executeArtworkSummary(context(repository, claimed!), { database: db!, scanRoot: '/unused',
      probe: { analyze: async () => { throw Error('SUMMARY_CHILD_UNAVAILABLE') } } })
    expect((await db!.systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('PAUSED')
    expect((await db!.artworkSummary.findUniqueOrThrow({ where: { artworkId: artwork.id } })).publishedRevision).toBeNull()
  })

  it.each(['gate', 'child'] as const)('honors cancellation before an action-required pause from %s', async (failure) => {
    const artwork = await db!.artwork.create({ data: { title: `${prefix}-cancel-${failure}` } })
    await db!.image.create({ data: { artworkId: artwork.id, path: `${prefix}/${failure}.jpg`, mediaType: 'IMAGE' } })
    const generationId = randomUUID(), jobId = `${prefix}-cancel-${failure}`
    await db!.artworkSummary.create({ data: { artworkId: artwork.id, generationId, jobId, replaceInProgress: failure === 'gate' } })
    await db!.systemJob.create({ data: { id: jobId, type: 'ARTWORK_SUMMARY_GENERATE', executionLane: 'BACKGROUND_WRITER', definitionVersion: 1,
      status: 'PENDING', triggerSource: 'MANUAL', queuePriority: 90, effectivePriority: 90, availableAt: clock.now(), maxAttempts: 3,
      payload: { artworkId: artwork.id, generationId, sourceRevision: 0 } } })
    const repository = new PostgresQueueRepository(db! as unknown as QueueDatabase, { clock })
    const claimed = await repository.claim(prefix, capabilities)
    expect(claimed?.id).toBe(jobId)
    await db!.systemJob.update({ where: { id: jobId }, data: { status: 'CANCELLING', cancelRequestedAt: clock.now() } })
    await executeArtworkSummary(context(repository, claimed!), { database: db!, scanRoot: '/unused',
      probe: { analyze: async () => { throw Error('SUMMARY_CHILD_UNAVAILABLE') } } })
    expect((await db!.systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('CANCELLED')
    expect((await db!.artworkSummary.findUniqueOrThrow({ where: { artworkId: artwork.id } })).publishedRevision).toBeNull()
  })

})
