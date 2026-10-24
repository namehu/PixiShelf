import { randomUUID } from 'node:crypto'
import { PrismaClient, Prisma } from '@prisma/client'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import {
  freezeArtworkDedupOperation,
  saveArtworkDedupReview,
  readArtworkDedupGroupChoices,
  completeArtworkDedupPrepare
} from '../artwork-dedup-review'
import { captureArtworkContentSnapshot } from '../media-content-evidence'
import { deleteUserWithArtworkDedupProtection } from '../artwork-dedup-user-delete'
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const prefix = `dedup-review-${randomUUID()}`
const users: string[] = [],
  arts: number[] = [],
  artists: number[] = [],
  runs: string[] = [],
  jobs: string[] = []
async function seed(tx: Prisma.TransactionClient, groups = 1) {
  const actor = await tx.userBA.create({
    data: { id: `${prefix}-${randomUUID()}`, email: `${randomUUID()}@test.invalid`, name: 'actor' }
  })
  users.push(actor.id)
  const other = await tx.userBA.create({
    data: { id: `${prefix}-${randomUUID()}`, email: `${randomUUID()}@test.invalid`, name: 'other' }
  })
  users.push(other.id)
  const artist = await tx.artist.create({ data: { name: prefix } })
  artists.push(artist.id)
  const run = await tx.artworkDedupRun.create({
    data: {
      artistId: artist.id,
      requestedBy: actor.id,
      idempotencyKey: randomUUID(),
      mode: 'FULL',
      status: 'COMPLETED',
      stage: 'DONE',
      rootBindings: {
        version: 1,
        source: { logicalRoot: 'source-media:v1', rootIdentity: 'fixture' },
        archive: { logicalRoot: 'archive-media:v1', rootIdentity: 'archive-fixture' },
        archiveRelativePrefix: ''
      }
    }
  })
  runs.push(run.id)
  const members: number[][] = [],
    groupIds: string[] = []
  for (let g = 0; g < groups; g++) {
    const group = await tx.artworkDedupGroup.create({
      data: { id: randomUUID(), runId: run.id, contentSha256: 'a'.repeat(64), memberCount: 2, fileCount: 1n }
    })
    groupIds.push(group.id)
    const ids: number[] = []
    for (let i = 0; i < 2; i++) {
      const a = await tx.artwork.create({
        data: {
          title: prefix,
          creators: {
            create: { artistId: artist.id, evidence: { create: { evidenceKey: 'manual', provenance: 'MANUAL' } } }
          }
        }
      })
      arts.push(a.id)
      ids.push(a.id)
      await tx.image.create({ data: { artworkId: a.id, path: `${prefix}/${a.id}.jpg`, size: 10n } })
      const snap = await captureArtworkContentSnapshot(tx, { artworkId: a.id })
      if (snap.status !== 'READY') throw new Error(snap.status)
      const ev = {
        algorithmVersion: 1,
        sourceRevision: snap.value.revision,
        mediaEpoch: snap.value.mediaEpoch,
        membersSignature: 'b'.repeat(64),
        fileCount: 1n,
        contentSha256: 'a'.repeat(64),
        completedAt: new Date()
      }
      await tx.artworkContentFingerprint.create({ data: { artworkId: a.id, ...ev } })
      await tx.artworkDedupItem.create({
        data: {
          runId: run.id,
          artworkId: a.id,
          frozenMediaRevision: a.mediaRevision,
          status: 'COMPLETE',
          snapshotRevision: ev.sourceRevision,
          mediaEpoch: ev.mediaEpoch,
          memberCount: 1n,
          membersSignature: ev.membersSignature,
          contentSha256: ev.contentSha256
        }
      })
      await tx.artworkDedupGroupMember.create({ data: { runId: run.id, groupId: group.id, artworkId: a.id } })
    }
    members.push(ids)
  }
  return { actor, other, artist, run, members, groupIds }
}
async function prepared(tx: Prisma.TransactionClient, f: Awaited<ReturnType<typeof seed>>) {
  const { operation } = await freezeArtworkDedupOperation(tx, {
    userId: f.actor.id,
    idempotencyKey: randomUUID(),
    runId: f.run.id,
    expectedRunVersion: 1,
    expectedReviewRevision: 0,
    selection: { kind: 'ALL_RECOMMENDED', excludedGroupIds: [] }
  })
  const job = await tx.systemJob.create({
    data: {
      type: 'ARTWORK_DEDUP_MAINTENANCE',
      queuePriority: 900,
      effectivePriority: 900,
      payload: { operationId: operation.id, executionVersion: 1, mode: 'PREPARE' }
    }
  })
  jobs.push(job.id)
  await tx.systemJob.update({
    where: { id: job.id },
    data: {
      status: 'RUNNING',
      workerId: prefix,
      leaseToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() + 60000),
      attempt: 1
    }
  })
  await tx.artworkDedupOperation.update({ where: { id: operation.id }, data: { jobId: job.id } })
  const images = await tx.image.findMany({ where: { artworkId: { in: f.members.flat() } } })
  for (const image of images)
    await tx.artworkDedupOperationFile.create({
      data: {
        operationId: operation.id,
        artworkId: image.artworkId!,
        referenceKey: `media:${image.id}`,
        role: 'MEDIA',
        imageId: image.id,
        logicalRoot: 'source-media:v1',
        rootIdentity: 'fixture',
        canonicalPath: image.path,
        size: 10n,
        status: 'VERIFIED',
        ownershipStatus: 'VERIFIED',
        inspectionStatus: 'VERIFIED'
      }
    })
  await tx.artworkDedupOperationArtwork.updateMany({
    where: { operationId: operation.id },
    data: { inventoryComplete: true, inspectionComplete: true }
  })
  return { operationId: operation.id, jobId: job.id, executionVersion: 1 }
}
function signal() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => (release = resolve))
  return { promise, release }
}
describe.skipIf(!db)('maintenance review durable scope and publication locks', () => {
  afterEach(async () => {
    // Each fixture owns the one BACKGROUND_WRITER lane only for its test.
    if (db) await db.systemJob.deleteMany({ where: { id: { in: jobs } } })
  })
  afterAll(async () => {
    if (!db) return
    await db.artworkDedupOperation.deleteMany({ where: { runId: { in: runs } } })
    await db.artworkDedupRun.deleteMany({ where: { id: { in: runs } } })
    await db.systemJob.deleteMany({ where: { id: { in: jobs } } })
    await db.artwork.deleteMany({ where: { id: { in: arts } } })
    await db.artist.deleteMany({ where: { id: { in: artists } } })
    await db.userBA.deleteMany({ where: { id: { in: users } } })
    await db.$disconnect()
  })
  it('freezes all recommended groups in SQL; personal reviews remain separate and input retries retain scope', async () => {
    const f = await db!.$transaction((tx) => seed(tx, 3))
    const a = f.members[0]!
    await db!.artworkLike.create({ data: { artworkId: a[0]!, userId: f.actor.id, level: 1 } })
    await db!.artworkLike.create({ data: { artworkId: a[1]!, userId: f.other.id, level: 2 } })
    const choices = await db!.$transaction((tx) =>
      readArtworkDedupGroupChoices(tx, { runId: f.run.id, userId: f.actor.id })
    )
    expect(choices.find((c) => c.groupId === f.groupIds[0])?.keeperArtworkId).toBeNull()
    const input = {
      userId: f.actor.id,
      runId: f.run.id,
      groupId: f.groupIds[0]!,
      keeperArtworkId: a[0]!,
      expectedRunVersion: 1,
      expectedReviewVersion: 0,
      idempotencyKey: randomUUID()
    }
    const saved = await db!.$transaction((tx) => saveArtworkDedupReview(tx, input))
    expect(saved.reviewRevision).toBe(1)
    expect((await db!.$transaction((tx) => saveArtworkDedupReview(tx, input))).review.reviewVersion).toBe(1)
    expect(
      (
        await db!.$transaction((tx) =>
          readArtworkDedupGroupChoices(tx, { runId: f.run.id, userId: f.other.id, groupId: f.groupIds[0]! })
        )
      )[0]?.saved
    ).toBe(false)
    const freeze = {
      userId: f.actor.id,
      idempotencyKey: randomUUID(),
      runId: f.run.id,
      expectedRunVersion: 1,
      expectedReviewRevision: 1,
      selection: { kind: 'ALL_RECOMMENDED' as const, excludedGroupIds: [f.groupIds[2]!] }
    }
    const first = await db!.$transaction((tx) => freezeArtworkDedupOperation(tx, freeze))
    expect(first.operation.selectedGroups).toBe(2)
    expect(first.operation.excludedGroups).toBe(1)
    expect(
      await db!.artworkDedupOperationGroup.findUnique({
        where: { operationId_groupId: { operationId: first.operation.id, groupId: f.groupIds[2]! } }
      })
    ).toMatchObject({ status: 'EXCLUDED', reason: 'USER_EXCLUDED' })
    expect(
      await db!.artworkDedupOperationArtwork.count({
        where: { operationId: first.operation.id, artworkId: { in: f.members[2]! } }
      })
    ).toBe(0)
    expect(first.operation.requiresOrganizationConfirmation).toBe(true)
    const again = await db!.$transaction((tx) => freezeArtworkDedupOperation(tx, freeze))
    expect(again.operation.id).toBe(first.operation.id)
    expect(again.created).toBe(false)
    await expect(
      db!.$transaction((tx) =>
        freezeArtworkDedupOperation(tx, { ...freeze, selection: { kind: 'ALL_RECOMMENDED', excludedGroupIds: [] } })
      )
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  })
  it.each(['PENDING', 'BLOCKED'])('cannot publish READY with %s file inspection', async (inspectionStatus) => {
    const f = await db!.$transaction((tx) => seed(tx))
    const execution = await db!.$transaction((tx) => prepared(tx, f))
    const copy = await db!.artworkDedupOperationArtwork.findFirstOrThrow({
      where: { operationId: execution.operationId, role: 'COPY' }
    })
    await db!.artworkDedupOperationFile.updateMany({
      where: { operationId: execution.operationId, artworkId: copy.artworkId },
      data: { inspectionStatus }
    })
    const result = await db!.$transaction((tx) => completeArtworkDedupPrepare(tx, { execution }))
    expect(result.status).toBe('FAILED')
    expect(result.logicalBytes).toBeNull()
  })
  it('reading does not stale protection evidence; user cascade cannot cross the READY publication window', async () => {
    const f = await db!.$transaction((tx) => seed(tx))
    const art = f.members[0]![0]!
    await db!.artworkLike.create({ data: { artworkId: art, userId: f.other.id, level: 1 } })
    const execution = await db!.$transaction((tx) => prepared(tx, f))
    await db!.artworkReadingSummary.create({
      data: { userId: f.actor.id, artworkId: art, lastViewedAt: new Date(), stateVersion: 3 }
    })
    const ready = signal(),
      finish = signal()
    const publication = db!.$transaction(
      async (tx) => {
        const op = await completeArtworkDedupPrepare(tx, { execution })
        expect(op.status).toBe('READY')
        expect(op.preparedFiles).toBe(2n)
        expect(op.logicalBytes).toBe(10n)
        ready.release()
        await finish.promise
      },
      { timeout: 15000 }
    )
    await ready.promise
    try {
      await expect(
        db!.$transaction((tx) => deleteUserWithArtworkDedupProtection(tx, f.other.id))
      ).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } })
      expect(await db!.artworkLike.count({ where: { artworkId: art, userId: f.other.id } })).toBe(1)
    } finally {
      finish.release()
      await publication
    }
    await db!.$transaction((tx) => deleteUserWithArtworkDedupProtection(tx, f.other.id))
    await db!.artworkDedupOperation.update({ where: { id: execution.operationId }, data: { status: 'BUILDING' } })
    expect((await db!.$transaction((tx) => completeArtworkDedupPrepare(tx, { execution }))).status).toBe('STALE')
  })
  it('new mark FK insertion opposite the user deletion lock order is resolved by controlled rollback', async () => {
    const f = await db!.$transaction((tx) => seed(tx))
    const art = f.members[0]![0]!
    await db!.artworkLike.create({ data: { artworkId: art, userId: f.other.id, level: 1 } })
    const held = signal(),
      insert = signal()
    const writer = db!.$transaction(
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "Artwork" WHERE id=${art} FOR UPDATE`)
        held.release()
        await insert.promise
        await tx.mediaMark.create({
          data: {
            id: randomUUID(),
            userId: f.other.id,
            artworkId: art,
            artworkTitle: 'fixture',
            mediaPosition: 1,
            mediaType: 'image',
            bookmarkedAt: new Date()
          }
        })
      },
      { timeout: 15000 }
    )
    await held.promise
    await expect(
      db!.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "UserBA" WHERE id=${f.other.id} FOR UPDATE`)
        insert.release()
        await deleteUserWithArtworkDedupProtection(tx, f.other.id)
      })
    ).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } })
    await writer
    expect(await db!.mediaMark.count({ where: { userId: f.other.id, artworkId: art } })).toBe(1)
  })
})
