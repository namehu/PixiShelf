import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { readArtworkDedupSharedVisualFingerprints } from '../artwork-dedup-visual'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const rollback = new Error('Rollback shared visual cache fixture')
describe.skipIf(!db)('F02 shared visual content cache', () => {
  afterAll(async () => { await db?.$disconnect() })
  it.skipIf(process.env.ARTWORK_DEDUP_SHARED_UPGRADE_EXCLUSIVE !== '1')('upgrades nonempty old schema without changing legacy identities, JSON or timestamps', async () => {
    const target = new URL(url!)
    if (target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/dedup_shared_cache') throw new Error('Dedicated shared cache fixture required')
    const migration = await readFile(new URL('../../prisma/migrations/20261027000100_artwork_dedup_shared_visual_cache/migration.sql', import.meta.url), 'utf8')
    await expect(db!.$transaction(async tx => {
      await tx.$executeRawUnsafe('ALTER TABLE "MediaVisualFingerprint" DROP COLUMN "contentSha256", DROP COLUMN "contentSize"')
      const image = await tx.image.create({ data: { path: `${randomUUID()}/legacy.png` } })
      await tx.$executeRaw`INSERT INTO "MediaVisualFingerprint" ("imageId", identity, "algorithmVersion", "normalizationVersion", views, "updatedAt")
        VALUES (${image.id}, 'legacy-identity', 'legacy-algorithm', 'legacy-normalization', '[{"legacy":true}]'::jsonb, '2026-01-01'::timestamp)`
      for (const statement of migration.replace(/^--.*$/gm, '').split(';').filter(s => s.trim())) await tx.$executeRawUnsafe(statement)
      expect(await tx.mediaVisualFingerprint.findUniqueOrThrow({ where: { imageId: image.id } })).toEqual({
        imageId: image.id, identity: 'legacy-identity', algorithmVersion: 'legacy-algorithm', normalizationVersion: 'legacy-normalization',
        contentSha256: null, contentSize: null, views: [{ legacy: true }], updatedAt: new Date('2026-01-01')
      })
      expect(await tx.$queryRaw`SELECT indexname FROM pg_indexes WHERE indexname='MediaVisualFingerprint_content_key_idx'`).toHaveLength(1)
      throw rollback
    }, { timeout: 20_000 })).rejects.toBe(rollback)
  })

  it('bounds popular keys to one donor, checks all key fields and rejects oversized pages', async () => {
    await expect(db!.$transaction(async tx => {
      const key = { contentSha256: 'e'.repeat(64), contentSize: 123n, algorithmVersion: randomUUID(), normalizationVersion: 'normalization' }
      const images = await Promise.all(Array.from({ length: 120 }, () => tx.image.create({ data: { path: `${randomUUID()}/donor.png` } })))
      await tx.mediaVisualFingerprint.createMany({ data: images.map(image => ({ ...key, imageId: image.id, identity: 'donor-identity', views: [{ invalid: 'caller must validate JSON' }] })) })
      expect(await readArtworkDedupSharedVisualFingerprints(tx, [key])).toEqual([{ ...key, views: [{ invalid: 'caller must validate JSON' }] }])
      for (const mismatch of [{ contentSize: 124n }, { algorithmVersion: 'obsolete' }, { normalizationVersion: 'obsolete' }, { contentSha256: 'f'.repeat(64) }])
        expect(await readArtworkDedupSharedVisualFingerprints(tx, [{ ...key, ...mismatch }])).toEqual([])
      await expect(readArtworkDedupSharedVisualFingerprints(tx, Array(51).fill(key))).rejects.toThrow('page budget')
      expect(await readArtworkDedupSharedVisualFingerprints(tx, [])).toEqual([])
      // Disabling sequential scans makes index eligibility deterministic on this tiny fixture.
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off')
      const plan = await tx.$queryRaw<Array<{ 'QUERY PLAN': string }>>`EXPLAIN SELECT views FROM "MediaVisualFingerprint"
        WHERE "contentSha256"=${key.contentSha256} AND "contentSize"=${key.contentSize}
          AND "algorithmVersion"=${key.algorithmVersion} AND "normalizationVersion"=${key.normalizationVersion} LIMIT 1`
      expect(plan.map(row => row['QUERY PLAN']).join('\n')).toContain('MediaVisualFingerprint_content_key_idx')
      await tx.image.deleteMany({ where: { id: { in: images.map(image => image.id) } } })
      expect(await readArtworkDedupSharedVisualFingerprints(tx, [key])).toEqual([])
      throw rollback
    }, { timeout: 20_000 })).rejects.toBe(rollback)
  })
})
