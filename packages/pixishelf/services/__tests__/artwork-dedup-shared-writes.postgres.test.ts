// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', async () => ({
  prisma: (await import('../../../pixishelf-db/src/__tests__/artwork-dedup-maintenance-fixture')).db
}))
import {
  editArtworkCreators,
  syncSourceCreators,
  remapCreatorTag,
  captureArtistMerge,
  applyArtistMerge
} from '@pixishelf/db'
import { db, seed, cleanupFixture, prefix } from '../../../pixishelf-db/src/__tests__/artwork-dedup-maintenance-fixture'
import { updateArtist } from '../artist-service'
import { updateTag, deleteTag } from '../tag-service'
import { addArtworkToSeries, removeArtworkFromSeries, updateSeries, deleteSeries } from '../series-service'

const tags: number[] = [],
  seriesIds: number[] = [],
  extraArtists: number[] = [],
  mappings: string[] = [],
  merges: string[] = []
async function fixture() {
  const f = await db!.$transaction((tx) => seed(tx))
  const ids = f.members.flat()
  const tag = await db!.tag.create({ data: { name: `${prefix}-${randomUUID()}` } })
  tags.push(tag.id)
  await db!.artworkTag.createMany({ data: ids.map((artworkId) => ({ artworkId, tagId: tag.id })) })
  const series = await db!.series.create({
    data: { title: prefix, seriesArtworks: { create: ids.map((artworkId, sortOrder) => ({ artworkId, sortOrder })) } }
  })
  seriesIds.push(series.id)
  const target = await db!.artist.create({ data: { name: `${prefix}-target` } })
  extraArtists.push(target.id)
  const ref = await db!.artworkExternalRef.create({
    data: {
      artworkId: ids[0]!,
      providerKey: 'e-hentai',
      externalId: randomUUID(),
      canonicalUrl: 'https://example.test/',
      locator: {}
    }
  })
  const sourceName = `${prefix}-${randomUUID()}`
  await db!.$transaction((tx) =>
    syncSourceCreators(tx, ids[0]!, ref.id, 'e-hentai', [{ namespace: 'artist', name: sourceName }])
  )
  const mapping = await db!.artistSourceTagMapping.findFirstOrThrow({ where: { sourceName } })
  mappings.push(mapping.id)
  extraArtists.push(mapping.artistId)
  const merge = await db!.$transaction(async (tx) => {
    const current = await captureArtistMerge(tx, f.artist.id, target.id)
    return tx.artistMerge.create({
      data: {
        sourceArtistId: f.artist.id,
        targetArtistId: target.id,
        requestedBy: f.actor.id,
        status: 'QUEUED',
        fingerprint: current.fingerprint,
        before: JSON.parse(JSON.stringify(current.before)),
        summary: JSON.parse(JSON.stringify(current.summary))
      }
    })
  })
  merges.push(merge.id)
  const operation = await db!.artworkDedupOperation.create({
    data: {
      runId: f.run.id,
      artistId: f.artist.id,
      requestedBy: f.actor.id,
      idempotencyKey: randomUUID(),
      requestDigest: 'fixture',
      runVersion: 1,
      frozenReviewRevision: 0,
      selectionKind: 'EXPLICIT'
    }
  })
  // The second member is held, proving that whole-set mutations do not stop at the first unclaimed row.
  await db!.artworkDedupClaim.create({
    data: { artworkId: ids[1]!, operationId: operation.id, executionVersion: 1, role: 'COPY' }
  })
  return { ...f, ids, tag, series, target, ref, mapping, merge, operation }
}
async function snapshot(ids: number[]) {
  return {
    artists: await db!.artist.findMany({
      where: { OR: [{ name: { startsWith: prefix } }, { id: { in: extraArtists } }] },
      orderBy: { id: 'asc' }
    }),
    artworks: await db!.artwork.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } }),
    relations: await db!.artworkArtist.findMany({
      where: { artworkId: { in: ids } },
      include: { evidence: { orderBy: { id: 'asc' } } },
      orderBy: { id: 'asc' }
    }),
    tags: await db!.tag.findMany({ where: { id: { in: tags } }, orderBy: { id: 'asc' } }),
    series: await db!.series.findMany({
      where: { id: { in: seriesIds } },
      include: { seriesArtworks: { orderBy: { artworkId: 'asc' } } },
      orderBy: { id: 'asc' }
    })
  }
}
describe.skipIf(!db)('shared writes respect frozen artwork claims', () => {
  afterAll(async () => {
    if (!db) return
    await db.artistMerge.deleteMany({ where: { id: { in: merges } } })
    await db.series.deleteMany({ where: { id: { in: seriesIds } } })
    await db.tag.deleteMany({ where: { id: { in: tags } } })
    await db.artworkArtistEvidence.deleteMany({ where: { tagMappingId: { in: mappings } } })
    await db.artistSourceTagMapping.deleteMany({ where: { id: { in: mappings } } })
    // cleanupFixture disconnects only after the fixture-owned domain rows are removed.
    await db.artworkArtist.deleteMany({ where: { artistId: { in: extraArtists } } })
    await db.artist.deleteMany({ where: { id: { in: extraArtists } } })
    await cleanupFixture()
  })
  it('rejects artist/tag/series cascades with zero domain changes and remains functional after claim release', async () => {
    const f = await fixture()
    const before = await snapshot(f.ids)
    for (const operation of [
      () => updateArtist(f.artist.id, { name: 'changed' }),
      () => updateTag(f.tag.id, { name: 'changed' }),
      () => deleteTag(f.tag.id),
      () => updateSeries(f.series.id, { title: 'changed' }),
      () => deleteSeries(f.series.id),
      () => removeArtworkFromSeries(f.series.id, f.ids[0]!),
      () => addArtworkToSeries(f.series.id, f.ids[0]!),
      () => db!.$transaction((tx) => applyArtistMerge(tx, f.merge.id))
    ]) {
      await expect(operation()).rejects.toSatisfy((error: { code?: string }) =>
        ['CONFLICT', 'ARTWORK_CLAIMED'].includes(error.code ?? '')
      )
      expect(await snapshot(f.ids)).toEqual(before)
    }
    await db!.artworkDedupClaim.deleteMany({ where: { operationId: f.operation.id } })
    await updateArtist(f.artist.id, { name: `${prefix}-updated` })
    await updateTag(f.tag.id, { name: `${prefix}-updated` })
    await updateSeries(f.series.id, { title: `${prefix}-updated` })
    await removeArtworkFromSeries(f.series.id, f.ids[0]!)
    await addArtworkToSeries(f.series.id, f.ids[0]!)
    await deleteSeries(f.series.id)
    await deleteTag(f.tag.id)
    expect(await db!.artist.findUnique({ where: { id: f.artist.id } })).toMatchObject({ name: `${prefix}-updated` })
  })
  it('protects direct creator edits/source evidence/remapping before the first mutation', async () => {
    const f = await fixture()
    await db!.artworkDedupClaim.create({
      data: { artworkId: f.ids[0]!, operationId: f.operation.id, executionVersion: 1, role: 'KEEPER' }
    })
    const before = await snapshot(f.ids)
    for (const operation of [
      () => db!.$transaction((tx) => editArtworkCreators(tx, f.ids[0]!, [f.target.id])),
      () => db!.$transaction((tx) => syncSourceCreators(tx, f.ids[0]!, f.ref.id, 'e-hentai', [])),
      () => db!.$transaction((tx) => remapCreatorTag(tx, f.mapping.id, f.target.id, 1))
    ]) {
      await expect(operation()).rejects.toMatchObject({ code: 'ARTWORK_CLAIMED' })
      expect(await snapshot(f.ids)).toEqual(before)
    }
    await db!.artworkDedupClaim.deleteMany({ where: { operationId: f.operation.id } })
    await db!.$transaction((tx) => remapCreatorTag(tx, f.mapping.id, f.target.id, 1))
    await db!.$transaction((tx) => syncSourceCreators(tx, f.ids[0]!, f.ref.id, 'e-hentai', []))
    await db!.$transaction((tx) => editArtworkCreators(tx, f.ids[0]!, [f.target.id]))
    expect(
      await db!.artworkArtistEvidence.count({
        where: { membership: { artworkId: f.ids[0], artistId: f.target.id }, present: true, excludedAt: null }
      })
    ).toBeGreaterThan(0)
  })
})
