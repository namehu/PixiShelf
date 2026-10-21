import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import { beginSummaryImageWrite, checkArtworkSummarySource, summarySourceKey } from '../artwork-summary'
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const database = url ? new PrismaClient({ datasourceUrl: url }) : null
const suite = url ? describe : describe.skip
const rollback = new Error('rollback summary fixture')
afterAll(async () => { await database?.$disconnect() })
suite('summary source invalidation', () => {
  it('invalidates real edits but not routine timestamp refreshes, and fences controlled writes', async () => {
    try {
      await database!.$transaction(async (tx) => {
        const artwork = await tx.artwork.create({ data: { title: 'summary fixture' } })
        const image = await tx.image.create({ data: { path: '/summary-fixture.png', artworkId: artwork.id, sortOrder: 0 } })
        await tx.artworkSummary.create({ data: { artworkId: artwork.id, publishedRevision: 0 } })
        const state = { size: 100n, mtimeMs: 1n, ctimeMs: 2n, deviceId: 3n, inode: 4n }
        await tx.artworkSummaryFeature.create({ data: { imageId: image.id, sourceKey: summarySourceKey(image.path, state) } })
        const revision = async () => (await tx.artworkSummary.findUniqueOrThrow({ where: { artworkId: artwork.id } })).sourceRevision
        await tx.image.update({ where: { id: image.id }, data: { updatedAt: new Date() } })
        expect(await revision()).toBe(0)
        await checkArtworkSummarySource(tx, image.id, image.path, state)
        expect(await revision()).toBe(0)
        await checkArtworkSummarySource(tx, image.id, image.path, { ...state, inode: 5n })
        expect(await revision()).toBe(1)
        await tx.image.update({ where: { id: image.id }, data: { sortOrder: 1 } })
        expect(await revision()).toBe(2)
        await beginSummaryImageWrite(tx, image.id, artwork.id)
        expect(await revision()).toBe(3)
        expect((await tx.artworkSummaryFeature.findUniqueOrThrow({ where: { imageId: image.id } })).writeInProgress).toBe(true)
        await tx.image.create({ data: { path: '/summary-new.png', artworkId: artwork.id } })
        expect(await revision()).toBe(4)
        await tx.image.delete({ where: { id: image.id } })
        expect(await revision()).toBe(5)
        throw rollback
      })
    } catch (error) { if (error !== rollback) throw error }
  })
})
