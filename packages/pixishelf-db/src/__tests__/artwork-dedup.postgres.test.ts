import { randomUUID } from 'node:crypto'
import { PrismaClient, Prisma } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import {
  assertArtworkDedupExecution,
  assertArtworkDedupItemCurrent,
  buildArtworkDedupCandidates,
  buildArtworkDedupGroups,
  buildArtworkDedupRelationsPage,
  claimArtworkDedupReader,
  freezeArtworkDedupRun,
  readArtworkDedupItemsPage,
  recordArtworkDedupReaderOwner,
  releaseArtworkDedupReader,
  saveArtworkDedupMediaPage,
  type ArtworkDedupExecution
} from '../artwork-dedup'
import { captureArtworkContentSnapshot } from '../media-content-evidence'
import { inspectArtworkDedupReaderRecovery, recoverArtworkDedupReader } from '../artwork-dedup-reader-recovery'
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const rollback = new Error('rollback dedup fixture')
async function isolated(body: (tx: Prisma.TransactionClient) => Promise<void>) {
  await expect(
    db!.$transaction(
      async (tx) => {
        await body(tx)
        throw rollback
      },
      { timeout: 30_000 }
    )
  ).rejects.toBe(rollback)
}
async function seed(tx: Prisma.TransactionClient, contents: number[][]) {
  const artist = await tx.artist.create({ data: { name: 'dedup-fixture' } })
  const artworks = []
  for (const sizes of contents) {
    const a = await tx.artwork.create({
      data: {
        title: 'fixture',
        creators: {
          create: { artistId: artist.id, evidence: { create: { evidenceKey: 'manual', provenance: 'MANUAL' } } }
        }
      }
    })
    for (const size of sizes) {
      await tx.image.create({
        data: { artworkId: a.id, path: `fixture/${a.id}/${randomUUID()}.jpg`, size: BigInt(size) }
      })
    }
    artworks.push(a)
  }
  const { run } = await freezeArtworkDedupRun(tx, {
    artistId: artist.id,
    requestedBy: 'fixture',
    idempotencyKey: randomUUID(),
    mode: 'INCREMENTAL'
  })
  const job = await tx.systemJob.create({
    data: {
      type: 'ARTWORK_DEDUP_SCAN',
      payload: { runId: run.id, executionVersion: 1 },
      queuePriority: 900,
      effectivePriority: 900
    }
  })
  await tx.artworkDedupRun.update({ where: { id: run.id }, data: { jobId: job.id } })
  await tx.systemJob.update({
    where: { id: job.id },
    data: {
      status: 'RUNNING',
      workerId: 'dedup-fixture',
      leaseToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      attempt: 1
    }
  })
  return {
    artist,
    artworks,
    run,
    execution: { runId: run.id, jobId: job.id, executionVersion: 1 } satisfies ArtworkDedupExecution
  }
}
async function complete(
  tx: Prisma.TransactionClient,
  execution: ArtworkDedupExecution,
  artworkId: number,
  hash: string
) {
  const captured = await captureArtworkContentSnapshot(tx, { artworkId })
  if (captured.status !== 'READY') throw new Error(captured.status)
  const snapshot = captured.value
  const images = await tx.image.findMany({ where: { artworkId }, orderBy: { id: 'asc' } })
  await saveArtworkDedupMediaPage(tx, {
    execution,
    artworkId,
    entries: images.map((i) => ({
      imageId: i.id,
      sourcePath: i.path,
      sourceRevision: 0n,
      logicalRoot: 'source-media:v1',
      rootIdentity: 'fixture-root',
      relativeDirectory: 'fixture',
      directoryId: 'fixture-directory',
      directoryGeneration: 0n,
      canonicalPath: i.path,
      size: i.size!,
      sha256: hash
    }))
  })
  const data = {
    algorithmVersion: 1,
    sourceRevision: snapshot.revision,
    mediaEpoch: snapshot.mediaEpoch,
    membersSignature: 'b'.repeat(64),
    fileCount: snapshot.memberCount,
    contentSha256: 'a'.repeat(64),
    completedAt: new Date()
  }
  await tx.artworkContentFingerprint.create({ data: { artworkId, ...data } })
  await tx.artworkDedupItem.update({
    where: { runId_artworkId: { runId: execution.runId, artworkId } },
    data: {
      status: 'COMPLETE',
      snapshotRevision: snapshot.revision,
      mediaEpoch: snapshot.mediaEpoch,
      memberCount: snapshot.memberCount,
      membersSignature: data.membersSignature,
      contentSha256: data.contentSha256
    }
  })
}
describe.skipIf(!db)('artwork detection durable evidence', () => {
  afterAll(async () => {
    await db?.$disconnect()
  })
  it('freezes only effective visible artwork memberships and never follows new items', () =>
    isolated(async (tx) => {
      const f = await seed(tx, [[1], [2]])
      const excluded = await tx.artwork.create({
        data: {
          title: 'excluded',
          creators: {
            create: {
              artistId: f.artist.id,
              evidence: { create: { evidenceKey: 'manual', provenance: 'MANUAL', excludedAt: new Date() } }
            }
          }
        }
      })
      const fresh = await tx.artwork.create({
        data: {
          title: 'new',
          creators: {
            create: { artistId: f.artist.id, evidence: { create: { evidenceKey: 'manual', provenance: 'MANUAL' } } }
          }
        }
      })
      const page = await readArtworkDedupItemsPage(tx, { execution: f.execution, limit: 1 })
      expect(page).toHaveLength(1)
      const rest = await readArtworkDedupItemsPage(tx, { execution: f.execution, afterArtworkId: page[0]!.artworkId })
      expect(rest).toHaveLength(1)
      expect([...page, ...rest].map((i) => i.artworkId)).not.toContain(fresh.id)
      expect([...page, ...rest].map((i) => i.artworkId)).not.toContain(excluded.id)
      await tx.artworkArtistEvidence.updateMany({
        where: { membership: { artworkId: page[0]!.artworkId } },
        data: { excludedAt: new Date() }
      })
      expect(await assertArtworkDedupItemCurrent(tx, { execution: f.execution, artworkId: page[0]!.artworkId })).toBe(
        false
      )
    }))
  it('candidate inventory no longer excludes different size multisets before SHA inclusion', () =>
    isolated(async (tx) => {
      const f = await seed(tx, [
        [1, 2],
        [2, 1],
        [1, 1]
      ])
      for (const a of f.artworks) {
        await complete(tx, f.execution, a.id, 'c'.repeat(64))
        await tx.artworkDedupItem.update({
          where: { runId_artworkId: { runId: f.run.id, artworkId: a.id } },
          data: { status: 'SIZED' }
        })
      }
      await buildArtworkDedupCandidates(tx, { execution: f.execution })
      const rows = await tx.artworkDedupItem.findMany({ where: { runId: f.run.id }, orderBy: { artworkId: 'asc' } })
      expect(rows.map((i) => i.status)).toEqual(['HASHING', 'HASHING', 'HASHING'])
    }))
  it('checkpoints high-frequency containment candidates at 100 without truncating or pairing images', () =>
    isolated(async (tx) => {
      const f = await seed(tx, [[1], ...Array.from({ length: 105 }, (_, i) => [1, i + 2])])
      for (const artwork of f.artworks) await complete(tx, f.execution, artwork.id, 'c'.repeat(64))
      await buildArtworkDedupGroups(tx, { execution: f.execution, prepareRelations: true })
      expect(await buildArtworkDedupRelationsPage(tx, { execution: f.execution })).toBe(false)
      expect(await tx.artworkDedupRelation.count({ where: { runId: f.run.id } })).toBe(100)
      expect(await tx.artworkDedupRun.findUniqueOrThrow({ where: { id: f.run.id } })).toMatchObject({
        stage: 'MATCH', relationAfterArtworkId: f.artworks[0]!.id,
        relationAfterCandidateId: f.artworks[100]!.id
      })
      expect(await buildArtworkDedupRelationsPage(tx, { execution: f.execution })).toBe(false)
      expect(await tx.artworkDedupRelation.count({ where: { runId: f.run.id } })).toBe(105)
      expect(await tx.artworkDedupRun.findUniqueOrThrow({ where: { id: f.run.id } })).toMatchObject({
        relationAfterArtworkId: f.artworks[0]!.id + 1, relationAfterCandidateId: 0
      })
    }), 30_000)
  it('partitions identical fingerprint collisions by exact canonical media tuples', () =>
    isolated(async (tx) => {
      const f = await seed(tx, [
        [1, 2],
        [2, 1],
        [1, 2],
        [2, 1]
      ])
      for (let n = 0; n < f.artworks.length; n++) {
        await complete(tx, f.execution, f.artworks[n]!.id, (n < 2 ? 'c' : 'd').repeat(64))
      }
      const final = await buildArtworkDedupGroups(tx, { execution: f.execution })
      expect(final.groupCount).toBe(2)
      expect(final.duplicateArtworks).toBe(2)
      expect(await tx.artworkDedupGroupMember.count({ where: { runId: f.run.id } })).toBe(4)
      const groupIds = (
        await tx.artworkDedupGroup.findMany({ where: { runId: f.run.id }, orderBy: { id: 'asc' } })
      ).map((g) => g.id)
      await buildArtworkDedupGroups(tx, { execution: f.execution })
      expect(
        (await tx.artworkDedupGroup.findMany({ where: { runId: f.run.id }, orderBy: { id: 'asc' } })).map((g) => g.id)
      ).toEqual(groupIds)
    }))
  it('excludes evidence changed after an earlier committed item and rejects old execution versions', () =>
    isolated(async (tx) => {
      const f = await seed(tx, [[1], [1]])
      for (const a of f.artworks) await complete(tx, f.execution, a.id, 'c'.repeat(64))
      await tx.artworkContentSource.update({
        where: { artworkId: f.artworks[0]!.id },
        data: { revision: { increment: 1n } }
      })
      const final = await buildArtworkDedupGroups(tx, { execution: f.execution })
      expect(final.groupCount).toBe(0)
      expect(final.changedArtworks).toBe(1)
      await expect(assertArtworkDedupExecution(tx, { ...f.execution, executionVersion: 2 })).rejects.toMatchObject({
        code: 'CONFLICT'
      })
      await tx.systemJob.update({
        where: { id: f.execution.jobId },
        data: { status: 'CANCELLING', cancelRequestedAt: new Date() }
      })
      await expect(buildArtworkDedupGroups(tx, { execution: f.execution })).rejects.toMatchObject({ code: 'CONFLICT' })
    }))
  it('groups legacy zero-version evidence without source rows alongside tracked artworks', () =>
    isolated(async (tx) => {
      const f = await seed(tx, [[1], [1], [1]])
      const legacyIds = f.artworks.slice(0, 2).map((a) => a.id)
      // Imported before source tracking: absence is the valid initial revision/epoch.
      await tx.artworkContentSource.deleteMany({ where: { artworkId: { in: legacyIds } } })
      for (const a of f.artworks) await complete(tx, f.execution, a.id, 'c'.repeat(64))
      for (const prepareRelations of [true, false]) {
        const result = await buildArtworkDedupGroups(tx, { execution: f.execution, prepareRelations })
        expect(result).toMatchObject({ completeArtworks: 3, changedArtworks: 0, groupCount: 1, duplicateArtworks: 2 })
        expect(await tx.artworkDedupGroupMember.count({ where: { runId: f.run.id } })).toBe(3)
      }
      expect(await tx.artworkContentSource.count({ where: { artworkId: { in: legacyIds } } })).toBe(0)
    }))
  it.each([
    'snapshot-revision', 'snapshot-epoch', 'fingerprint-revision', 'fingerprint-epoch',
    'missing-fingerprint', 'missing-media-hash', 'membership', 'writer', 'source-revision', 'source-epoch'
  ] as const)('still rejects %s mismatches for legacy zero-version evidence', (change) =>
    isolated(async (tx) => {
      const f = await seed(tx, [[1], [1]])
      await tx.artworkContentSource.deleteMany({ where: { artworkId: { in: f.artworks.map((a) => a.id) } } })
      for (const a of f.artworks) await complete(tx, f.execution, a.id, 'c'.repeat(64))
      const artworkId = f.artworks[0]!.id
      const itemWhere = { runId_artworkId: { runId: f.run.id, artworkId } }
      switch (change) {
        case 'snapshot-revision':
          await tx.artworkDedupItem.update({ where: itemWhere, data: { snapshotRevision: 1n } })
          break
        case 'snapshot-epoch':
          await tx.artworkDedupItem.update({ where: itemWhere, data: { mediaEpoch: 1n } })
          break
        case 'fingerprint-revision':
          await tx.artworkContentFingerprint.update({ where: { artworkId }, data: { sourceRevision: 1n } })
          break
        case 'fingerprint-epoch':
          await tx.artworkContentFingerprint.update({ where: { artworkId }, data: { mediaEpoch: 1n } })
          break
        case 'missing-fingerprint':
          await tx.artworkContentFingerprint.delete({ where: { artworkId } })
          break
        case 'missing-media-hash':
          await tx.artworkDedupMedia.updateMany({ where: { runId: f.run.id, artworkId }, data: { sha256: null } })
          break
        case 'membership':
          await tx.artworkArtistEvidence.updateMany({ where: { membership: { artworkId } }, data: { present: false } })
          break
        case 'writer':
          await tx.artworkContentSource.create({ data: { artworkId, writeToken: randomUUID(), writeStartedAt: new Date() } })
          break
        case 'source-revision':
          await tx.artworkContentSource.create({ data: { artworkId, revision: 1n } })
          break
        case 'source-epoch':
          await tx.artworkContentSource.create({ data: { artworkId, mediaEpoch: 1n } })
          break
      }
      const result = await buildArtworkDedupGroups(tx, { execution: f.execution })
      expect(result).toMatchObject({ completeArtworks: 1, changedArtworks: 1, groupCount: 0 })
      expect(await tx.artworkDedupItem.findUniqueOrThrow({ where: itemWhere })).toMatchObject({
        status: 'CHANGED', errorCode: 'CONTENT_CHANGED'
      })
    }))
  it('keeps global reader occupancy through lease loss and requires exact actual-close token', () =>
    isolated(async (tx) => {
      const f = await seed(tx, [[1]])
      await claimArtworkDedupReader(tx, { execution: f.execution, readerToken: 'reader-a' })
      expect((await tx.artworkDedupRun.findUniqueOrThrow({ where: { id: f.run.id } })).readerState).toBe('STARTING')
      await recordArtworkDedupReaderOwner(tx, {
        execution: f.execution,
        readerToken: 'reader-a',
        owner: { version: 1, machineId: 'm', bootId: 'b', pidNamespace: 'n', parentPid: 1, childPid: 2 }
      })
      await tx.systemJob.update({
        where: { id: f.execution.jobId },
        data: { status: 'FAILED', workerId: null, leaseToken: null, leaseExpiresAt: null, finishedAt: new Date() }
      })
      await expect(
        releaseArtworkDedupReader(tx, { execution: f.execution, readerToken: 'other' })
      ).rejects.toMatchObject({ code: 'CONFLICT' })
      expect((await tx.artworkDedupRun.findUniqueOrThrow({ where: { id: f.run.id } })).readerToken).toBe('reader-a')
      await releaseArtworkDedupReader(tx, { execution: f.execution, readerToken: 'reader-a' })
      expect((await tx.artworkDedupRun.findUniqueOrThrow({ where: { id: f.run.id } })).readerToken).toBeNull()
    }))
  it('offline reader recovery binds stopped-writer inspection, original token and auditable CAS', () =>
    isolated(async (tx) => {
      const f = await seed(tx, [[1]])
      await claimArtworkDedupReader(tx, { execution: f.execution, readerToken: 'blocked-reader' })
      await expect(inspectArtworkDedupReaderRecovery(tx, { runId: f.run.id, now: new Date() })).rejects.toMatchObject({
        status: 'WRITING'
      })
      await tx.systemJob.update({
        where: { id: f.execution.jobId },
        data: { status: 'FAILED', workerId: null, leaseToken: null, leaseExpiresAt: null, finishedAt: new Date() }
      })
      const inspected = await inspectArtworkDedupReaderRecovery(tx, { runId: f.run.id, now: new Date() })
      const input = {
        runId: f.run.id,
        expectedDigest: inspected.digest,
        expectedReaderToken: 'blocked-reader',
        operator: 'fixture',
        confirmAllWritersStopped: true,
        now: new Date()
      }
      await expect(recoverArtworkDedupReader(tx, { ...input, confirmAllWritersStopped: false })).rejects.toMatchObject({
        code: 'CONFLICT'
      })
      await expect(recoverArtworkDedupReader(tx, { ...input, expectedReaderToken: 'other' })).rejects.toMatchObject({
        code: 'CONFLICT'
      })
      await recoverArtworkDedupReader(tx, input)
      expect(await tx.systemJobEvent.count({ where: { jobId: f.execution.jobId, type: 'job.stage_changed' } })).toBe(1)
      expect(await tx.mediaContentPathWrite.count({ where: { jobId: f.execution.jobId } })).toBe(0)
      await expect(recoverArtworkDedupReader(tx, input)).rejects.toMatchObject({ code: 'CONFLICT' })
    }))
})
