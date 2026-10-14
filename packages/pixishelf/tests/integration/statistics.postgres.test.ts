// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@pixishelf/db'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { exactImageCountSql, optimizedImageCountSql } from '@/services/statistics-queries'
import { diagnoseStatistics } from '@/services/statistics-diagnostics'

const state = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return state.db
  }
}))
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn() } }))
// Cache behavior is tested separately with Next's real unstable_cache.
vi.mock('next/cache', () => ({ unstable_cache: (read: unknown) => read }))
import { loadStatisticsSections } from '@/services/statistics-service'

const url = process.env.STATISTICS_TEST_DATABASE_URL
if (url) {
  const parsed = new URL(url)
  if (
    !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
    !/^\/pixishelf_statistics_test_[a-z0-9_]+$/.test(parsed.pathname)
  ) {
    throw new Error('Statistics tests require a dedicated local pixishelf_statistics_test_* database')
  }
}
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
afterAll(async () => {
  await db?.$disconnect()
})
const rollback = new Error('rollback statistics fixture')
async function fixture(run: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await db!.$transaction(
      async (tx) => {
        state.db = tx
        expect(await tx.artwork.count()).toBe(0)
        expect(await tx.image.count()).toBe(0)
        await run(tx)
        throw rollback
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 180_000 }
    )
  } catch (error) {
    if (error !== rollback) throw error
  }
}
async function counts(tx: Prisma.TransactionClient, expected: number) {
  const [exact] = await tx.$queryRaw<{ count: bigint }[]>(exactImageCountSql)
  const [counter] = await tx.$queryRaw<{ count: bigint }[]>(optimizedImageCountSql)
  expect(exact?.count).toBe(BigInt(expected))
  expect(counter?.count).toBe(exact?.count)
}

describe.skipIf(!url)('statistics on migrated PostgreSQL', () => {
  it('counts empty, unassigned, trashed, inserted, deleted and reassigned images exactly', () =>
    fixture(async (tx) => {
      await counts(tx, 0)
      const a = await tx.artwork.create({ data: { title: randomUUID() } })
      const b = await tx.artwork.create({
        data: { title: randomUUID(), deletedAt: new Date(), archiveLifecycleState: 'TRASHED' }
      })
      await tx.image.createMany({
        data: [
          { path: 'unassigned' },
          { path: 'a1', artworkId: a.id },
          { path: 'a2', artworkId: a.id },
          { path: 'b1', artworkId: b.id }
        ]
      })
      await counts(tx, 4)
      await tx.image.updateMany({ where: { artworkId: a.id }, data: { artworkId: b.id } })
      await counts(tx, 4)
      await tx.image.updateMany({ where: { path: 'unassigned' }, data: { artworkId: a.id } })
      await counts(tx, 4)
      await tx.image.updateMany({ where: { path: 'a1' }, data: { artworkId: null } })
      await counts(tx, 4)
      await tx.image.deleteMany({ where: { artworkId: b.id } })
      await counts(tx, 2)
      await tx.image.deleteMany()
      await counts(tx, 0)
    }))

  it('counts a work once per creator, excludes invalid evidence, merged artists and invisible works', () =>
    fixture(async (tx) => {
      const active = await tx.artist.create({ data: { name: 'active' } })
      const other = await tx.artist.create({ data: { name: 'other' } })
      const merged = await tx.artist.create({ data: { name: 'merged', mergedIntoId: active.id, mergedAt: new Date() } })
      const visible = await tx.artwork.create({ data: { title: 'visible' } })
      const deleted = await tx.artwork.create({ data: { title: 'deleted', deletedAt: new Date() } })
      const trashed = await tx.artwork.create({ data: { title: 'trashed', archiveLifecycleState: 'TRASHED' } })
      for (const [artistId, artworkId, present, excludedAt] of [
        [active.id, visible.id, true, null],
        [active.id, deleted.id, true, null],
        [active.id, trashed.id, true, null],
        [other.id, visible.id, false, null],
        [other.id, deleted.id, true, new Date()]
      ] as const) {
        await tx.artworkArtist.create({
          data: {
            artistId,
            artworkId,
            evidence: {
              create: [
                { evidenceKey: 'one', provenance: 'MANUAL', present, excludedAt },
                { evidenceKey: 'two', provenance: 'LEGACY', present, excludedAt }
              ]
            }
          }
        })
      }
      // Merged artists are counted neither in totals nor rankings.
      expect(merged.mergedIntoId).toBe(active.id)
      const tag = await tx.tag.create({ data: { name: randomUUID() } })
      await tx.artworkTag.create({ data: { artworkId: visible.id, tagId: tag.id } })
      const sections = loadStatisticsSections()
      const [basic, images, artists, tags] = await Promise.all([
        sections.basic,
        sections.images,
        sections.artists,
        sections.tags
      ])
      expect(basic).toEqual({ ok: true, value: { artworks: 3, artists: 2, tags: 1 } })
      expect(images).toEqual({ ok: true, value: 0 })
      expect(artists).toEqual({ ok: true, value: [{ id: active.id, name: 'active', count: 1 }] })
      expect(tags).toEqual({ ok: true, value: [{ id: tag.id, name: tag.name, count: 1 }] })
    }))

  it('passes read-only diagnostics for an empty migrated database', async () => {
    const result = await diagnoseStatistics(db!)
    expect(result.safeToEnable).toBe(true)
    expect(result.totals).toEqual({ exact: 0n, optimized: 0n, mismatchedArtworks: 0n })
  })

  it.skipIf(process.env.STATISTICS_BENCHMARK !== '1')(
    'compares exact and counter plans at 1.42 million images',
    () =>
      fixture(async (tx) => {
        await tx.$executeRaw`INSERT INTO "Artwork" (title, "updatedAt") SELECT 'statistics-fixture', NOW() FROM generate_series(1, 20000)`
        await tx.$executeRaw`INSERT INTO "Image" (path, "artworkId", "updatedAt")
      SELECT 'statistics-fixture/' || a.id || '/' || g, a.id, NOW() FROM "Artwork" a CROSS JOIN generate_series(1, 71) g`
        await tx.$executeRaw`ANALYZE "Artwork"`
        await tx.$executeRaw`ANALYZE "Image"`
        await counts(tx, 1_420_000)
        type PlanNode = { 'Node Type': string; 'Relation Name'?: string; 'Actual Rows'?: number; Plans?: PlanNode[] }
        type Plan = { 'QUERY PLAN': { 'Execution Time': number; Plan: PlanNode }[] }
        const samples: Record<string, number[]> = { exact: [], counter: [] }
        let counterPlan: PlanNode | undefined
        for (let i = 0; i < 6; i++) {
          for (const [name, sql] of [
            ['exact', exactImageCountSql],
            ['counter', optimizedImageCountSql]
          ] as const) {
            const [result] = await tx.$queryRaw<Plan[]>(
              Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON) ${sql}`
            )
            const plan = result!['QUERY PLAN'][0]!
            if (i > 0) samples[name]!.push(plan['Execution Time'])
            if (name === 'counter') counterPlan = plan.Plan
          }
        }
        const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)]
        const imageScans = nodes(counterPlan!).filter((node) => node['Relation Name'] === 'Image')
        expect(imageScans.length).toBeGreaterThan(0)
        expect(imageScans.every((node) => !node['Node Type'].includes('Seq Scan') && node['Actual Rows'] === 0)).toBe(
          true
        )
        process.stdout.write(
          JSON.stringify(
            { fixture: { artworks: 20000, images: 1420000 }, warmSamplesMs: samples, counterPlan },
            null,
            2
          ) + '\n'
        )
      }),
    180_000
  )
})
