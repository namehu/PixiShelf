import { randomUUID } from 'node:crypto'
import { PrismaClient, type Prisma } from '@pixishelf/db'
import type { CreatorMaintenancePayload } from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext } from '@pixishelf/job-runtime'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { assertPixivSeriesArtworkWritable } from '../series-sync.ts'
import { createPrismaMigrationDatabase } from '../../migration/prisma-database.ts'
import { executeCreatorMaintenance } from '../../maintenance/creator-maintenance.ts'
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const rollback = new Error('rollback dedup shared fixtures')
afterAll(async () => {
  await db?.$disconnect()
})
async function fixture(run: (tx: Prisma.TransactionClient, value: Awaited<ReturnType<typeof seed>>) => Promise<void>) {
  try {
    await db!.$transaction(
      async (tx) => {
        await run(tx, await seed(tx))
        throw rollback
      },
      { timeout: 30_000 }
    )
  } catch (error) {
    if (error !== rollback) throw error
  }
}
async function seed(tx: Prisma.TransactionClient) {
  const prefix = `dedup-shared-${randomUUID()}`
  const artist = await tx.artist.create({ data: { name: prefix } })
  const run = await tx.artworkDedupRun.create({
    data: { artistId: artist.id, requestedBy: prefix, idempotencyKey: randomUUID(), mode: 'FULL' }
  })
  const operation = await tx.artworkDedupOperation.create({
    data: {
      runId: run.id,
      artistId: artist.id,
      requestedBy: prefix,
      idempotencyKey: randomUUID(),
      requestDigest: prefix,
      runVersion: 1,
      frozenReviewRevision: 0,
      selectionKind: 'EXPLICIT'
    }
  })
  const first = await tx.artwork.create({ data: { title: prefix, createdVia: 'MANUAL_CREATE', artistId: artist.id } })
  const second = await tx.artwork.create({ data: { title: prefix } })
  const series = await tx.series.create({
    data: {
      title: prefix,
      externalRefs: { create: { providerKey: 'pixiv', externalId: prefix } },
      seriesArtworks: {
        create: [
          { artworkId: first.id, sortOrder: 1 },
          { artworkId: second.id, sortOrder: 2 }
        ]
      }
    }
  })
  return { prefix, artist, first, second, operation, series }
}
function claim(tx: Prisma.TransactionClient, f: Awaited<ReturnType<typeof seed>>, artworkId: number) {
  return tx.artworkDedupClaim.create({
    data: { artworkId, operationId: f.operation.id, executionVersion: 1, role: 'COPY' }
  })
}
async function execute(tx: Prisma.TransactionClient, planId: string, phase: 'PREVIEW' | 'APPLY') {
  await executeCreatorMaintenance({
    payload: { planId, phase },
    signal: new AbortController().signal,
    finalizeInTransaction: async (work: (scope: unknown) => Promise<unknown>) =>
      work({ transaction: tx, executionStatus: 'RUNNING', complete: vi.fn(), retry: vi.fn() })
  } as unknown as ExecutionContext<CreatorMaintenancePayload, EnqueuedChildJob>)
}
describe.skipIf(!db)('necessary source/series/migration frozen evidence guards', () => {
  it('blocks a shared Pixiv title publication when a different member is claimed', () =>
    fixture(async (tx, f) => {
      await claim(tx, f, f.second.id)
      const before = await tx.series.findUniqueOrThrow({
        where: { id: f.series.id },
        include: { seriesArtworks: true }
      })
      await expect(
        assertPixivSeriesArtworkWritable(tx, f.first.id, { state: 'PRESENT', id: f.prefix, title: 'changed', order: 1 })
      ).rejects.toMatchObject({ code: 'ARTWORK_CLAIMED' })
      expect(
        await tx.series.findUniqueOrThrow({ where: { id: f.series.id }, include: { seriesArtworks: true } })
      ).toEqual(before)
      await tx.artworkDedupClaim.deleteMany({ where: { operationId: f.operation.id } })
      await expect(
        assertPixivSeriesArtworkWritable(tx, f.first.id, { state: 'PRESENT', id: f.prefix, title: 'changed', order: 1 })
      ).resolves.toBeUndefined()
    }))
  it('refuses migration storage-key allocation under Claim with zero metadata writes', () =>
    fixture(async (tx, f) => {
      await claim(tx, f, f.first.id)
      const adapter = createPrismaMigrationDatabase(db!)
      await expect(adapter.loadArtwork(tx, f.first.id, 10)).rejects.toMatchObject({ code: 'ARTWORK_CLAIMED' })
      expect(await tx.artwork.findUniqueOrThrow({ where: { id: f.first.id } })).toEqual(f.first)
      expect(await tx.localImportArtistMapping.count({ where: { artistId: f.artist.id } })).toBe(0)
      await tx.artworkDedupClaim.deleteMany({ where: { operationId: f.operation.id } })
      await expect(adapter.loadArtwork(tx, f.first.id, 10)).resolves.toMatchObject({
        id: f.first.id,
        storageKey: expect.any(String)
      })
    }))
  it('rechecks the actual creator-maintenance SERIES apply branch after preview', () =>
    fixture(async (tx, f) => {
      await tx.seriesArtwork.deleteMany({ where: { seriesId: f.series.id } })
      const plan = await tx.creatorMaintenancePlan.create({
        data: {
          requestedBy: f.prefix,
          command: 'SERIES',
          input: { command: 'SERIES', seriesId: f.series.id, artworkIds: [f.first.id] },
          fingerprint: 'pending',
          maximumArtworkId: f.first.id
        }
      })
      await execute(tx, plan.id, 'PREVIEW')
      await tx.creatorMaintenancePlan.update({ where: { id: plan.id }, data: { status: 'APPLYING' } })
      await claim(tx, f, f.first.id)
      await expect(execute(tx, plan.id, 'APPLY')).rejects.toMatchObject({ code: 'ARTWORK_CLAIMED' })
      expect(await tx.seriesArtwork.count({ where: { seriesId: f.series.id } })).toBe(0)
      expect(await tx.creatorMaintenanceItem.count({ where: { planId: plan.id, status: 'PENDING' } })).toBe(1)
      await tx.artworkDedupClaim.deleteMany({ where: { operationId: f.operation.id } })
      await execute(tx, plan.id, 'APPLY')
      expect(
        await tx.seriesArtwork.findUnique({
          where: { seriesId_artworkId: { seriesId: f.series.id, artworkId: f.first.id } }
        })
      ).toMatchObject({ provenance: 'MANUAL' })
    }))
})
