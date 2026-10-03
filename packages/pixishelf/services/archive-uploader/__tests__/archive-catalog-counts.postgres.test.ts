import { randomUUID, createHash } from 'node:crypto'
import { Prisma, PrismaClient } from '@pixishelf/db'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { getArchiveUploaderCatalogCounts, listArchiveUploaderCatalogState } from '../archive-uploader-catalog-state'

vi.mock('server-only', () => ({}))
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const postgres = db ? describe.sequential : describe.skip
const rollback = new Error('fixture rollback')
async function fixture(run: (tx: Prisma.TransactionClient, sourceId: string, submissionId: string) => Promise<void>) {
  await expect(
    db!.$transaction(
      async (tx) => {
        const id = randomUUID()
        await tx.archiveUploaderSource.create({
          data: {
            id,
            providerKey: 'e-hentai',
            displayName: 'Counts fixture',
            identityKind: 'NAME',
            identityValue: id,
            normalizedIdentity: id
          }
        })
        await tx.archiveIntakeSubmission.create({
          data: { id, idempotencyKey: id, requestHash: 'a'.repeat(64), rawCount: 1, acceptedCount: 1 }
        })
        await run(tx, id, id)
        throw rollback
      },
      { timeout: 30000 }
    )
  ).rejects.toBe(rollback)
}
async function expectUnindexedEquivalent(tx: Prisma.TransactionClient, sourceId: string) {
  const read = async () => ({
    counts: await getArchiveUploaderCatalogCounts(tx as PrismaClient, [sourceId]),
    items: await listArchiveUploaderCatalogState(tx as PrismaClient, { sourceId, view: 'ALL', limit: 50 })
  })
  const indexed = await read()
  // DDL is rolled back with the fixture; no other database is used by this suite.
  await tx.$executeRaw`DROP INDEX archive_intake_items_submitted_url_hash_idx`
  await tx.$executeRaw`DROP INDEX archive_intake_items_canonical_url_hash_idx`
  expect(await read()).toEqual(indexed)
}
const now = new Date('2026-10-03T00:00:00Z')
afterAll(async () => {
  await db?.$disconnect()
})
postgres('indexed catalog state matching', () => {
  it('has both nonunique Hash indexes in the migrated database', async () => {
    const indexes = await db!.$queryRaw<Array<{ name: string; method: string; unique: boolean; valid: boolean }>>`
      SELECT c.relname AS name, a.amname AS method, i.indisunique AS unique, i.indisvalid AS valid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_am a ON a.oid = c.relam
      WHERE c.relname IN ('archive_intake_items_submitted_url_hash_idx', 'archive_intake_items_canonical_url_hash_idx')`
    expect(indexes).toHaveLength(2)
    for (const index of indexes) expect(index).toMatchObject({ method: 'hash', unique: false, valid: true })
  })

  it.each(['id', 'identity', 'submitted', 'canonical', 'long-url', 'multiple'] as const)(
    'preserves %s matching and aggregate/list agreement',
    async (mode) => {
      await fixture(async (tx, sourceId, submissionId) => {
        const externalId = randomUUID()
        const canonicalUrl = `https://example.test/${mode === 'long-url' ? Array.from({ length: 120 }, () => randomUUID()).join('') : externalId}`
        const intake = await tx.archiveIntakeItem.create({
          data: {
            submissionId,
            status: 'READY',
            normalizedUrlHash: createHash('sha256').update(externalId).digest('hex'),
            submittedUrl: ['submitted', 'long-url', 'multiple'].includes(mode)
              ? canonicalUrl
              : 'https://example.test/unrelated',
            canonicalUrl: ['canonical', 'multiple'].includes(mode) ? canonicalUrl : null,
            providerKey: ['identity', 'multiple'].includes(mode) ? 'e-hentai' : null,
            externalId: ['identity', 'multiple'].includes(mode) ? externalId : null
          }
        })
        await tx.archiveUploaderCatalogItem.create({
          data: {
            sourceId,
            providerKey: 'e-hentai',
            externalId,
            canonicalUrl,
            title: 'fixture',
            relationships: [],
            classification: 'NEW',
            firstSeenAt: now,
            lastSeenAt: now,
            lastIntakeItemId: ['id', 'multiple'].includes(mode) ? intake.id : null
          }
        })
        const client = tx as PrismaClient
        const counts = await getArchiveUploaderCatalogCounts(client, [sourceId])
        expect(counts.get(sourceId)).toEqual({ actionable: 0, processing: 1, archived: 0, attention: 0, total: 1 })
        const result = await listArchiveUploaderCatalogState(client, { sourceId, view: 'PROCESSING', limit: 50 })
        expect(result.items).toHaveLength(1)
        expect(result.items[0]).toMatchObject({ intakeItemId: intake.id, workflowStage: 'READY' })
        await expectUnindexedEquivalent(tx, sourceId)
      })
    }
  )

  it('preserves active candidate priority, last-outcome boundaries and explicit ID precedence', async () => {
    await fixture(async (tx, sourceId, submissionId) => {
      const externalId = randomUUID()
      const canonicalUrl = `https://example.test/${externalId}`
      const base = { submissionId, submittedUrl: canonicalUrl, providerKey: 'e-hentai', externalId }
      const ready = await tx.archiveIntakeItem.create({
        data: { ...base, status: 'READY', normalizedUrlHash: 'a'.repeat(64), updatedAt: now }
      })
      const failed = await tx.archiveIntakeItem.create({
        data: {
          ...base,
          status: 'FAILED',
          normalizedUrlHash: 'b'.repeat(64),
          updatedAt: new Date(now.getTime() + 1000)
        }
      })
      const catalog = await tx.archiveUploaderCatalogItem.create({
        data: {
          sourceId,
          providerKey: 'e-hentai',
          externalId,
          canonicalUrl,
          title: 'fixture',
          relationships: [],
          classification: 'NEW',
          firstSeenAt: now,
          lastSeenAt: now
        }
      })
      const list = () => listArchiveUploaderCatalogState(tx as PrismaClient, { sourceId, view: 'ALL', limit: 50 })
      expect((await list()).items[0]?.intakeItemId).toBe(ready.id)
      await tx.archiveUploaderCatalogItem.update({ where: { id: catalog.id }, data: { lastOutcomeAt: now } })
      expect((await list()).items[0]?.intakeItemId).toBe(failed.id)
      await tx.archiveUploaderCatalogItem.update({
        where: { id: catalog.id },
        data: { lastOutcomeAt: failed.updatedAt }
      })
      expect((await list()).items[0]).toMatchObject({ intakeItemId: null, workflowStage: 'NEW' })
      await tx.archiveUploaderCatalogItem.update({ where: { id: catalog.id }, data: { lastIntakeItemId: ready.id } })
      expect((await list()).items[0]?.intakeItemId).toBe(ready.id)
      await expectUnindexedEquivalent(tx, sourceId)
    })
  })
})
