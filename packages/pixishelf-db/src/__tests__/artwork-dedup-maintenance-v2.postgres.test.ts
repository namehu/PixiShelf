import { randomUUID } from 'node:crypto'
import { PrismaClient, Prisma } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
if (url) {
  const target = new URL(url)
  if (
    target.hostname !== '127.0.0.1' ||
    target.port !== '55432' ||
    !['/dedup_b2_empty_20261024', '/dedup_b2_restore_20261024', '/dedup_containment_test'].includes(target.pathname)
  )
    {throw new Error('Use the two authorized migration fixture databases')}
}
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const prefix = `dedup-b2-v2-${randomUUID()}`
const identity = { operationId: 'fixture-operation', executionVersion: 1 }
const prepare = { ...identity, mode: 'PREPARE', purpose: 'DIRECT_DELETE', protocolVersion: 1 }
const data = (
  payload: Prisma.InputJsonValue,
  definitionVersion = 2,
  type: 'ARTWORK_DEDUP_SCAN' | 'ARTWORK_DEDUP_MAINTENANCE' = 'ARTWORK_DEDUP_MAINTENANCE'
) => ({
  id: `${prefix}-${randomUUID()}`,
  type,
  definitionVersion,
  executionLane: 'BACKGROUND_WRITER' as const,
  triggerSource: 'SYSTEM' as const,
  queuePriority: 900,
  effectivePriority: 900,
  payload
})
describe.skipIf(!db)('formal maintenance v2 and direct protocol constraints', () => {
  afterAll(async () => {
    if (!db) return
    await db.systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
    await db.$disconnect()
  })
  it('preserves legacy v1, accepts strict v2 and keeps scan v1 plus the scheduling restrictions', async () => {
    for (const input of [
      data({ ...identity, mode: 'PREPARE' }, 1),
      data({ runId: 'fixture-run', executionVersion: 1 }, 1, 'ARTWORK_DEDUP_SCAN'),
      data(prepare),
      data({ ...identity, mode: 'DIRECT_DELETE' }),
      data({ ...prepare, protocolVersion: 2 }, 3)
    ]) {
      await db!.systemJob.create({ data: input })
    }
    for (const invalid of [
      data(prepare, 3, 'ARTWORK_DEDUP_SCAN'),
      { ...data(prepare), queuePriority: 899 },
      { ...data(prepare), effectivePriority: 899 },
      { ...data(prepare), triggerSource: 'MANUAL' as const },
      { ...data(prepare), deadlineAt: new Date() },
      data(prepare, 4)
    ]) {
      await expect(db!.systemJob.create({ data: invalid })).rejects.toThrow('system_jobs_dedup_policy')
    }
  })
  it.each([
    { ...identity, mode: 'PREPARE' },
    { ...prepare, purpose: 'ISOLATION' },
    { ...prepare, purpose: 'PURGE' },
    { ...prepare, purpose: null },
    { ...prepare, protocolVersion: null },
    { ...prepare, protocolVersion: '1' },
    { ...prepare, protocolVersion: 2 },
    { ...prepare, protocolVersion: true },
    { ...prepare, mode: null },
    { ...prepare, mode: 1 },
    { ...prepare, operationId: null },
    { ...prepare, operationId: 1 },
    { ...prepare, executionVersion: null },
    { ...prepare, executionVersion: '1' },
    { ...prepare, executionVersion: -1 },
    { ...prepare, executionVersion: 1.5 },
    { ...prepare, paths: ['not-authorized'] },
    { ...identity, mode: 'DIRECT_DELETE', purpose: 'ISOLATION' },
    {},
    []
  ])('rejects invalid v2 JSON %# and rolls back prior writes in the same transaction', async (payload) => {
    const sentinel = `${prefix}-${randomUUID()}`
    await expect(
      db!.$transaction(async (tx) => {
        await tx.systemJob.create({
          data: { id: sentinel, type: 'VIDEO_MEDIA_PROBE', triggerSource: 'SYSTEM', payload: {} }
        })
        await tx.systemJob.create({ data: data(payload) })
      })
    ).rejects.toThrow('system_jobs_dedup_policy')
    expect(await db!.systemJob.findUnique({ where: { id: sentinel } })).toBeNull()
  })
  it.each([
    { preparePurpose: 'DIRECT_DELETE', protocolVersion: null, scopeDigest: null },
    { preparePurpose: 'ISOLATION', protocolVersion: 1, scopeDigest: 'a'.repeat(64) },
    { preparePurpose: 'PURGE', protocolVersion: 1, scopeDigest: 'a'.repeat(64) },
    { preparePurpose: 'DIRECT_DELETE', protocolVersion: 1, scopeDigest: 'old-scope' },
    { preparePurpose: 'DIRECT_DELETE', protocolVersion: 1, scopeDigest: 'a'.repeat(64), mode: 'DIRECT_DELETE' }
  ])('does not turn missing protocol or legacy scope into delete authority %#', async (fields) => {
    const userId = `${prefix}-${randomUUID()}`
    await expect(
      db!.$transaction(async (tx) => {
        await tx.userBA.create({ data: { id: userId, name: 'fixture', email: `${userId}@test.invalid` } })
        const artist = await tx.artist.create({ data: { name: userId } })
        const run = await tx.artworkDedupRun.create({
          data: { artistId: artist.id, requestedBy: userId, mode: 'FULL', idempotencyKey: randomUUID() }
        })
        await tx.artworkDedupOperation.create({
          data: {
            runId: run.id,
            artistId: artist.id,
            requestedBy: userId,
            idempotencyKey: randomUUID(),
            requestDigest: 'a'.repeat(64),
            runVersion: 1,
            frozenReviewRevision: 0,
            selectionKind: 'EXPLICIT',
            ...fields
          }
        })
      })
    ).rejects.toThrow('ArtworkDedupOperation_direct_')
    expect(await db!.userBA.findUnique({ where: { id: userId } })).toBeNull()
  })
})
