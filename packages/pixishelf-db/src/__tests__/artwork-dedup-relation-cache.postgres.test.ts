import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient, type Prisma } from '@prisma/client'
import { assertArtworkDedupCacheDirectories } from '../artwork-dedup-relation-cache'
import { lockCreatorCatalog } from '../creators'
import { lockContentDirectories } from '../media-content-common'
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const upgradeEnabled = process.env.ARTWORK_DEDUP_RELATION_UPGRADE_EXCLUSIVE === '1'
const rollback = new Error('rollback additive cache migration fixture')
describe.skipIf(!db)('F02 relation cache additive migration', () => {
  afterAll(async () => { await db?.$disconnect() })
  it.skipIf(!upgradeEnabled)('preserves nonempty baseline run, original evidence, visual pair and feature cache with safe default misses', async () => {
    const target = new URL(url!)
    if (target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/dedup_relation_core') throw new Error('Dedicated F02 core database required')
    const migration = await readFile(new URL('../../prisma/migrations/20261026000200_artwork_dedup_relation_cache/migration.sql', import.meta.url), 'utf8')
    await expect(db!.$transaction(async tx => {
      const id: string = randomUUID(), artwork = await tx.artwork.create({ data: { title: id } })
      const image = await tx.image.create({ data: { artworkId: artwork.id, path: `${id}/original.png` } })
      const run = await tx.artworkDedupRun.create({ data: { artistId: 1, requestedBy: id, idempotencyKey: id, mode: 'INCREMENTAL', status: 'COMPLETED', stage: 'DONE' } })
      await tx.artworkDedupItem.create({ data: { runId: run.id, artworkId: artwork.id, frozenMediaRevision: 0, status: 'COMPLETE', contentSha256: 'a'.repeat(64), memberCount: 1n } })
      const second = await tx.artwork.create({ data: { title: id } })
      await tx.artworkDedupItem.create({ data: { runId: run.id, artworkId: second.id, frozenMediaRevision: 0 } })
      const pair = await tx.artworkDedupVisualPair.create({ data: { id, runId: run.id, leftArtworkId: artwork.id, rightArtworkId: second.id, summary: { fixture: 'preserve-existing-evidence' } } })
      await tx.mediaVisualFingerprint.create({ data: { imageId: image.id, identity: id, algorithmVersion: 'old-algorithm', normalizationVersion: 'old-normalization', views: [{ fixture: 'old-feature' }] } })
      await tx.$executeRawUnsafe('ALTER TABLE "ArtworkDedupRun" DROP CONSTRAINT artwork_dedup_relation_cache_bounds, DROP COLUMN "relationCacheVersion", DROP COLUMN "visualCandidatePairs", DROP COLUMN "originalReusedPairs", DROP COLUMN "originalComparedPairs", DROP COLUMN "visualReusedComparisons", DROP COLUMN "visualComparedComparisons"')
      await tx.$executeRawUnsafe('ALTER TABLE "ArtworkDedupItem" DROP COLUMN "visualSignature"')
      for (const statement of migration.replace(/^--.*$/gm, '').split(';').filter(s => s.trim())) await tx.$executeRawUnsafe(statement)
      expect(await tx.artworkDedupRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: 'COMPLETED', relationCacheVersion: null, visualCandidatePairs: [], originalReusedPairs: 0, originalComparedPairs: 0, visualReusedComparisons: 0, visualComparedComparisons: 0 })
      expect(await tx.artworkDedupItem.findUniqueOrThrow({ where: { runId_artworkId: { runId: run.id, artworkId: artwork.id } } })).toMatchObject({ visualSignature: null, contentSha256: 'a'.repeat(64), memberCount: 1n })
      expect(await tx.artworkDedupVisualPair.findUniqueOrThrow({ where: { id } })).toEqual(pair)
      expect(await tx.mediaVisualFingerprint.findUniqueOrThrow({ where: { imageId: image.id } })).toMatchObject({ identity: id, views: [{ fixture: 'old-feature' }] })
      throw rollback
    }, { timeout: 20_000 })).rejects.toBe(rollback)
  })
  it('serializes catalog before both roots across directory pages against source release', async () => {
    const id: string = randomUUID(), artwork = await db!.artwork.create({ data: { title: id } })
    const run = await db!.artworkDedupRun.create({ data: { artistId: 1, requestedBy: id, idempotencyKey: id, mode: 'FULL' } })
    const rootKeys = [{ logicalRoot: 'archive-media:v1' as const, rootIdentity: id, relativeDirectory: '' }, { logicalRoot: 'source-media:v1' as const, rootIdentity: id, relativeDirectory: '' }]
    const createdRoots: string[] = []
    try {
      for (const key of rootKeys) {
        const existing = await db!.mediaContentDirectoryState.findUnique({ where: { logicalRoot_relativeDirectory: { logicalRoot: key.logicalRoot, relativeDirectory: '' } } })
        if (existing) key.rootIdentity = existing.rootIdentity
        else { const root = await db!.mediaContentDirectoryState.create({ data: key }); createdRoots.push(root.id) }
      }
      await db!.artworkDedupItem.create({ data: { runId: run.id, artworkId: artwork.id, frozenMediaRevision: 0, status: 'COMPLETE' } })
      for (let n = 0; n < 102; n++) {
        // Source pages sort first by directory ID; archive appears only on page 2.
        const key = rootKeys[n < 101 ? 1 : 0]!, relativeDirectory = `${id}/${n}`
        const directory = await db!.mediaContentDirectoryState.create({ data: { id: `${id}-${String(n).padStart(3, '0')}`, logicalRoot: key.logicalRoot, rootIdentity: key.rootIdentity, relativeDirectory } })
        const image = await db!.image.create({ data: { artworkId: artwork.id, path: `${relativeDirectory}/file` } })
        await db!.artworkDedupMedia.create({ data: { runId: run.id, artworkId: artwork.id, imageId: image.id, sourcePath: image.path, sourceRevision: 0n,
          logicalRoot: key.logicalRoot, rootIdentity: key.rootIdentity, relativeDirectory, directoryId: directory.id, directoryGeneration: directory.generation, canonicalPath: image.path, size: 1n, sha256: 'a'.repeat(64) } })
      }
      let catalogHeld!: () => void, finalCatalogRequested!: () => void
      const catalogReady = new Promise<void>(resolve => { catalogHeld = resolve })
      const finalWaiting = new Promise<void>(resolve => { finalCatalogRequested = resolve })
      const releasing = db!.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1500ms'")
        await lockCreatorCatalog(tx); catalogHeld(); await finalWaiting
        await lockContentDirectories(tx, rootKeys)
      }, { timeout: 5000 })
      await catalogReady
      const finalizing = db!.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1500ms'")
        const proxy = new Proxy(tx, { get(target, prop, receiver) {
          if (prop === '$queryRawUnsafe') return (sql: string, ...args: unknown[]) => {
            if (sql.includes('7341902118')) finalCatalogRequested()
            return target.$queryRawUnsafe(sql, ...args)
          }
          return Reflect.get(target, prop, receiver)
        } }) as Prisma.TransactionClient
        expect(await assertArtworkDedupCacheDirectories(proxy, run.id)).toBe(true)
      }, { timeout: 5000 })
      await Promise.all([releasing, finalizing])
      let archiveHeld!: () => void, finalRootRequested!: () => void
      const archiveReady = new Promise<void>(resolve => { archiveHeld = resolve })
      const finalAtRoots = new Promise<void>(resolve => { finalRootRequested = resolve })
      const rootWriter = db!.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1500ms'")
        await lockContentDirectories(tx, [rootKeys[0]!]); archiveHeld(); await finalAtRoots
        await lockContentDirectories(tx, rootKeys)
      }, { timeout: 5000 })
      await archiveReady
      const pagedFinal = db!.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1500ms'")
        const proxy = new Proxy(tx, { get(target, prop, receiver) {
          if (prop === '$queryRaw') return (sql: Prisma.Sql) => {
            if (sql.sql.includes('"relativeDirectory" =') && sql.sql.includes('FOR UPDATE')) finalRootRequested()
            return target.$queryRaw(sql)
          }
          return Reflect.get(target, prop, receiver)
        } }) as Prisma.TransactionClient
        expect(await assertArtworkDedupCacheDirectories(proxy, run.id)).toBe(true)
      }, { timeout: 5000 })
      await Promise.all([rootWriter, pagedFinal])
    } finally {
      await db!.artworkDedupRun.delete({ where: { id: run.id } })
      await db!.artwork.delete({ where: { id: artwork.id } })
      await db!.mediaContentDirectoryState.deleteMany({ where: { OR: [{ relativeDirectory: { startsWith: id } }, { id: { in: createdRoots } }] } })
    }
  }, 15_000)

})
