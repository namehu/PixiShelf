import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient, type Prisma } from '@prisma/client'
import { buildArtworkDedupPartialPage } from '../artwork-dedup-partial'
import { artworkDedupDirectDeleteScopeDigest } from '../artwork-dedup-direct-delete'
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
// DDL reconstruction is opt-in and must run alone against its dedicated database.
// Ordinary checkpoint tests follow the repository's QUEUE_KERNEL_TEST_DATABASE_URL convention.
const upgradeEnabled = process.env.ARTWORK_DEDUP_PARTIAL_UPGRADE_EXCLUSIVE === '1'
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const rollback = new Error('rollback isolated F01 fixture')
async function statements(tx: Prisma.TransactionClient, sql: string) {
  for (const statement of sql.trim().split(/;\s*(?=(?:--[^\n]*\n\s*)*(?:CREATE|ALTER|DROP)\b)/))
    await tx.$executeRawUnsafe(statement)
}
describe.skipIf(!db).sequential('F01 SQL checkpoints and additive upgrade', () => {
  afterAll(async () => { await db?.$disconnect() })
  it('does not drop high-frequency candidates beyond100 and resumes an atomic checkpoint after rollback', async () => {
    const prefix = randomUUID(), arts: number[] = []
    const job = await db!.systemJob.create({ data: { type: 'ARTWORK_DEDUP_SCAN', definitionVersion: 4, queuePriority: 900, effectivePriority: 900, payload: {} } })
    const run = await db!.artworkDedupRun.create({ data: { artistId: 1, requestedBy: prefix, idempotencyKey: prefix, mode: 'FULL', status: 'RUNNING', stage: 'MATCH', jobId: job.id } })
    const execution = { runId: run.id, jobId: job.id, executionVersion: 1 }
    try {
      for (let n = 0; n < 103; n++) {
        const art = await db!.artwork.create({ data: { title: prefix } }); arts.push(art.id)
        const values = n === 0 ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 100 + n * 2, 101 + n * 2]
        await db!.artworkDedupItem.create({ data: { runId: run.id, artworkId: art.id, frozenMediaRevision: 0, status: 'COMPLETE', memberCount: BigInt(values.length), snapshotRevision: 0n, mediaEpoch: 0n, contentSha256: 'a'.repeat(64), membersSignature: 'b'.repeat(64) } })
        for (const [index, value] of values.entries()) {
          const image = await db!.image.create({ data: { artworkId: art.id, path: `${prefix}/${art.id}/${index}`, sortOrder: index } })
          await db!.artworkDedupMedia.create({ data: { runId: run.id, artworkId: art.id, imageId: image.id, sourcePath: image.path,
            sourceRevision: 0n, logicalRoot: 'source-media:v1', rootIdentity: prefix, relativeDirectory: prefix, directoryId: prefix,
            directoryGeneration: 0n, canonicalPath: image.path, size: BigInt(value), sha256: value.toString(16).padStart(64, '0') } })
        }
      }
      for (let n = 0; n < 51; n++) await db!.$transaction(tx => buildArtworkDedupPartialPage(tx, { execution }))
      const checkpoint = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.id } })
      expect(checkpoint.partialAfterCandidateId).toBe(arts[51])
      await expect(db!.$transaction(async tx => { await buildArtworkDedupPartialPage(tx, { execution }); throw rollback })).rejects.toBe(rollback)
      expect(await db!.artworkDedupVisualPair.count({ where: { runId: run.id } })).toBe(51)
      expect((await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.id } })).partialAfterCandidateId).toBe(checkpoint.partialAfterCandidateId)
      for (let n = 0; n < 51; n++) await db!.$transaction(tx => buildArtworkDedupPartialPage(tx, { execution }))
      expect(await db!.artworkDedupVisualPair.count({ where: { runId: run.id } })).toBe(102)
      expect(await db!.artworkDedupVisualPage.count({ where: { pair: { runId: run.id }, kind: 'EXACT' } })).toBe(408)
      await db!.$transaction(tx => buildArtworkDedupPartialPage(tx, { execution }))
      expect((await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.id } })).partialAfterArtworkId).toBe(arts[0]! + 1)
    } finally {
      await db!.artworkDedupRun.delete({ where: { id: run.id } })
      await db!.systemJob.delete({ where: { id: job.id } })
      await db!.artwork.deleteMany({ where: { id: { in: arts } } })
    }
  }, 30_000)
  it.skipIf(!upgradeEnabled)('upgrades nonempty previous schema preserving historical visual rows, protocol3 and its scope digest', async () => {
    const target = new URL(url!)
    if (target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/dedup_partial_core')
      throw new Error('Run the exclusive upgrade probe only on the dedicated F01 core database')
    const old = await readFile(new URL('../../prisma/migrations/20261025000600_artwork_dedup_visual/migration.sql', import.meta.url), 'utf8')
    const migration = await readFile(new URL('../../prisma/migrations/20261026000100_artwork_dedup_partial/migration.sql', import.meta.url), 'utf8')
    await expect(db!.$transaction(async tx => {
      const id = randomUUID()
      const run = await tx.artworkDedupRun.create({ data: { artistId: 1, requestedBy: id, idempotencyKey: id, mode: 'FULL', status: 'COMPLETED' } })
      await tx.artworkDedupItem.createMany({ data: [1, 2].map(artworkId => ({ runId: run.id, artworkId, frozenMediaRevision: 0 })) })
      const summary = { evidenceVersion: 'dct63-grid3-crop-local1-v1', leftArtworkId: 1, rightArtworkId: 2,
        leftFileCount: '1', rightFileCount: '1', pairedCount: '1', exactCount: '0', similarCount: '1', leftUnmatchedCount: '0', rightUnmatchedCount: '0', leftUncheckedCount: '0', rightUncheckedCount: '0' }
      await tx.artworkDedupVisualPair.create({ data: { id, runId: run.id, leftArtworkId: 1, rightArtworkId: 2, summary } })
      const op = await tx.artworkDedupOperation.create({ data: { runId: run.id, artistId: 1, requestedBy: id, idempotencyKey: id,
        requestDigest: 'a'.repeat(64), runVersion: 1, frozenReviewRevision: 0, selectionKind: 'EXPLICIT', preparePurpose: 'DIRECT_DELETE', protocolVersion: 3 } })
      await tx.artworkDedupOperationGroup.create({ data: { operationId: op.id, groupId: id, keeperArtworkId: 1, reviewVersion: 1, selectionBasis: 'SAVED', status: 'SELECTED', relationKind: 'VISUAL', visual: summary } })
      const job = await tx.systemJob.create({ data: { type: 'ARTWORK_DEDUP_MAINTENANCE', definitionVersion: 4, queuePriority: 900, effectivePriority: 900,
        payload: { operationId: op.id, executionVersion: 1, mode: 'PREPARE', purpose: 'DIRECT_DELETE', protocolVersion: 3 } } })
      const digest = await artworkDedupDirectDeleteScopeDigest(tx, op.id)
      // Reconstruct precisely the prior extension's view and constraints; all DDL rolls back.
      await tx.$executeRawUnsafe('DROP FUNCTION artwork_dedup_group_choices(text,text)')
      await tx.$executeRawUnsafe('DROP VIEW "ArtworkDedupResult"')
      await tx.$executeRawUnsafe('DROP VIEW "ArtworkDedupResultMember"')
      await tx.$executeRawUnsafe('ALTER TABLE "ArtworkDedupVisualPair" DROP COLUMN "relationKind"')
      await tx.$executeRawUnsafe('ALTER TABLE "ArtworkDedupRun" DROP COLUMN "partialAfterArtworkId", DROP COLUMN "partialAfterCandidateId"')
      const views = old.slice(old.indexOf('CREATE VIEW "ArtworkDedupResult"'), old.indexOf('ALTER TABLE "ArtworkDedupRun" DROP CONSTRAINT'))
      await statements(tx, views)
      await statements(tx, old.slice(old.indexOf('ALTER TABLE "ArtworkDedupOperation" DROP CONSTRAINT'), old.indexOf('ALTER TABLE "ArtworkDedupMedia" ADD COLUMN')))
      await statements(tx, migration)
      expect(await tx.artworkDedupVisualPair.findUniqueOrThrow({ where: { id } })).toMatchObject({ relationKind: 'VISUAL', summary })
      expect(await tx.artworkDedupOperation.findUniqueOrThrow({ where: { id: op.id } })).toMatchObject({ protocolVersion: 3 })
      expect(await artworkDedupDirectDeleteScopeDigest(tx, op.id)).toBe(digest)
      expect(await tx.systemJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ definitionVersion: 4, payload: job.payload })
      await tx.$executeRawUnsafe('SAVEPOINT old_protocol')
      await expect(tx.systemJob.update({ where: { id: job.id }, data: { payload: { ...(job.payload as Prisma.JsonObject), protocolVersion: 4 } } })).rejects.toThrow('system_jobs_dedup_policy')
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT old_protocol')
      await tx.systemJob.update({ where: { id: job.id }, data: { definitionVersion: 5, payload: { ...(job.payload as Prisma.JsonObject), protocolVersion: 4 } } })
      throw rollback
    }, { timeout: 30_000 })).rejects.toBe(rollback)
  })
})
