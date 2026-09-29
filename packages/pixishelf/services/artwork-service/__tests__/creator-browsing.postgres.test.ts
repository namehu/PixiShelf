// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { PrismaClient, type Prisma, editArtworkCreators, syncSourceCreators, remapCreatorTag } from '@pixishelf/db'
import { afterAll, describe, expect, it, vi } from 'vitest'
const context = vi.hoisted(() => ({ prisma: null as unknown }))
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return context.prisma
  }
}))
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
import { getNeighboringArtworks } from '../related'
import { buildArtworkWhereClause } from '../query-builder'
import { ArtworksInfiniteQuerySchema } from '@/schemas/artwork.dto'
import { getArtistById, getArtists } from '@/services/artist-service'

const url = process.env.PIXISHELF_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
afterAll(async () => {
  await db?.$disconnect()
})
const rollback = new Error('rollback creator browse fixtures')
async function fixture(run: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await db!.$transaction(
      async (tx) => {
        context.prisma = tx
        await run(tx)
        throw rollback
      },
      { timeout: 30000 }
    )
  } catch (error) {
    if (error !== rollback) throw error
  }
}
describe.skipIf(!url)('creator browsing on PostgreSQL', () => {
  it('uses one selected creator, date fallback and ID ties without mixing another creator timeline', () =>
    fixture(async (tx) => {
      const a = await tx.artist.create({ data: { name: randomUUID() } })
      const group = await tx.artist.create({ data: { name: randomUUID(), kind: 'GROUP' } })
      const date = new Date('2026-01-02T00:00:00Z')
      const works = []
      for (let i = 0; i < 5; i++) {
        const w = await tx.artwork.create({
          data: {
            title: 'w' + i,
            sourceDate: i === 0 ? null : date,
            createdAt: i === 0 ? date : new Date('2026-01-01T00:00:00Z')
          }
        })
        await editArtworkCreators(tx, w.id, i < 3 ? [a.id, group.id] : [group.id])
        works.push(w)
      }
      const cursor = works[1]!.id
      const source = await getNeighboringArtworks({
        artistId: a.id,
        artworkId: cursor,
        limit: 10,
        direction: 'both',
        dateMode: 'source'
      })
      expect(source.map((w) => w.id)).toEqual([works[2]!.id, cursor, works[0]!.id])
      expect(source[0]!.creators.map((c: { id: number }) => c.id)).toEqual([a.id, group.id])
      const created = await getNeighboringArtworks({
        artistId: a.id,
        artworkId: cursor,
        limit: 10,
        direction: 'both',
        dateMode: 'created'
      })
      expect(created.map((w) => w.id)).toEqual([works[0]!.id, works[2]!.id, cursor])
      const unrelated = await getNeighboringArtworks({
        artistId: a.id,
        artworkId: works[4]!.id,
        limit: 10,
        direction: 'both',
        dateMode: 'source'
      })
      expect(unrelated).toEqual([])
      await editArtworkCreators(tx, works[2]!.id, [a.id], 'REMOVE')
      expect(
        await getNeighboringArtworks({
          artistId: a.id,
          artworkId: cursor,
          limit: 10,
          direction: 'newer',
          dateMode: 'source'
        })
      ).toEqual([])
    }))
  it('counts unique active works, finds mapped source names, and ranks by visible memberships', () =>
    fixture(async (tx) => {
      const prefix = randomUUID()
      const first = await tx.artist.create({ data: { name: prefix + '-a' } })
      const second = await tx.artist.create({ data: { name: prefix + '-b' } })
      const w = await tx.artwork.create({ data: { title: prefix, artistId: second.id } })
      const ref = await tx.artworkExternalRef.create({
        data: {
          artworkId: w.id,
          providerKey: 'e-hentai',
          externalId: randomUUID(),
          canonicalUrl: 'https://e-hentai.org/g/1/test/',
          locator: {}
        }
      })
      const sourceName = prefix + '-alias'
      await syncSourceCreators(tx, w.id, ref.id, 'e-hentai', [{ namespace: 'artist', name: sourceName }])
      const mapping = await tx.artistSourceTagMapping.findFirstOrThrow({ where: { sourceName } })
      await remapCreatorTag(tx, mapping.id, first.id, 1)
      await editArtworkCreators(tx, w.id, [first.id], 'ADD')
      await editArtworkCreators(tx, w.id, [second.id], 'REMOVE')
      expect((await getArtistById(first.id))?.artworksCount).toBe(1)
      expect((await getArtistById(second.id))?.artworksCount).toBe(0)
      const ranked = await getArtists({ search: prefix, sortBy: 'artworks_desc', cursor: 1, pageSize: 20 })
      expect(ranked.data[0]?.id).toBe(first.id)
      const { whereSQL, sqlParams } = buildArtworkWhereClause(
        ArtworksInfiniteQuerySchema.parse({ artistName: sourceName, exactMatch: true })
      )
      const rows = await tx.$queryRawUnsafe<Array<{ id: number }>>(
        'SELECT a.id FROM "Artwork" a ' + whereSQL,
        ...sqlParams
      )
      expect(rows.map((row) => row.id)).toEqual([w.id])
      await tx.artwork.update({ where: { id: w.id }, data: { deletedAt: new Date() } })
      expect((await getArtistById(first.id))?.artworksCount).toBe(0)
    }))
})
