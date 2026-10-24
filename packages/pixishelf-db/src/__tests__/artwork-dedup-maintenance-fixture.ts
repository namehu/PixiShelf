import { randomUUID } from 'node:crypto'
import { PrismaClient, Prisma } from '@prisma/client'
import { freezeArtworkDedupOperation } from '../artwork-dedup-review'
import { captureArtworkContentSnapshot } from '../media-content-evidence'
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
export const db = url ? new PrismaClient({ datasourceUrl: url }) : null
export const prefix = `dedup-review-${randomUUID()}`
const users: string[] = [],
  arts: number[] = [],
  artists: number[] = [],
  runs: string[] = [],
  jobs: string[] = []
export async function seed(tx: Prisma.TransactionClient, groups = 1) {
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
export async function prepared(tx: Prisma.TransactionClient, f: Awaited<ReturnType<typeof seed>>) {
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

export async function cleanupJobs() {
  if (db) await db.systemJob.deleteMany({ where: { id: { in: jobs } } })
}
export async function cleanupFixture() {
  if (!db) return
  await db.artworkDedupOperation.deleteMany({ where: { runId: { in: runs } } })
  await db.artworkDedupRun.deleteMany({ where: { id: { in: runs } } })
  await cleanupJobs()
  await db.image.deleteMany({ where: { artworkId: { in: arts } } })
  await db.artwork.deleteMany({ where: { id: { in: arts } } })
  await db.artist.deleteMany({ where: { id: { in: artists } } })
  await db.userBA.deleteMany({ where: { id: { in: users } } })
  await db.$disconnect()
}
