// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('../../../pixishelf-db/src/__tests__/artwork-dedup-maintenance-fixture')).db }))
import { captureArtworkDedupSources, freezeArtworkDedupOperation, saveArtworkDedupReview } from '@pixishelf/db'
import { db, seed, cleanupFixture, prefix } from '../../../pixishelf-db/src/__tests__/artwork-dedup-maintenance-fixture'
import { getArtworkDedupOperation, listArtworkDedupReviewGroups } from '../artwork-dedup-review-service'
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
if (url) {
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/dedup_executor_next') throw new Error('Use the authorized synthetic executor database')
}
const operations: string[] = [], sources: string[] = []
const rootIdentity = `${prefix}-display-root`
describe.skipIf(!db)('B3 durable display PostgreSQL projection', () => {
  afterAll(async () => {
    if (!db) return
    await db.artworkDedupFileReceipt.deleteMany({ where: { operationId: { in: operations } } })
    await db.artworkDedupOperationSource.deleteMany({ where: { operationId: { in: operations } } })
    await db.artworkDedupSourceIdentity.deleteMany({ where: { id: { in: sources } } })
    await db.mediaContentDirectoryState.deleteMany({ where: { rootIdentity } })
    await cleanupFixture()
  })
  it('deduplicates receipts across executions and joins frozen files, distant keeper and removed private records', async () => {
    const f = await db!.$transaction(async (tx) => {
      const value = await seed(tx, 2)
      await tx.artworkDedupGroupMember.updateMany({ where: { groupId: value.groupIds[1]! }, data: { groupId: value.groupIds[0]! } })
      await tx.artworkDedupGroup.delete({ where: { id: value.groupIds[1]! } })
      await tx.artworkDedupGroup.update({ where: { id: value.groupIds[0]! }, data: { memberCount: 4 } })
      await tx.artworkLike.create({ data: { artworkId: value.members[0]![0]!, userId: value.actor.id, level: 2 } })
      await saveArtworkDedupReview(tx, { userId: value.actor.id, runId: value.run.id, groupId: value.groupIds[0]!, keeperArtworkId: value.members[1]![1]!, expectedRunVersion: 1, expectedReviewVersion: 0, idempotencyKey: randomUUID() })
      return value
    })
    const ids = f.members.flat(), keeperId = ids[3]!, copyIds = ids.slice(0, 3)
    const groups = await listArtworkDedupReviewGroups(f.actor.id, { expectedUserId: f.actor.id, runId: f.run.id, limit: 20 }, db!)
    expect(groups.kind).toBe('GROUPS')
    if (groups.kind !== 'GROUPS') throw new Error('Expected groups')
    expect(groups.items[0]!.previewMembers.map((item) => item.artworkId)).toEqual(ids.slice(0, 3))
    expect(groups.items[0]!.keeper?.artworkId).toBe(keeperId)
    const operation = await db!.$transaction(async (tx) => {
      const result = await freezeArtworkDedupOperation(tx, { userId: f.actor.id, runId: f.run.id, expectedRunVersion: 1, expectedReviewRevision: 1, preparePurpose: 'DIRECT_DELETE', selection: { kind: 'EXPLICIT', groupIds: [f.groupIds[0]!] }, idempotencyKey: randomUUID() })
      const op = result.operation
      operations.push(op.id)
      const images = await tx.image.findMany({ where: { artworkId: { in: ids } }, orderBy: { artworkId: 'asc' } })
      for (const image of images) {
        const file = await tx.artworkDedupOperationFile.create({ data: { operationId: op.id, artworkId: image.artworkId!, referenceKey: `media:${image.id}`, role: 'MEDIA', logicalRoot: 'source-media:v1', rootIdentity, canonicalPath: image.path, size: 10n, status: image.artworkId === keeperId ? 'VERIFIED' : 'DELETED', ownershipStatus: 'VERIFIED', inspectionStatus: 'VERIFIED' } })
        if (image.artworkId !== keeperId) await tx.artworkDedupFileReceipt.create({ data: { operationId: op.id, fileId: file.fileId, executionVersion: 1, step: 'DELETE', expectedFileVersion: 1, status: 'COMPLETED' } })
        if (image.artworkId === copyIds[0]) {
          await tx.artworkDedupFileReceipt.create({ data: { operationId: op.id, fileId: file.fileId, executionVersion: 2, step: 'DELETE', expectedFileVersion: 1, status: 'COMPLETED' } })
          await tx.artworkDedupFileReceipt.create({ data: { operationId: op.id, fileId: file.fileId, executionVersion: 2, step: 'MOVE', expectedFileVersion: 1, status: 'COMPLETED' } })
        }
      }
      const [source] = await captureArtworkDedupSources(tx, { identities: [{ kind: 'PATH', logicalRoot: 'source-media:v1', rootIdentity, canonicalPath: `${prefix}/frozen.png` }] })
      sources.push(source!.sourceId)
      await tx.artworkDedupOperationSource.create({ data: { operationId: op.id, artworkId: copyIds[0]!, sourceId: source!.sourceId, frozenGeneration: source!.generation } })
      await tx.artworkDedupSourceIdentity.update({ where: { id: source!.sourceId }, data: { status: 'TOMBSTONE', ownerOperationId: op.id, generation: 17n } })
      await tx.artworkDedupOperationArtwork.updateMany({ where: { operationId: op.id }, data: { fileCount: 1n } })
      await tx.artworkDedupOperationArtwork.updateMany({ where: { operationId: op.id, role: 'COPY' }, data: { status: 'DELETED' } })
      await tx.artworkDedupOperation.update({ where: { id: op.id }, data: { mode: 'DIRECT_DELETE', originalAction: 'DIRECT_DELETE', status: 'DELETED', stage: 'DONE', scopeDigest: 'c'.repeat(64), authorizationDigest: 'd'.repeat(64), directDeleteConfirmedAt: new Date(), externalWritesStoppedAt: new Date(), preparedFiles: 4n, deletedFiles: 3n } })
      return op
    })
    const snapshots = await db!.artworkDedupOperationArtwork.findMany({ where: { operationId: operation.id } })
    await db!.artwork.update({ where: { id: keeperId }, data: { title: 'different live title', source: 'LOCAL_IMPORT', createdAt: new Date('2001-01-01') } })
    await db!.image.deleteMany({ where: { artworkId: { in: copyIds } } })
    await db!.artwork.deleteMany({ where: { id: { in: copyIds } } })
    expect(await db!.artworkDedupFileReceipt.count({ where: { operationId: operation.id } })).toBe(5)
    const response = await getArtworkDedupOperation(f.actor.id, { expectedUserId: f.actor.id, operationId: operation.id, preview: { kind: 'ARTWORKS', limit: 20 } }, db!)
    expect(response.operation.counts).toMatchObject({ deleteIntentFiles: '3', completedCopies: 3, remainingCopies: 0 })
    if (response.preview?.kind !== 'ARTWORKS') throw new Error('Expected artworks')
    for (const item of response.preview.items) {
      const frozen = snapshots.find((row) => row.artworkId === item.artworkId)!
      expect(item).toMatchObject({ title: frozen.title, sourceLabel: frozen.sourceLabel, createdAt: frozen.artworkCreatedAt.toISOString(), mediaCount: '1', fileCount: '1', personalRecords: item.role === 'COPY' ? 'REMOVED' : 'CURRENT' })
    }
    expect(response.preview.items.find((item) => item.artworkId === copyIds[0])!.sources[0]).toMatchObject({ generation: '17', status: 'TOMBSTONE' })
    expect(JSON.stringify(response)).not.toContain('different live title')
    expect(JSON.stringify(response)).not.toContain(f.other.id)
    const files = await getArtworkDedupOperation(f.actor.id, { expectedUserId: f.actor.id, operationId: operation.id, preview: { kind: 'FILES', limit: 20 } }, db!)
    if (files.preview?.kind !== 'FILES') throw new Error('Expected files')
    expect(files.preview.items).toHaveLength(4)
    for (const file of files.preview.items) expect(file).toMatchObject({ artworkRole: file.artworkId === keeperId ? 'KEEPER' : 'COPY', artworkTitle: snapshots.find((row) => row.artworkId === file.artworkId)!.title })
  })
})
