import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient, type Prisma } from '@prisma/client'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const prefix = `visual-round-db-${randomUUID()}`
const artists: number[] = [], jobs: string[] = [], runs: string[] = []
afterAll(async () => {
  if (!db) return
  await db.artworkDedupRun.deleteMany({ where: { id: { in: runs } } })
  await db.systemJob.deleteMany({ where: { id: { in: jobs } } })
  await db.artist.deleteMany({ where: { id: { in: artists } } })
  await db.$disconnect()
})
async function fixture() {
  const artist = await db!.artist.create({ data: { name: prefix } }); artists.push(artist.id)
  const job = await db!.systemJob.create({ data: { type: 'ARTWORK_DEDUP_SCAN', definitionVersion: 6, executionLane: 'BACKGROUND_WRITER', triggerSource: 'SYSTEM', queuePriority: 900, effectivePriority: 900, payload: {} } }); jobs.push(job.id)
  const run = await db!.artworkDedupRun.create({ data: { artistId: artist.id, requestedBy: prefix, idempotencyKey: randomUUID(), mode: 'FULL', jobId: job.id,
    includeSuspectedVersions: true, stage: 'VISUAL', visualStatus: 'PENDING', visualComparisonRound: 1, visualComparedComparisons: 200000, visualBudgetWaiting: true } }); runs.push(run.id)
  return { run, job }
}
describe.skipIf(!db)('visual round database invariants', () => {
  it('rejects completing or publishing a waiting round and rolls back the job transition', async () => {
    const { run, job } = await fixture()
    await expect(db!.systemJob.update({ where: { id: job.id }, data: { status: 'COMPLETED' } })).rejects.toThrow()
    await expect(db!.artworkDedupRun.update({ where: { id: run.id }, data: { status: 'COMPLETED' } })).rejects.toThrow()
    await expect(db!.artworkDedupRun.update({ where: { id: run.id }, data: { stage: 'DONE' } })).rejects.toThrow()
    expect((await db!.systemJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('PENDING')
    expect((await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.id } })).visualBudgetWaiting).toBe(true)
  })
  it.each(['FAILED', 'SKIPPED', 'CANCELLED'] as const)('clears pending permission on queue %s', async status => {
    const { run, job } = await fixture()
    await db!.systemJob.update({ where: { id: job.id }, data: { status, ...(status === 'SKIPPED' ? { skipReason: 'PRECONDITION_NOT_MET' as const, skippedAt: new Date() } : {}) } })
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: status === 'SKIPPED' ? 'FAILED' : status, visualBudgetWaiting: false, visualComparedComparisons: 200000 })
  })
  it('retains legacy counter bounds and enforces aggregate per-round allowance and exact round offsets', async () => {
    const { run } = await fixture()
    const update = (data: Prisma.ArtworkDedupRunUpdateInput) => db!.artworkDedupRun.update({ where: { id: run.id }, data })
    await update({ visualBudgetWaiting: false })
    await expect(update({ visualComparedComparisons: 200001 })).rejects.toThrow()
    await expect(update({ visualReusedComparisons: 1 })).rejects.toThrow()
    await expect(update({ visualComparisonRound: 2, visualRoundStartComparisons: 199999 })).rejects.toThrow()
    await update({ visualComparisonRound: 2, visualRoundStartComparisons: 200000, visualComparedComparisons: 300000, visualReusedComparisons: 100000, visualBudgetWaiting: true })
    await expect(update({ visualReusedComparisons: 100001 })).rejects.toThrow()
    await update({ visualComparisonRound: 0, visualRoundStartComparisons: 0, visualBudgetWaiting: false, visualComparedComparisons: 200000, visualReusedComparisons: 200000 })
    await expect(update({ visualComparedComparisons: 200001 })).rejects.toThrow()
    await expect(update({ visualBudgetWaiting: true })).rejects.toThrow()
  })
})
