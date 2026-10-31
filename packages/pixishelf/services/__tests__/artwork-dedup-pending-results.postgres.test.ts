// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Prisma, type PrismaClient } from '@pixishelf/db'
import { prisma } from '@/lib/prisma'
import { seedBatchDeleteFixture } from './artwork-batch-delete-fixture'
import { listArtworkDedupReviewGroups, saveArtworkDedupReviewService } from '../artwork-dedup-review-service'
import { resolveArtworkDedupDeleteSelection } from '../artwork-dedup-delete-adapter'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = prisma as unknown as PrismaClient
const root = '/private/tmp/pixishelf-batch-delete-env/media'
type Fixture = Awaited<ReturnType<typeof seedBatchDeleteFixture>>
async function groups(f: Fixture, cursor?: string, limit = 20) {
  const page = await listArtworkDedupReviewGroups(f.userId, {
    runId: f.runId,
    expectedUserId: f.userId,
    cursor,
    limit
  })
  if (page.kind !== 'GROUPS') throw new Error('Expected groups')
  return page
}
async function finish(f: Fixture, index: number) {
  const target = f.groups[index]!.target
  const artwork = await db.artwork.findUniqueOrThrow({ where: { id: target } })
  if (artwork.createdVia === 'URL_ARCHIVE') {
    await db.artwork.update({ where: { id: target }, data: { archiveLifecycleState: 'TRASHED' } })
  } else {
    await db.artwork.delete({ where: { id: target } })
  }
}
describe.skipIf(!url).sequential('pending dedup results in the isolated fixture database', () => {
  beforeAll(() => {
    const parsed = new URL(url!)
    if (
      process.env.DATABASE_URL !== url ||
      parsed.hostname !== '127.0.0.1' ||
      parsed.port !== '56432' ||
      parsed.pathname !== '/pixishelf_batch'
    ) {
      throw new Error('Only the explicitly isolated synthetic database is allowed')
    }
  })
  afterAll(() => db.$disconnect())

  it('removes completed direct/physical trash members while retaining queued trash and frozen evidence after refresh', async () => {
    const f = await seedBatchDeleteFixture(db, root)
    expect((await groups(f)).totalGroups).toBe(4)
    await finish(f, 0)
    await db.artwork.update({
      where: { id: f.groups[2]!.target },
      data: { archiveLifecycleState: 'TRASHING', deletedAt: new Date() }
    })
    const moving = await groups(f)
    expect(moving.totalGroups).toBe(3)
    expect(moving.items.find((g) => g.groupId === f.groups[2]!.groupId)?.eligibility).toBe('STALE')
    await finish(f, 2)
    for (let refresh = 0; refresh < 2; refresh++) {
      const page = await groups(f)
      expect(page.items.map((g) => g.groupId)).toEqual([f.groups[1]!.groupId, f.groups[3]!.groupId])
      expect(page.totalGroups).toBe(2)
      expect(page.recommendedGroupCount).toBe(1)
    }
    const [audit] = await db.$queryRaw<{ groups: number; members: number }[]>(Prisma.sql`
      SELECT (SELECT count(*)::int FROM "ArtworkDedupResult" WHERE "runId"=${f.runId}) groups,
        (SELECT count(*)::int FROM "ArtworkDedupResultMember" WHERE "runId"=${f.runId}) members`)
    expect(audit).toEqual({ groups: 4, members: 8 })
    expect((await db.artworkDedupRun.findUniqueOrThrow({ where: { id: f.runId } })).groupCount).toBe(4)
  })

  it('keeps the remaining exact relation, replaces a removed saved keeper and shares membership across preview, member pages and selection', async () => {
    const f = await seedBatchDeleteFixture(db, root, { extraGroups: 1 })
    const group = f.groups[0]!,
      extra = f.groups[4]!
    await db.artworkDedupGroupMember.updateMany({
      where: { runId: f.runId, groupId: extra.groupId },
      data: { groupId: group.groupId }
    })
    await db.artworkDedupGroup.update({ where: { id: group.groupId }, data: { memberCount: 4 } })
    await db.artwork.deleteMany({ where: { id: { in: [group.keeper, group.target] } } })
    const remaining = (await groups(f)).items.find((g) => g.groupId === group.groupId)!
    expect(remaining).toMatchObject({
      memberCount: 2,
      savedReview: null,
      reviewVersion: 1,
      eligibility: 'ELIGIBLE',
      recommendedKeeperArtworkId: extra.keeper
    })
    expect(remaining.previewMembers.map((m) => m.artworkId)).toEqual([extra.keeper, extra.target])
    const first = await listArtworkDedupReviewGroups(f.userId, {
      runId: f.runId,
      expectedUserId: f.userId,
      groupId: group.groupId,
      limit: 1
    })
    if (first.kind !== 'MEMBERS') throw new Error('Expected members')
    expect(first.items.map((m) => m.artworkId)).toEqual([extra.keeper])
    const second = await listArtworkDedupReviewGroups(f.userId, {
      runId: f.runId,
      expectedUserId: f.userId,
      groupId: group.groupId,
      memberCursor: first.nextMemberCursor!,
      limit: 1
    })
    if (second.kind !== 'MEMBERS') throw new Error('Expected members')
    expect(second.items.map((m) => m.artworkId)).toEqual([extra.target])
    const selection = await resolveArtworkDedupDeleteSelection(f.userId, {
      ...f.input,
      selection: { kind: 'EXPLICIT', groupIds: [group.groupId] }
    })
    expect(selection.artworkIds).toEqual([extra.target])
    const saved = await saveArtworkDedupReviewService(f.userId, {
      runId: f.runId,
      expectedUserId: f.userId,
      expectedRunVersion: 1,
      expectedReviewVersion: 1,
      groupId: group.groupId,
      keeperArtworkId: extra.target,
      idempotencyKey: randomUUID()
    })
    expect(saved.review).toMatchObject({ keeperArtworkId: extra.target, reviewVersion: 2 })
  })

  it('applies removal before keyset pages/totals/recommendations and rejects explicit processed groups', async () => {
    const f = await seedBatchDeleteFixture(db, root, { extraGroups: 20 })
    const initial = await groups(f)
    expect(initial.items).toHaveLength(20)
    expect(initial.nextCursor).toBeTruthy()
    for (let i = 0; i < 20; i++) await finish(f, i)
    const first = await groups(f)
    const next = await groups(f, initial.nextCursor!)
    expect(first.items).toHaveLength(4)
    expect(first.totalGroups).toBe(4)
    expect(first.recommendedGroupCount).toBe(4)
    expect(first.nextCursor).toBeNull()
    expect(next.items.map((g) => g.groupId)).toEqual(first.items.map((g) => g.groupId))
    const recommended = await resolveArtworkDedupDeleteSelection(f.userId, {
      ...f.input,
      selection: { kind: 'ALL_RECOMMENDED', excludedGroupIds: [], manualGroupIds: [] }
    })
    expect(recommended.artworkIds).toEqual(f.groups.slice(20).map((g) => g.target))
    await expect(
      resolveArtworkDedupDeleteSelection(f.userId, {
        ...f.input,
        selection: { kind: 'EXPLICIT', groupIds: [f.groups[0]!.groupId] }
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    for (let i = 20; i < 24; i++) await finish(f, i)
    const empty = await groups(f, initial.nextCursor!)
    expect(empty).toMatchObject({ items: [], totalGroups: 0, recommendedGroupCount: 0, nextCursor: null })
  }, 30_000)

  it('retains real revision changes and write conflicts as unavailable rather than treating every stale result as processed', async () => {
    const f = await seedBatchDeleteFixture(db, root)
    await db.artwork.update({ where: { id: f.groups[0]!.target }, data: { mediaRevision: { increment: 1 } } })
    await db.artworkContentSource.upsert({
      where: { artworkId: f.groups[1]!.target },
      create: { artworkId: f.groups[1]!.target, writeToken: randomUUID(), writeStartedAt: new Date() },
      update: { writeToken: randomUUID(), writeStartedAt: new Date() }
    })
    const page = await groups(f)
    expect(page.totalGroups).toBe(4)
    expect(page.items.slice(0, 2).map((g) => g.eligibility)).toEqual(['STALE', 'STALE'])
    await expect(
      resolveArtworkDedupDeleteSelection(f.userId, {
        ...f.input,
        selection: { kind: 'EXPLICIT', groupIds: [f.groups[0]!.groupId] }
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})
