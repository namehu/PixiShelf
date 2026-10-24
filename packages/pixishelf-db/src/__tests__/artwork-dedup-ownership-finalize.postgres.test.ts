import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { db, seed, prepared, cleanupFixture, cleanupJobs } from './artwork-dedup-maintenance-fixture'
import { completeArtworkDedupPrepare } from '../artwork-dedup-review'
import { refreshArtworkDedupFileOwnership } from '../artwork-dedup-ownership'

const orphanPrefix = `dedup-ownership-late-${randomUUID()}`
describe.skipIf(!db)('PREPARE bounded final ownership diagnostics', () => {
  afterEach(cleanupJobs)
  afterAll(async () => {
    if (db) await db.image.deleteMany({ where: { artworkId: null, path: { startsWith: orphanPrefix } } })
    await cleanupFixture()
  })

  it('validates all unchanged references without rewriting their timestamps', async () => {
    const fixture = await db!.$transaction((tx) => seed(tx, 2))
    const execution = await db!.$transaction((tx) => prepared(tx, fixture))
    const before = new Date('2001-02-03T00:00:00.000Z')
    await db!.artworkDedupOperationFile.updateMany({
      where: { operationId: execution.operationId },
      data: { updatedAt: before }
    })
    const op = await db!.$transaction((tx) => completeArtworkDedupPrepare(tx, { execution }))
    expect(op).toMatchObject({ status: 'READY', preparedFiles: 4n })
    expect(
      await db!.artworkDedupOperationFile.count({ where: { operationId: execution.operationId, updatedAt: before } })
    ).toBe(4)
  })

  it.each([50, 52])(
    'retains %i groups with bounded diagnostics after late cross-role references',
    async (groups) => {
      const total = groups * 2
      const fixture = await db!.$transaction((tx) => seed(tx, groups), { timeout: 30000 })
      const execution = await db!.$transaction((tx) => prepared(tx, fixture), { timeout: 30000 })
      const files = await db!.artworkDedupOperationFile.findMany({
        where: { operationId: execution.operationId },
        orderBy: { fileId: 'asc' }
      })
      expect(files).toHaveLength(total)
      // These external references do not change any frozen Artwork signature.
      await db!.image.createMany({
        data: files.map((file) => ({ path: `${orphanPrefix}/${file.fileId}`, chaptersPath: file.canonicalPath }))
      })
      const op = await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: execution.operationId } })
      await expect(
        db!.$transaction(async (tx) => {
          const changed = await refreshArtworkDedupFileOwnership(tx, {
            operationId: op.id,
            rootBindings: op.rootBindings
          })
          expect(changed).toEqual({ changedFiles: BigInt(total), updatedFiles: 100n, totalFiles: BigInt(total) })
          throw new Error('fixture rollback')
        })
      ).rejects.toThrow('fixture rollback')
      expect(await db!.artworkDedupOperationFile.count({ where: { operationId: op.id, status: 'VERIFIED' } })).toBe(
        total
      )
      const completed = await db!.$transaction((tx) => completeArtworkDedupPrepare(tx, { execution }), {
        timeout: 30000
      })
      expect(completed).toMatchObject({
        status: total > 100 ? 'STALE' : 'FAILED',
        errorCode: total > 100 ? 'OWNERSHIP_CHANGED' : 'INVENTORY_BLOCKED',
        logicalBytes: null,
        preparedFiles: BigInt(total),
        version: 2,
        executionVersion: 1
      })
      expect(await db!.artworkDedupOperationArtwork.count({ where: { operationId: op.id } })).toBe(total)
      expect(await db!.artworkDedupOperationFile.count({ where: { operationId: op.id } })).toBe(total)
      expect(
        await db!.artworkDedupOperationFile.count({
          where: { operationId: op.id, status: 'BLOCKED', ownershipStatus: 'SHARED', blockReason: 'SHARED_PATH' }
        })
      ).toBe(100)
      const diagnosed = await db!.artworkDedupOperationFile.findMany({
        where: { operationId: op.id, status: 'BLOCKED' },
        orderBy: { fileId: 'asc' },
        select: { fileId: true }
      })
      expect(diagnosed.map((row) => row.fileId)).toEqual(files.slice(0, 100).map((row) => row.fileId))
      const state = await db!.$queryRaw<{ count: bigint }[]>(
        Prisma.sql`SELECT count(*) FROM "ArtworkDedupClaim" WHERE "operationId"=${op.id}`
      )
      expect(state[0]!.count).toBe(0n)
    },
    30000
  )
})
