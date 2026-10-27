import type { MediaContentDirectorySnapshot } from '../media-content-types'
import { assertArtworkDedupVisualDirectories } from '../artwork-dedup-visual'
import { captureMediaContentDirectory } from '../media-content-directory'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PrismaClient, Prisma } from '@prisma/client'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import {
  freezeArtworkDedupOperation,
  saveArtworkDedupReview,
  readArtworkDedupGroupChoices,
  validateArtworkDedupOperationSnapshot,
  completeArtworkDedupPrepare
} from '../artwork-dedup-review'
import { captureArtworkContentSnapshot } from '../media-content-evidence'
import { deleteUserWithArtworkDedupProtection } from '../artwork-dedup-user-delete'
import { readArtworkDedupInventoryPage } from '../artwork-dedup-operation'
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
async function relation(tx: Prisma.TransactionClient, f: Awaited<ReturnType<typeof seed>>, contained: number, container: number) {
  const fingerprint = await tx.artworkContentFingerprint.findUniqueOrThrow({ where: { artworkId: container } })
  await tx.image.create({ data: { artworkId: container, path: `${prefix}/${container}-${randomUUID()}.jpg`, size: 20n } })
  const snap = await captureArtworkContentSnapshot(tx, { artworkId: container })
  if (snap.status !== 'READY') throw new Error(snap.status)
  const evidence = { ...fingerprint, sourceRevision: snap.value.revision, mediaEpoch: snap.value.mediaEpoch, fileCount: snap.value.memberCount }
  await tx.artworkContentFingerprint.upsert({ where: { artworkId: container }, create: evidence, update: evidence })
  await tx.artworkDedupItem.update({ where: { runId_artworkId: { runId: f.run.id, artworkId: container } }, data: {
    snapshotRevision: snap.value.revision, mediaEpoch: snap.value.mediaEpoch, memberCount: snap.value.memberCount
  } })
  return tx.artworkDedupRelation.create({ data: { id: randomUUID(), runId: f.run.id,
    containedArtworkId: contained, containerArtworkId: container, containedFileCount: 1n, containerFileCount: snap.value.memberCount } })
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
async function legacyEvidence(tx: Prisma.TransactionClient, f: Awaited<ReturnType<typeof seed>>) {
  const ids = f.members.flat()
  await tx.artworkContentSource.deleteMany({ where: { artworkId: { in: ids } } })
  await tx.artworkContentFingerprint.updateMany({ where: { artworkId: { in: ids } }, data: { sourceRevision: 0n, mediaEpoch: 0n } })
  await tx.artworkDedupItem.updateMany({ where: { runId: f.run.id }, data: { snapshotRevision: 0n, mediaEpoch: 0n } })
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
  it.each(['EXACT', 'CONTAINS', 'VISUAL', 'PARTIAL'] as const)('reviews and freezes legacy zero-version %s evidence', async kind => {
    await db!.$transaction(async tx => {
      const f = await seed(tx)
      const [left, right] = f.members[0]!
      let groupId = f.groupIds[0]!
      if (kind !== 'EXACT') {
        await tx.artworkDedupGroup.delete({ where: { id: groupId } })
        const contained = await relation(tx, f, left!, right!)
        groupId = contained.id
        if (kind !== 'CONTAINS') {
          await tx.artworkDedupRelation.delete({ where: { id: groupId } })
          const summary = kind === 'VISUAL'
            ? { evidenceVersion: 'dct63-grid3-crop-local1-v1', leftArtworkId: left!, rightArtworkId: right!, leftFileCount: '1', rightFileCount: '2', pairedCount: '1', exactCount: '0', similarCount: '1', leftUnmatchedCount: '0', rightUnmatchedCount: '1', leftUncheckedCount: '0', rightUncheckedCount: '0' }
            : { evidenceVersion: 'sha256-multiset-overlap-v1', leftArtworkId: left!, rightArtworkId: right!, leftFileCount: '5', rightFileCount: '5', pairedCount: '4', exactCount: '4', similarCount: '0', leftUnmatchedCount: '1', rightUnmatchedCount: '1', leftUncheckedCount: '0', rightUncheckedCount: '0' }
          await tx.artworkDedupVisualPair.create({ data: { id: groupId, runId: f.run.id, leftArtworkId: left!, rightArtworkId: right!, relationKind: kind, summary } })
        }
      }
      await legacyEvidence(tx, f)
      expect((await readArtworkDedupGroupChoices(tx, { runId: f.run.id, userId: f.actor.id, groupId }))[0]).toMatchObject({ eligible: true, relationKind: kind })
      await saveArtworkDedupReview(tx, { userId: f.actor.id, runId: f.run.id, groupId, keeperArtworkId: right!, expectedRunVersion: 1, expectedReviewVersion: 0, idempotencyKey: randomUUID() })
      const { operation } = await freezeArtworkDedupOperation(tx, { userId: f.actor.id, runId: f.run.id, expectedRunVersion: 1, expectedReviewRevision: 1, idempotencyKey: randomUUID(), preparePurpose: 'DIRECT_DELETE', selection: { kind: 'EXPLICIT', groupIds: [groupId] } })
      expect(await validateArtworkDedupOperationSnapshot(tx, operation.id)).toBe(true)
      expect(await tx.artworkContentSource.count({ where: { artworkId: { in: f.members.flat() } } })).toBe(0)
    })
  })
  it('upgrades existing legacy results without backfilling sources or changing reviews', async () => {
    const migration = await readFile(new URL('../../prisma/migrations/20261027000300_artwork_dedup_legacy_review/migration.sql', import.meta.url), 'utf8')
    const previous = await readFile(new URL('../../prisma/migrations/20261026000100_artwork_dedup_partial/migration.sql', import.meta.url), 'utf8')
    const start = previous.indexOf('CREATE FUNCTION artwork_dedup_group_choices(')
    const oldFunction = previous.slice(start, previous.indexOf('$$;', start) + 3).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
    const rollback = new Error('rollback migration fixture')
    await expect(db!.$transaction(async tx => {
      const f = await seed(tx)
      await legacyEvidence(tx, f)
      const input = { runId: f.run.id, userId: f.actor.id }
      const before = await tx.artworkDedupItem.findMany({ where: { runId: f.run.id }, orderBy: { artworkId: 'asc' } })
      await tx.$executeRawUnsafe(oldFunction)
      expect((await readArtworkDedupGroupChoices(tx, input))[0]).toMatchObject({ eligible: false, reason: 'UNAVAILABLE' })
      await tx.$executeRawUnsafe(migration)
      expect((await readArtworkDedupGroupChoices(tx, input))[0]).toMatchObject({ eligible: true })
      await tx.$executeRawUnsafe(migration)
      expect((await readArtworkDedupGroupChoices(tx, input))[0]).toMatchObject({ eligible: true })
      expect(await tx.artworkDedupItem.findMany({ where: { runId: f.run.id }, orderBy: { artworkId: 'asc' } })).toEqual(before)
      expect(await tx.artworkContentSource.count({ where: { artworkId: { in: f.members.flat() } } })).toBe(0)
      expect(await tx.artworkDedupReview.count({ where: { runId: f.run.id } })).toBe(0)
      throw rollback
    })).rejects.toBe(rollback)
  })
  it.each(['unchanged', 'source-revision', 'source-epoch', 'writer', 'fingerprint', 'missing-fingerprint', 'deleted', 'membership', 'frozen-revision', 'frozen-epoch'] as const)(
    'validates legacy review, inventory and final snapshot after %s', async change => {
      await db!.$transaction(async tx => {
        const f = await seed(tx)
        await legacyEvidence(tx, f)
        const execution = await prepared(tx, f)
        const artworkId = f.members[0]![0]!
        const frozenWhere = { operationId_artworkId: { operationId: execution.operationId, artworkId } }
        switch (change) {
          case 'source-revision': await tx.artworkContentSource.create({ data: { artworkId, revision: 1n } }); break
          case 'source-epoch': await tx.artworkContentSource.create({ data: { artworkId, mediaEpoch: 1n } }); break
          case 'writer': await tx.artworkContentSource.create({ data: { artworkId, writeToken: randomUUID(), writeStartedAt: new Date() } }); break
          case 'fingerprint': await tx.artworkContentFingerprint.update({ where: { artworkId }, data: { sourceRevision: 1n } }); break
          case 'missing-fingerprint': await tx.artworkContentFingerprint.delete({ where: { artworkId } }); break
          case 'deleted': await tx.artwork.update({ where: { id: artworkId }, data: { deletedAt: new Date() } }); break
          case 'membership': await tx.artworkArtistEvidence.updateMany({ where: { membership: { artworkId } }, data: { present: false } }); break
          case 'frozen-revision': await tx.artworkDedupOperationArtwork.update({ where: frozenWhere, data: { snapshotRevision: 1n } }); break
          case 'frozen-epoch': await tx.artworkDedupOperationArtwork.update({ where: frozenWhere, data: { mediaEpoch: 1n } }); break
        }
        expect(await validateArtworkDedupOperationSnapshot(tx, execution.operationId)).toBe(change === 'unchanged')
        const choice = (await readArtworkDedupGroupChoices(tx, { runId: f.run.id, userId: f.actor.id }))[0]!
        expect(choice.eligible).toBe(['unchanged', 'frozen-revision', 'frozen-epoch'].includes(change))
        if (['source-revision', 'source-epoch', 'writer', 'deleted', 'frozen-revision', 'frozen-epoch'].includes(change)) {
          await expect(readArtworkDedupInventoryPage(tx, { execution, artworkId })).rejects.toMatchObject({ code: 'STALE' })
        } else if (change === 'unchanged') {
          expect(await readArtworkDedupInventoryPage(tx, { execution, artworkId })).toBeDefined()
          expect((await completeArtworkDedupPrepare(tx, { execution })).status).toBe('READY')
        }
      }, { timeout: 30000 })
    }
  )
  it('visual directory publication accepts 101 directories in bounded batches across both roots', async () => {
    const before = new Set((await db!.mediaContentDirectoryState.findMany({ select: { id: true } })).map(r => r.id))
    const snapshots: MediaContentDirectorySnapshot[] = []
    for (const logicalRoot of ['source-media:v1', 'archive-media:v1'] as const) {
      const root = await db!.mediaContentDirectoryState.findFirst({ where: { logicalRoot, relativeDirectory: '' } })
      const rootIdentity = root?.rootIdentity ?? randomUUID()
      for (let index = 0; index < (logicalRoot === 'source-media:v1' ? 51 : 50); index++) {
        const result = await db!.$transaction(tx => captureMediaContentDirectory(tx, { directory: { logicalRoot, rootIdentity, relativeDirectory: `${prefix}/batch-${index}` } }))
        if (result.status !== 'READY') throw new Error(result.status)
        snapshots.push(result.value)
      }
    }
    expect(await db!.$transaction(tx => assertArtworkDedupVisualDirectories(tx, snapshots.reverse()))).toBe(true)
    const first = snapshots[0]!
    expect(await db!.$transaction(tx => assertArtworkDedupVisualDirectories(tx, [{ ...first, generation: first.generation + 1n }, ...snapshots.slice(1)]))).toBe(false)
    const created = (await db!.mediaContentDirectoryState.findMany({ select: { id: true } })).filter(r => !before.has(r.id)).map(r => r.id)
    await db!.mediaContentDirectoryState.deleteMany({ where: { id: { in: created } } })
  })
  it('visual publication locks both roots before artworks and serializes with a directory-first writer', async () => {
    const f = await db!.$transaction(tx => seed(tx))
    const before = new Set((await db!.mediaContentDirectoryState.findMany({ select: { id: true } })).map(r => r.id))
    const snapshots: MediaContentDirectorySnapshot[] = []
    for (const logicalRoot of ['source-media:v1', 'archive-media:v1'] as const) {
      const root = await db!.mediaContentDirectoryState.findFirst({ where: { logicalRoot, relativeDirectory: '' } })
      const result = await db!.$transaction(tx => captureMediaContentDirectory(tx, { directory: { logicalRoot, rootIdentity: root?.rootIdentity ?? randomUUID(), relativeDirectory: `${prefix}/locking` } }))
      if (result.status !== 'READY') throw new Error(result.status)
      snapshots.push(result.value)
    }
    const directoriesLocked = signal(), writerStarted = signal(), release = signal()
    let writerFinished = false
    const publication = db!.$transaction(async tx => {
      expect(await assertArtworkDedupVisualDirectories(tx, snapshots.slice().reverse())).toBe(true)
      directoriesLocked.release()
      await release.promise
      for (const artworkId of f.members[0]!) expect((await captureArtworkContentSnapshot(tx, { artworkId })).status).toBe('READY')
    }, { timeout: 10000 })
    await directoriesLocked.promise
    const writer = db!.$transaction(async tx => {
      writerStarted.release()
      expect((await captureMediaContentDirectory(tx, { directory: snapshots[1]! })).status).toBe('READY')
      expect((await captureArtworkContentSnapshot(tx, { artworkId: f.members[0]![1]! })).status).toBe('READY')
      writerFinished = true
    }, { timeout: 10000 })
    await writerStarted.promise
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(writerFinished).toBe(false)
    release.release()
    await Promise.all([publication, writer])
    expect(writerFinished).toBe(true)
    const created = (await db!.mediaContentDirectoryState.findMany({ select: { id: true } })).filter(r => !before.has(r.id)).map(r => r.id)
    await db!.mediaContentDirectoryState.deleteMany({ where: { id: { in: created } } })
  })
  it('visual choices are manual, excluded from bulk and freeze one pair with either keeper and unchanged per-side SHA', async () => {
    const f = await db!.$transaction(tx => seed(tx, 2))
    const [left, right] = f.members[0]!
    await db!.$transaction(async tx => {
      const r = await relation(tx, f, left!, right!)
      await tx.artworkDedupRelation.delete({ where: { id: r.id } })
    })
    const summary = { evidenceVersion: 'dct63-grid3-crop-local1-v1', leftArtworkId: left!, rightArtworkId: right!,
      leftFileCount: '1', rightFileCount: '2', pairedCount: '1', exactCount: '0', similarCount: '1',
      leftUnmatchedCount: '0', rightUnmatchedCount: '1', leftUncheckedCount: '0', rightUncheckedCount: '0' }
    const pair = await db!.artworkDedupVisualPair.create({ data: { id: randomUUID(), runId: f.run.id, leftArtworkId: left!, rightArtworkId: right!, summary } })
    await db!.artworkDedupGroup.delete({ where: { id: f.groupIds[0]! } })
    await db!.artworkContentFingerprint.update({ where: { artworkId: right! }, data: { contentSha256: 'c'.repeat(64) } })
    await db!.artworkDedupItem.update({ where: { runId_artworkId: { runId: f.run.id, artworkId: right! } }, data: { contentSha256: 'c'.repeat(64) } })
    const choice = (await db!.$transaction(tx => readArtworkDedupGroupChoices(tx, { runId: f.run.id, userId: f.actor.id, groupId: pair.id })))[0]!
    expect(choice).toMatchObject({ relationKind: 'VISUAL', keeperArtworkId: null, saved: false, reason: 'NEEDS_CHOICE' })
    const freeze = (ids: string[], revision: number) => db!.$transaction(tx => freezeArtworkDedupOperation(tx, { userId: f.actor.id, runId: f.run.id, expectedRunVersion: 1,
      expectedReviewRevision: revision, idempotencyKey: randomUUID(), preparePurpose: 'DIRECT_DELETE', selection: { kind: 'EXPLICIT', groupIds: ids } }))
    await expect(freeze([pair.id], 0)).rejects.toMatchObject({ code: 'EXPLICIT_CHOICE_REQUIRED' })
    for (const [i, keeperArtworkId] of [left!, right!].entries()) {
      await db!.$transaction(tx => saveArtworkDedupReview(tx, { userId: f.actor.id, runId: f.run.id, groupId: pair.id, keeperArtworkId,
        expectedRunVersion: 1, expectedReviewVersion: i, idempotencyKey: randomUUID() }))
      await expect(freeze([pair.id, f.groupIds[1]!], i + 1)).rejects.toMatchObject({ code: 'VISUAL_SINGLE_PAIR_REQUIRED' })
      const { operation } = await freeze([pair.id], i + 1)
      expect(operation).toMatchObject({ protocolVersion: 3, selectedGroups: 1, keepers: 1, copies: 1 })
      const group = await db!.artworkDedupOperationGroup.findFirstOrThrow({ where: { operationId: operation.id } })
      expect(group).toMatchObject({ keeperArtworkId, selectionBasis: 'SAVED', visual: summary })
      expect(await db!.$transaction(tx => validateArtworkDedupOperationSnapshot(tx, operation.id))).toBe(true)
      if (i === 1) {
        await db!.artworkContentFingerprint.update({ where: { artworkId: right! }, data: { contentSha256: 'd'.repeat(64) } })
        expect(await db!.$transaction(tx => validateArtworkDedupOperationSnapshot(tx, operation.id))).toBe(false)
        await db!.artworkContentFingerprint.update({ where: { artworkId: right! }, data: { contentSha256: 'c'.repeat(64) } })
      }
    }
    const bulk = await db!.$transaction(tx => freezeArtworkDedupOperation(tx, { userId: f.actor.id, runId: f.run.id, expectedRunVersion: 1,
      expectedReviewRevision: 2, idempotencyKey: randomUUID(), preparePurpose: 'DIRECT_DELETE', selection: { kind: 'ALL_RECOMMENDED', excludedGroupIds: [] } }))
    expect(await db!.artworkDedupOperationGroup.count({ where: { operationId: bulk.operation.id, relationKind: 'VISUAL' } })).toBe(0)
  })
  it('F01 partial choices are manual, excluded from bulk and freeze one pair with either keeper and unchanged per-side SHA', async () => {
    const f = await db!.$transaction(tx => seed(tx, 2))
    const [left, right] = f.members[0]!
    await db!.$transaction(async tx => {
      const r = await relation(tx, f, left!, right!)
      await tx.artworkDedupRelation.delete({ where: { id: r.id } })
    })
    const summary = { evidenceVersion: 'sha256-multiset-overlap-v1', leftArtworkId: left!, rightArtworkId: right!,
      leftFileCount: '5', rightFileCount: '5', pairedCount: '4', exactCount: '4', similarCount: '0',
      leftUnmatchedCount: '1', rightUnmatchedCount: '1', leftUncheckedCount: '0', rightUncheckedCount: '0' }
    const pair = await db!.artworkDedupVisualPair.create({ data: { id: randomUUID(), runId: f.run.id, relationKind: 'PARTIAL', leftArtworkId: left!, rightArtworkId: right!, summary } })
    await db!.artworkDedupGroup.delete({ where: { id: f.groupIds[0]! } })
    await db!.artworkContentFingerprint.update({ where: { artworkId: right! }, data: { contentSha256: 'c'.repeat(64) } })
    await db!.artworkDedupItem.update({ where: { runId_artworkId: { runId: f.run.id, artworkId: right! } }, data: { contentSha256: 'c'.repeat(64) } })
    const choice = (await db!.$transaction(tx => readArtworkDedupGroupChoices(tx, { runId: f.run.id, userId: f.actor.id, groupId: pair.id })))[0]!
    expect(choice).toMatchObject({ relationKind: 'PARTIAL', keeperArtworkId: null, saved: false, reason: 'NEEDS_CHOICE' })
    const freeze = (ids: string[], revision: number) => db!.$transaction(tx => freezeArtworkDedupOperation(tx, { userId: f.actor.id, runId: f.run.id, expectedRunVersion: 1,
      expectedReviewRevision: revision, idempotencyKey: randomUUID(), preparePurpose: 'DIRECT_DELETE', selection: { kind: 'EXPLICIT', groupIds: ids } }))
    await expect(freeze([pair.id], 0)).rejects.toMatchObject({ code: 'EXPLICIT_CHOICE_REQUIRED' })
    for (const [i, keeperArtworkId] of [left!, right!].entries()) {
      await db!.$transaction(tx => saveArtworkDedupReview(tx, { userId: f.actor.id, runId: f.run.id, groupId: pair.id, keeperArtworkId,
        expectedRunVersion: 1, expectedReviewVersion: i, idempotencyKey: randomUUID() }))
      await expect(freeze([pair.id, f.groupIds[1]!], i + 1)).rejects.toMatchObject({ code: 'VISUAL_SINGLE_PAIR_REQUIRED' })
      const { operation } = await freeze([pair.id], i + 1)
      expect(operation).toMatchObject({ protocolVersion: 4, selectedGroups: 1, keepers: 1, copies: 1 })
      const group = await db!.artworkDedupOperationGroup.findFirstOrThrow({ where: { operationId: operation.id } })
      expect(group).toMatchObject({ keeperArtworkId, selectionBasis: 'SAVED', visual: summary })
      expect(await db!.$transaction(tx => validateArtworkDedupOperationSnapshot(tx, operation.id))).toBe(true)
      if (i === 1) {
        await db!.artworkContentFingerprint.update({ where: { artworkId: right! }, data: { contentSha256: 'd'.repeat(64) } })
        expect(await db!.$transaction(tx => validateArtworkDedupOperationSnapshot(tx, operation.id))).toBe(false)
        await db!.artworkContentFingerprint.update({ where: { artworkId: right! }, data: { contentSha256: 'c'.repeat(64) } })
      }
    }
    const bulk = await db!.$transaction(tx => freezeArtworkDedupOperation(tx, { userId: f.actor.id, runId: f.run.id, expectedRunVersion: 1,
      expectedReviewRevision: 2, idempotencyKey: randomUUID(), preparePurpose: 'DIRECT_DELETE', selection: { kind: 'ALL_RECOMMENDED', excludedGroupIds: [] } }))
    expect(await db!.artworkDedupOperationGroup.count({ where: { operationId: bulk.operation.id, relationKind: 'PARTIAL' } })).toBe(0)
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
  it('requires an explicit forward choice for another account’s organized contained work', async () => {
    const f = await db!.$transaction((tx) => seed(tx))
    const [small, large] = f.members[0]!
    const r = await db!.$transaction((tx) => relation(tx, f, small!, large!))
    await db!.artworkLike.create({ data: { artworkId: small!, userId: f.other.id, level: 2 } })
    const choice = (await db!.$transaction((tx) => readArtworkDedupGroupChoices(tx, {
      runId: f.run.id, userId: f.actor.id, groupId: r.id
    })))[0]!
    expect(choice).toMatchObject({ relationKind: 'CONTAINS', keeperArtworkId: null, reason: 'NEEDS_CHOICE', protectedCount: 1 })
    const review = { userId: f.actor.id, runId: f.run.id, groupId: r.id, keeperArtworkId: small!, expectedRunVersion: 1, expectedReviewVersion: 0, idempotencyKey: randomUUID() }
    await expect(db!.$transaction((tx) => saveArtworkDedupReview(tx, review))).rejects.toMatchObject({ code: 'CONTAINMENT_DIRECTION_REQUIRED' })
    await db!.$transaction((tx) => saveArtworkDedupReview(tx, { ...review, keeperArtworkId: large! }))
    const frozen = await db!.$transaction((tx) => freezeArtworkDedupOperation(tx, {
      userId: f.actor.id, runId: f.run.id, expectedRunVersion: 1, expectedReviewRevision: 1,
      preparePurpose: 'DIRECT_DELETE', idempotencyKey: randomUUID(), selection: { kind: 'EXPLICIT', groupIds: [r.id] }
    }))
    expect(frozen.operation).toMatchObject({ protocolVersion: 2, keepers: 1, copies: 1, requiresOrganizationConfirmation: true })
    expect(await db!.artworkDedupOperationGroup.findFirst({ where: { operationId: frozen.operation.id } })).toMatchObject({
      relationKind: 'CONTAINS', containedArtworkId: small, containerArtworkId: large, containedFileCount: 1n, containerFileCount: 2n
    })
  })
  it('deduplicates shared keepers and rejects repeated copies or retain/delete chains before freezing', async () => {
    const f = await db!.$transaction((tx) => seed(tx, 2))
    const [a, b, c, d] = f.members.flat()
    const ab = await db!.$transaction((tx) => relation(tx, f, a!, b!))
    const cb = await db!.artworkDedupRelation.create({ data: { id: randomUUID(), runId: f.run.id, containedArtworkId: c!, containerArtworkId: b!, containedFileCount: 1n, containerFileCount: 2n } })
    const ad = await db!.$transaction((tx) => relation(tx, f, a!, d!))
    const freeze = (ids: string[]) => db!.$transaction((tx) => freezeArtworkDedupOperation(tx, {
      userId: f.actor.id, runId: f.run.id, expectedRunVersion: 1, expectedReviewRevision: 0,
      preparePurpose: 'DIRECT_DELETE', idempotencyKey: randomUUID(), selection: { kind: 'EXPLICIT', groupIds: ids }
    }))
    expect((await freeze([ab.id, cb.id])).operation).toMatchObject({ selectedGroups: 2, keepers: 1, copies: 2 })
    await expect(freeze([ab.id, ad.id])).rejects.toMatchObject({ code: 'CONFLICTING_SELECTION' })
    // The existing exact group retains a while the containment result deletes it.
    await expect(freeze([f.groupIds[0]!, ab.id])).rejects.toMatchObject({ code: 'CONFLICTING_SELECTION' })
    const firstPage = await db!.$transaction((tx) => readArtworkDedupGroupChoices(tx, { runId: f.run.id, userId: f.actor.id, limit: 1 }))
    const nextPage = await db!.$transaction((tx) => readArtworkDedupGroupChoices(tx, { runId: f.run.id, userId: f.actor.id, limit: 100, afterGroupId: firstPage[0]!.groupId }))
    expect([firstPage[0]!.groupId, ...nextPage.map((r) => r.groupId)].sort()).toEqual([...f.groupIds, ab.id, cb.id, ad.id].sort())
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
        db!.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1s'")
          return deleteUserWithArtworkDedupProtection(tx, f.other.id)
        })
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
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1s'")
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "UserBA" WHERE id=${f.other.id} FOR UPDATE`)
        insert.release()
        await deleteUserWithArtworkDedupProtection(tx, f.other.id)
      })
    ).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } })
    await writer
    expect(await db!.mediaMark.count({ where: { userId: f.other.id, artworkId: art } })).toBe(1)
  })
})
