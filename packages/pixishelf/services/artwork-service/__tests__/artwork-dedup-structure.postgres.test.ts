// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', async () => ({
  prisma: (await import('../../../../pixishelf-db/src/__tests__/artwork-dedup-maintenance-fixture')).db
}))
import {
  db,
  seed,
  cleanupFixture,
  prefix
} from '../../../../pixishelf-db/src/__tests__/artwork-dedup-maintenance-fixture'
import { updateArtwork } from '..'
import { reorderArtworkImages } from '../image-manager'
const ops: string[] = [],
  tags: number[] = []
async function fixture() {
  const f = await db!.$transaction((tx) => seed(tx))
  const ids = f.members.flat()
  const source = await db!.tag.create({ data: { name: `${prefix}-${randomUUID()}` } })
  const manual = await db!.tag.create({ data: { name: `${prefix}-${randomUUID()}` } })
  tags.push(source.id, manual.id)
  for (const artworkId of ids) {
    await db!.image.create({ data: { artworkId, path: `${prefix}/${artworkId}-second.jpg`, sortOrder: 1 } })
    await db!.artworkTag.create({ data: { artworkId, tagId: source.id, provenance: 'SOURCE' } })
  }
  return { ...f, ids, source, manual }
}
async function state(ids: number[]) {
  return {
    artworks: await db!.artwork.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } }),
    tags: await db!.artworkTag.findMany({ where: { artworkId: { in: ids } }, orderBy: { id: 'asc' } }),
    creators: await db!.artworkArtist.findMany({
      where: { artworkId: { in: ids } },
      orderBy: [{ artworkId: 'asc' }, { artistId: 'asc' }]
    }),
    images: await db!.image.findMany({ where: { artworkId: { in: ids } }, orderBy: { id: 'asc' } })
  }
}
describe.skipIf(!db)('App metadata and media ordering maintenance guards', () => {
  afterAll(async () => {
    await db?.artworkDedupClaim.deleteMany({ where: { operationId: { in: ops } } })
    await db?.tag.deleteMany({ where: { id: { in: tags } } })
    await cleanupFixture()
  })
  it('rejects all update branches and ordering for keeper/copy without changing rows', async () => {
    const f = await fixture()
    // This suite exercises App writes against a durable Claim, not acquisition/file preparation.
    const op = await db!.artworkDedupOperation.create({
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
    ops.push(op.id)
    await db!.artworkDedupClaim.createMany({
      data: f.ids.map((artworkId, index) => ({
        artworkId,
        operationId: op.id,
        executionVersion: 1,
        role: index ? 'COPY' : 'KEEPER'
      }))
    })
    const before = await state(f.ids)
    for (const artworkId of f.ids) {
      for (const data of [
        { title: 'changed', description: 'changed' },
        { tags: [f.manual.id] },
        { sourceDate: '2020-01-02' },
        { creatorIds: [] },
        { artistId: null }
      ])
        {await expect(updateArtwork(artworkId, data)).rejects.toMatchObject({ code: 'CONFLICT' })}
      const imageIds = before.images.filter((i) => i.artworkId === artworkId).map((i) => i.id)
      await expect(
        reorderArtworkImages({ artworkId, expectedImageIds: imageIds, imageIds: [...imageIds].reverse() })
      ).rejects.toMatchObject({ code: 'CONFLICT' })
    }
    expect(await state(f.ids)).toEqual(before)
  })
  it('preserves unclaimed metadata/tag provenance and the media order comparison', async () => {
    const f = await fixture(),
      artworkId = f.ids[0]!
    await updateArtwork(artworkId, {
      title: 'changed',
      description: 'description',
      sourceDate: '2020-01-02',
      tags: [f.manual.id]
    })
    expect(await db!.artwork.findUniqueOrThrow({ where: { id: artworkId } })).toMatchObject({
      title: 'changed',
      description: 'description',
      titleOverridden: true,
      descriptionOverridden: true,
      sourceDate: new Date('2020-01-02')
    })
    expect(
      await db!.artworkTag.findMany({
        where: { artworkId },
        orderBy: { tagId: 'asc' },
        select: { tagId: true, provenance: true }
      })
    ).toEqual([
      { tagId: f.source.id, provenance: 'SOURCE' },
      { tagId: f.manual.id, provenance: 'MANUAL' }
    ])
    await updateArtwork(artworkId, { tags: [] })
    expect(await db!.artworkTag.findMany({ where: { artworkId }, select: { tagId: true, provenance: true } })).toEqual([
      { tagId: f.source.id, provenance: 'SOURCE' }
    ])
    const imageIds = (
      await db!.image.findMany({ where: { artworkId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })
    ).map((i) => i.id)
    await reorderArtworkImages({ artworkId, expectedImageIds: imageIds, imageIds: [...imageIds].reverse() })
    const after = await db!.image.findMany({
      where: { artworkId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, sortOrder: true }
    })
    expect(after).toEqual([...imageIds].reverse().map((id, sortOrder) => ({ id, sortOrder })))
    await expect(reorderArtworkImages({ artworkId, expectedImageIds: imageIds, imageIds })).rejects.toMatchObject({
      code: 'CONFLICT'
    })
    expect(
      await db!.image.findMany({
        where: { artworkId },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, sortOrder: true }
      })
    ).toEqual(after)
  })
})
