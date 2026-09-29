import { randomUUID } from 'node:crypto'
import { PrismaClient, type Prisma } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import {
  activeCreatorMembership,
  editArtworkCreators,
  readSourceCreatorTags,
  remapCreatorTag,
  syncSourceCreators
} from '../creators'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
afterAll(async () => {
  await db?.$disconnect()
})
const rollback = new Error('rollback creator fixtures')
async function fixture(run: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await db!.$transaction(
      async (tx) => {
        await run(tx)
        throw rollback
      },
      { timeout: 30000 }
    )
  } catch (error) {
    if (error !== rollback) throw error
  }
}
async function createSource(tx: Prisma.TransactionClient, artworkId: number) {
  return tx.artworkExternalRef.create({
    data: {
      artworkId,
      providerKey: 'e-hentai',
      externalId: randomUUID(),
      canonicalUrl: 'https://e-hentai.org/g/1/test/',
      locator: {}
    }
  })
}
async function active(tx: Prisma.TransactionClient, artworkId: number) {
  return (
    await tx.artworkArtist.findMany({ where: { artworkId, ...activeCreatorMembership }, orderBy: { artistId: 'asc' } })
  ).map((m) => m.artistId)
}

describe('source creator evidence decoding', () => {
  it('distinguishes missing from known empty and ignores uploader and unrelated tags', () => {
    expect(readSourceCreatorTags({ tags: [] }, {})).toBeNull()
    expect(readSourceCreatorTags({ tags: [] }, { tags: [] })).toEqual([])
    expect(
      readSourceCreatorTags(
        {
          tags: [
            { namespace: 'artist', name: ' A ' },
            { namespace: 'artist', name: 'a' },
            { namespace: 'group', name: 'Circle' },
            { namespace: 'uploader', name: 'someone' }
          ]
        },
        { tags: [] }
      )
    ).toEqual([
      { namespace: 'artist', name: 'a' },
      { namespace: 'group', name: 'circle' }
    ])
    expect(readSourceCreatorTags({ tags: [null] }, { tags: [] })).toBeNull()
  })
})

describe.skipIf(!url)('creator membership PostgreSQL invariants', () => {
  it('seeds old ingestion and preserves storage identity through manual replacement', () =>
    fixture(async (tx) => {
      const old = await tx.artist.create({ data: { name: 'legacy' } })
      const next = await tx.artist.create({ data: { name: 'curated' } })
      const artwork = await tx.artwork.create({
        data: { title: 'local', artistId: old.id, storagePath: 'original/folder' }
      })
      expect(await active(tx, artwork.id)).toEqual([old.id])
      await editArtworkCreators(tx, artwork.id, [next.id])
      expect(await active(tx, artwork.id)).toEqual([next.id])
      expect(await tx.artwork.findUnique({ where: { id: artwork.id } })).toMatchObject({
        artistId: old.id,
        storagePath: 'original/folder'
      })
      await tx.artwork.update({ where: { id: artwork.id }, data: { title: 'rescanned', artistId: old.id } })
      expect(await active(tx, artwork.id)).toEqual([next.id])
    }))

  it('refresh is idempotent; known empty clears only its source while unknown preserves everything', () =>
    fixture(async (tx) => {
      const artwork = await tx.artwork.create({ data: { title: 'archive' } })
      const source = await createSource(tx, artwork.id)
      const tags = [
        { namespace: 'artist' as const, name: randomUUID() },
        { namespace: 'group' as const, name: randomUUID() }
      ]
      await syncSourceCreators(tx, artwork.id, source.id, 'e-hentai', tags)
      await syncSourceCreators(tx, artwork.id, source.id, 'e-hentai', tags)
      expect(await tx.artworkArtistEvidence.count({ where: { sourceRefId: source.id } })).toBe(2)
      const mappings = await tx.artistSourceTagMapping.findMany({
        where: { sourceName: { in: tags.map((t) => t.name) } },
        include: { artist: true }
      })
      expect(mappings.map((m) => m.artist.kind).sort()).toEqual(['GROUP', 'PERSON'])
      const pinned = mappings[0]!.artistId
      await editArtworkCreators(tx, artwork.id, [pinned], 'ADD')
      await syncSourceCreators(tx, artwork.id, source.id, 'e-hentai', null)
      expect(await active(tx, artwork.id)).toHaveLength(2)
      await syncSourceCreators(tx, artwork.id, source.id, 'e-hentai', [])
      expect(await active(tx, artwork.id)).toEqual([pinned])
    }))

  it('remap and undo move only tag evidence, preserve exclusions, and deduplicate aliases', () =>
    fixture(async (tx) => {
      const artwork = await tx.artwork.create({ data: { title: 'archive' } })
      const source = await createSource(tx, artwork.id)
      const tags = [
        { namespace: 'artist' as const, name: randomUUID() },
        { namespace: 'artist' as const, name: randomUUID() }
      ]
      await syncSourceCreators(tx, artwork.id, source.id, 'e-hentai', tags)
      const mappings = await tx.artistSourceTagMapping.findMany({
        where: { sourceName: { in: tags.map((t) => t.name) } },
        orderBy: { id: 'asc' }
      })
      const [first, second] = mappings
      await editArtworkCreators(tx, artwork.id, [first!.artistId], 'ADD')
      await editArtworkCreators(tx, artwork.id, [second!.artistId], 'REMOVE')
      await remapCreatorTag(tx, second!.id, first!.artistId, 1)
      await syncSourceCreators(tx, artwork.id, source.id, 'e-hentai', tags)
      expect(await active(tx, artwork.id)).toEqual([first!.artistId])
      expect(await tx.artworkArtistEvidence.findFirst({ where: { tagMappingId: second!.id } })).toMatchObject({
        excludedAt: expect.any(Date)
      })
      await remapCreatorTag(tx, first!.id, second!.artistId, 1)
      expect(await active(tx, artwork.id)).toHaveLength(2)
      await remapCreatorTag(tx, first!.id, first!.artistId, 2)
      expect(await active(tx, artwork.id)).toEqual([first!.artistId])
      await expect(remapCreatorTag(tx, first!.id, second!.artistId, 1)).rejects.toThrow('来源映射已变化')
    }))

  it('prevents source identity mismatch and person/group conflation', () =>
    fixture(async (tx) => {
      const a = await tx.artwork.create({ data: { title: 'a' } })
      const b = await tx.artwork.create({ data: { title: 'b' } })
      const ref = await createSource(tx, a.id)
      await expect(syncSourceCreators(tx, b.id, ref.id, 'e-hentai', [])).rejects.toThrow('来源身份已变化')
      const name = randomUUID()
      await syncSourceCreators(tx, a.id, ref.id, 'e-hentai', [{ namespace: 'group', name }])
      const mapping = await tx.artistSourceTagMapping.findFirstOrThrow({ where: { sourceName: name } })
      const person = await tx.artist.create({ data: { name } })
      await expect(remapCreatorTag(tx, mapping.id, person.id, 1)).rejects.toThrow('不能互相映射')
    }))
})
