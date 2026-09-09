import { randomUUID } from 'node:crypto'
import { PrismaClient, type Prisma, activeCreatorMembership, editArtworkCreators } from '@pixishelf/db'
import type { CreatorMaintenancePayload } from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext } from '@pixishelf/job-runtime'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { executeCreatorMaintenance } from '../creator-maintenance'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const rollback = new Error('rollback curation test')
afterAll(async () => {
  await db?.$disconnect()
})
async function fixture(run: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await db!.$transaction(
      async (tx) => {
        await run(tx)
        throw rollback
      },
      { timeout: 60000 }
    )
  } catch (error) {
    if (error !== rollback) throw error
  }
}
async function execute(tx: Prisma.TransactionClient, planId: string, phase: 'PREVIEW' | 'APPLY', status = 'RUNNING') {
  const scope = {
    transaction: tx,
    executionStatus: status,
    complete: vi.fn(),
    retry: vi.fn(),
    pause: vi.fn(),
    cancel: vi.fn(),
    release: vi.fn()
  }
  await executeCreatorMaintenance({
    payload: { planId, phase },
    signal: new AbortController().signal,
    finalizeInTransaction: async (run: (value: typeof scope) => Promise<void>) => run(scope)
  } as unknown as ExecutionContext<CreatorMaintenancePayload, EnqueuedChildJob>)
  return scope
}

describe.skipIf(!url)('persistent creator maintenance', () => {
  it('freezes and resumes batches, skips changed evidence, reports unknown sources, and retries idempotently', () =>
    fixture(async (tx) => {
      const ids: number[] = []
      const name = randomUUID()
      for (let i = 0; i < 27; i++) {
        const artwork = await tx.artwork.create({ data: { title: 'preview ' + i, createdVia: 'URL_ARCHIVE' } })
        ids.push(artwork.id)
        if (i === 26) continue
        const ref = await tx.artworkExternalRef.create({
          data: {
            artworkId: artwork.id,
            providerKey: 'e-hentai',
            externalId: randomUUID(),
            canonicalUrl: 'https://e-hentai.org/g/1/test/',
            locator: {}
          }
        })
        await tx.artworkSourceSnapshot.create({
          data: {
            externalRefId: ref.id,
            metadataHash: randomUUID(),
            fetchedAt: new Date(),
            rawMetadata: { tags: ['artist:' + name] },
            normalizedMetadata: { tags: [{ namespace: 'artist', name }] }
          }
        })
      }
      const plan = await tx.creatorMaintenancePlan.create({
        data: {
          requestedBy: 'fixture',
          command: 'BACKFILL',
          input: { command: 'BACKFILL', artworkIds: ids },
          fingerprint: 'pending',
          maximumArtworkId: ids[26]!
        }
      })
      expect((await execute(tx, plan.id, 'PREVIEW')).retry).toHaveBeenCalledOnce()
      expect(await tx.creatorMaintenanceItem.count({ where: { planId: plan.id } })).toBe(25)
      expect((await execute(tx, plan.id, 'PREVIEW')).complete).toHaveBeenCalledOnce()
      expect(await tx.creatorMaintenancePlan.findUnique({ where: { id: plan.id } })).toMatchObject({ status: 'READY' })
      expect((await tx.creatorMaintenanceItem.findFirstOrThrow({ where: { planId: plan.id } })).payload).toMatchObject({
        description: expect.stringContaining(name)
      })
      const manual = await tx.artist.create({ data: { name: 'manual' } })
      await editArtworkCreators(tx, ids[0]!, [manual.id])
      await tx.creatorMaintenancePlan.update({ where: { id: plan.id }, data: { status: 'APPLYING' } })
      expect((await execute(tx, plan.id, 'APPLY', 'PAUSING')).pause).toHaveBeenCalledOnce()
      expect(await tx.creatorMaintenanceItem.count({ where: { planId: plan.id, status: 'PENDING' } })).toBe(27)
      expect((await execute(tx, plan.id, 'APPLY')).retry).toHaveBeenCalledOnce()
      expect((await execute(tx, plan.id, 'APPLY', 'CANCELLING')).cancel).toHaveBeenCalledOnce()
      expect((await execute(tx, plan.id, 'APPLY')).complete).toHaveBeenCalledOnce()
      const counts = await tx.creatorMaintenanceItem.groupBy({
        by: ['status'],
        where: { planId: plan.id },
        _count: true
      })
      expect(Object.fromEntries(counts.map((c) => [c.status, c._count]))).toEqual({ SUCCESS: 25, STALE: 1, UNKNOWN: 1 })
      const source = await tx.artistSourceTagMapping.findFirstOrThrow({ where: { sourceName: name } })
      expect(await tx.artworkArtist.count({ where: { artistId: source.artistId, ...activeCreatorMembership } })).toBe(
        25
      )
      await execute(tx, plan.id, 'APPLY')
      expect(await tx.artworkArtist.count({ where: { artistId: source.artistId, ...activeCreatorMembership } })).toBe(
        25
      )
    }))
})
