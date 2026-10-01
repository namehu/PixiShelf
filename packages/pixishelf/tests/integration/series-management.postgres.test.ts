// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@pixishelf/db'
import {
  observePixivSeriesState,
  reconcilePixivArtworkSeries
} from '../../../pixishelf-job-executors/src/pixiv-artwork/series-sync'

const url = process.env.SERIES_VALIDATION_DATABASE_URL
if (url) {
  const parsed = new URL(url)
  if (
    !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
    !parsed.pathname.startsWith('/series_management_validation_')
  ) {
    throw new Error('Series tests require a dedicated local series_management_validation_* database')
  }
}
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const context = vi.hoisted(() => ({ prisma: null as unknown }))
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return context.prisma
  }
}))
let service: typeof import('@/services/series-management-service')
let legacy: typeof import('@/services/series-service')
let seriesId = 0
let ids: number[] = []
let sourceRefId = ''
let externalId = ''
beforeAll(async () => {
  context.prisma = db
  service = await import('@/services/series-management-service')
  legacy = await import('@/services/series-service')
})
beforeEach(async () => {
  if (!db) return
  const token = randomUUID()
  seriesId = (await db.series.create({ data: { title: `series validation ${token}` } })).id
  externalId = token
  await db.seriesExternalRef.create({ data: { seriesId, providerKey: 'pixiv', externalId } })
  const artworks = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      db.artwork.create({ data: { title: `series test ${i}`, storageKey: `series-test-${token}-${i}` } })
    )
  )
  ids = artworks.map((a) => a.id)
  sourceRefId = (
    await db.artworkExternalRef.create({
      data: {
        artworkId: ids[0]!,
        providerKey: 'pixiv',
        externalId: token,
        canonicalUrl: 'https://www.pixiv.net/artworks/1',
        locator: {}
      }
    })
  ).id
  await db.seriesArtwork.createMany({
    data: [
      { seriesId, artworkId: ids[0]!, sortOrder: 1, provenance: 'SOURCE', sourceRefId, sourceOrder: 1 },
      { seriesId, artworkId: ids[1]!, sortOrder: 2, provenance: 'MANUAL' },
      { seriesId, artworkId: ids[2]!, sortOrder: 3, provenance: 'LEGACY' }
    ]
  })
})
afterEach(async () => {
  if (db) {
    await db.series.deleteMany({ where: { id: seriesId } })
    await db.artwork.deleteMany({ where: { id: { in: ids } } })
  }
})
afterAll(async () => {
  await db?.$disconnect()
})
async function save(finalArtworkIds: number[], explicitReorder = false) {
  const baseline = await service.getSeriesManagementDetail(seriesId)
  return service.saveSeriesManagementChanges({
    seriesId,
    expectedFingerprint: baseline.membershipFingerprint,
    finalArtworkIds,
    explicitReorder
  })
}
describe.skipIf(!url)('series management on isolated PostgreSQL', () => {
  it('loads and saves 2,000 lightweight members without returning their media lists', async () => {
    const token = randomUUID()
    await db!.artwork.createMany({
      data: Array.from({ length: 1997 }, (_, index) => ({
        title: `large series ${index}`,
        storageKey: `series-load-${token}-${index}`
      }))
    })
    const extra = await db!.artwork.findMany({
      where: { storageKey: { startsWith: `series-load-${token}-` } },
      select: { id: true },
      orderBy: { id: 'asc' }
    })
    ids.push(...extra.map((row) => row.id))
    await db!.seriesArtwork.createMany({
      data: extra.map((row, index) => ({ seriesId, artworkId: row.id, sortOrder: index + 4, provenance: 'MANUAL' }))
    })
    const loaded = await service.getSeriesManagementDetail(seriesId)
    expect(loaded.artworks).toHaveLength(2000)
    expect(loaded.artworks[0]).not.toHaveProperty('images')
    const finalArtworkIds = loaded.artworks.map((row) => row.id).reverse()
    await service.saveSeriesManagementChanges({
      seriesId,
      expectedFingerprint: loaded.membershipFingerprint,
      finalArtworkIds,
      explicitReorder: true
    })
    expect((await service.getSeriesManagementDetail(seriesId)).artworks.map((row) => row.id)).toEqual(finalArtworkIds)
  }, 20_000)
  it('atomically excludes SOURCE, deletes manual relations, appends and restores source positions', async () => {
    await save([ids[2]!, ids[3]!])
    expect(await db!.artwork.count({ where: { id: { in: ids } } })).toBe(4)
    expect(
      await db!.seriesArtwork.findUnique({ where: { seriesId_artworkId: { seriesId, artworkId: ids[0]! } } })
    ).toMatchObject({ excludedAt: expect.any(Date), provenance: 'SOURCE', sortOrder: 1 })
    await save([ids[0]!, ids[2]!, ids[3]!])
    const restored = await db!.seriesArtwork.findUniqueOrThrow({
      where: { seriesId_artworkId: { seriesId, artworkId: ids[0]! } }
    })
    expect(restored).toMatchObject({
      excludedAt: null,
      provenance: 'SOURCE',
      sourceRefId,
      sortOrder: 1,
      orderOverridden: false
    })
  })
  it('commits only one of two drafts from the same fingerprint', async () => {
    const baseline = await service.getSeriesManagementDetail(seriesId)
    const outcomes = await Promise.allSettled(
      [
        [ids[2]!, ids[1]!, ids[0]!],
        [ids[1]!, ids[0]!, ids[2]!]
      ].map((finalArtworkIds) =>
        service.saveSeriesManagementChanges({
          seriesId,
          expectedFingerprint: baseline.membershipFingerprint,
          finalArtworkIds,
          explicitReorder: true
        })
      )
    )
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'CONFLICT' } })
  })
  it('rejects a draft after a concurrent legacy append or soft deletion without excluding anything', async () => {
    const baseline = await service.getSeriesManagementDetail(seriesId)
    await legacy.addArtworkToSeries(seriesId, ids[3]!)
    await expect(
      service.saveSeriesManagementChanges({
        seriesId,
        expectedFingerprint: baseline.membershipFingerprint,
        finalArtworkIds: [],
        explicitReorder: false
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await db!.seriesArtwork.count({ where: { seriesId, excludedAt: null } })).toBe(4)
    const latest = await service.getSeriesManagementDetail(seriesId)
    await db!.artwork.update({ where: { id: ids[1]! }, data: { deletedAt: new Date() } })
    await expect(
      service.saveSeriesManagementChanges({
        seriesId,
        expectedFingerprint: latest.membershipFingerprint,
        finalArtworkIds: ids.slice(0, 3),
        explicitReorder: true
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
  it('rolls back all relation edits when the batch update fails', async () => {
    const baseline = await service.getSeriesManagementDetail(seriesId)
    await db!.$executeRawUnsafe(
      `CREATE FUNCTION series_validation_reject_order() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."orderOverridden" THEN RAISE EXCEPTION 'validation failure'; END IF; RETURN NEW; END $$`
    )
    await db!.$executeRawUnsafe(
      'CREATE TRIGGER series_validation_reject_order BEFORE UPDATE ON "SeriesArtwork" FOR EACH ROW EXECUTE FUNCTION series_validation_reject_order()'
    )
    try {
      await expect(
        service.saveSeriesManagementChanges({
          seriesId,
          expectedFingerprint: baseline.membershipFingerprint,
          finalArtworkIds: [ids[2]!, ids[3]!],
          explicitReorder: true
        })
      ).rejects.toThrow()
      expect((await service.getSeriesManagementDetail(seriesId)).membershipFingerprint).toBe(
        baseline.membershipFingerprint
      )
    } finally {
      await db!.$executeRawUnsafe('DROP TRIGGER series_validation_reject_order ON "SeriesArtwork"')
      await db!.$executeRawUnsafe('DROP FUNCTION series_validation_reject_order()')
    }
  })
  it('protects local order against real Pixiv reconciliation and stale refresh observations', async () => {
    const observed = await observePixivSeriesState(db!, externalId, ids[0]!)
    await save([ids[2]!, ids[1]!, ids[0]!], true)
    for (const refreshExisting of [false, true]) {
      const result = await db!.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Artwork" WHERE id = ${ids[0]!} FOR UPDATE`
        return reconcilePixivArtworkSeries(tx, {
          artworkId: ids[0]!,
          artworkExternalRefId: sourceRefId,
          observation: { state: 'PRESENT', id: externalId, title: 'remote title', order: 9 },
          checkedAt: new Date(),
          jobId: 'series-validation',
          refreshExisting,
          observedSeries: observed
        })
      })
      expect(result.protectedFields).toContain('order')
    }
    expect(await db!.seriesArtwork.findUnique({ where: { sourceRefId } })).toMatchObject({
      sortOrder: 3,
      orderOverridden: true
    })
  })
  it('waits for Pixiv publication holding Artwork and refuses its changed baseline', async () => {
    const baseline = await service.getSeriesManagementDetail(seriesId)
    let release!: () => void
    let entered!: () => void
    const locked = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const publisher = db!.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Artwork" WHERE id = ${ids[0]!} FOR UPDATE`
      await tx.seriesArtwork.update({ where: { sourceRefId }, data: { sourceOrder: 9, sortOrder: 9 } })
      entered()
      await gate
    })
    await locked
    const saving = service.saveSeriesManagementChanges({
      seriesId,
      expectedFingerprint: baseline.membershipFingerprint,
      finalArtworkIds: [ids[2]!, ids[1]!, ids[0]!],
      explicitReorder: true
    })
    release()
    await publisher
    await expect(saving).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await db!.seriesArtwork.findUnique({ where: { sourceRefId } })).toMatchObject({
      sourceOrder: 9,
      sortOrder: 9,
      orderOverridden: false
    })
  })
  it('serializes creator-maintenance insertion through the Series foreign-key lock', async () => {
    const baseline = await service.getSeriesManagementDetail(seriesId)
    let release!: () => void
    let entered!: () => void
    const locked = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const maintenance = db!.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Series" WHERE id = ${seriesId} FOR UPDATE`
      entered()
      await gate
      await tx.seriesArtwork.create({ data: { seriesId, artworkId: ids[3]!, sortOrder: 4, provenance: 'MANUAL' } })
    })
    await locked
    const saving = service.saveSeriesManagementChanges({
      seriesId,
      expectedFingerprint: baseline.membershipFingerprint,
      finalArtworkIds: [...ids],
      explicitReorder: false
    })
    release()
    await maintenance
    await expect(saving).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await db!.seriesArtwork.count({ where: { seriesId } })).toBe(4)
  })
})
