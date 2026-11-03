// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@pixishelf/db'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const databaseUrl = process.env.DELETION_VALIDATION_DATABASE_URL
if (databaseUrl) {
  const url = new URL(databaseUrl)
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '55439' ||
    url.pathname !== '/pixishelf_delete_validation'
  ) {
    throw new Error('Tag integration tests require the isolated pixishelf_delete_validation database on port 55439')
  }
}
const db = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const context = vi.hoisted(() => ({ prisma: null as unknown }))
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return context.prisma
  }
}))
import { updateArtworkTags } from '@/services/artwork-service/tags'

const prefix = `detail-tags-${randomUUID()}`
const artworkIds: number[] = []
const tagIds: number[] = []
let failTagId = 0
let triggerInstalled = false

beforeAll(() => {
  context.prisma = db
})
afterAll(async () => {
  if (!db) return
  if (triggerInstalled) {
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS detail_tag_test_reject ON "ArtworkTag"')
    await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS detail_tag_test_reject()')
  }
  await db.artwork.deleteMany({ where: { id: { in: artworkIds } } })
  await db.tag.deleteMany({ where: { OR: [{ id: { in: tagIds } }, { name: { startsWith: prefix } }] } })
  await db.$disconnect()
})

async function fixture() {
  const artwork = await db!.artwork.create({ data: { title: prefix } })
  const other = await db!.artwork.create({ data: { title: prefix } })
  artworkIds.push(artwork.id, other.id)
  const sourceRef = await db!.artworkExternalRef.create({
    data: {
      artworkId: artwork.id,
      providerKey: 'fixture',
      externalId: randomUUID(),
      canonicalUrl: 'https://example.invalid/fixture',
      locator: {}
    }
  })
  const entries = [
    ['manual', 'MANUAL'],
    ['source', 'SOURCE'],
    ['source-keep', 'SOURCE'],
    ['derived', 'DERIVED'],
    ['derived-keep', 'DERIVED'],
    ['legacy', 'LEGACY']
  ] as const
  const tags = []
  for (const [suffix, provenance] of entries) {
    const tag = await db!.tag.create({ data: { name: `${prefix}-${randomUUID()}-${suffix}` } })
    tagIds.push(tag.id)
    tags.push(tag)
    await db!.artworkTag.create({
      data: {
        artworkId: artwork.id,
        tagId: tag.id,
        provenance,
        sourceRefId: provenance === 'SOURCE' ? sourceRef.id : null
      }
    })
  }
  await db!.artworkTag.create({ data: { artworkId: other.id, tagId: tags[1]!.id, provenance: 'MANUAL' } })
  return { artworkId: artwork.id, otherId: other.id, tags }
}
const associations = (artworkId: number) => db!.artworkTag.findMany({ where: { artworkId }, orderBy: { id: 'asc' } })

describe.skipIf(!databaseUrl)('detail tag edits with real PostgreSQL transactions', () => {
  it('removes SOURCE and DERIVED associations while preserving every untouched ownership and tag record', async () => {
    const f = await fixture()
    const before = await associations(f.artworkId)
    const removed = [f.tags[1]!.id, f.tags[3]!.id]
    const result = await updateArtworkTags({
      artworkId: f.artworkId,
      addTagIds: [f.tags[0]!.id, f.tags[2]!.id],
      removeTagIds: removed,
      newTagNames: []
    })
    expect(await associations(f.artworkId)).toEqual(before.filter((row) => !removed.includes(row.tagId)))
    expect(result.map((tag) => tag.id)).toEqual(
      before.filter((row) => !removed.includes(row.tagId)).map((row) => row.tagId)
    )
    expect(await db!.tag.count({ where: { id: { in: removed } } })).toBe(2)
    expect(await db!.artworkTag.count({ where: { artworkId: f.otherId, tagId: f.tags[1]!.id } })).toBe(1)
    expect((await db!.tag.findUniqueOrThrow({ where: { id: f.tags[1]!.id } })).artworkCount).toBe(1)
    expect((await db!.tag.findUniqueOrThrow({ where: { id: f.tags[3]!.id } })).artworkCount).toBe(0)
  })

  it('reuses only exact general/name matches and creates differently cased names as MANUAL', async () => {
    const f = await fixture()
    const name = `${prefix}-Exact`
    const general = await db!.tag.create({ data: { namespace: 'general', name } })
    const otherNamespace = await db!.tag.create({ data: { namespace: 'artist', name } })
    tagIds.push(general.id, otherNamespace.id)
    const result = await updateArtworkTags({
      artworkId: f.artworkId,
      addTagIds: [],
      removeTagIds: [],
      newTagNames: [name, name.toLowerCase()]
    })
    expect(result.some((tag) => tag.id === general.id)).toBe(true)
    expect(result.some((tag) => tag.id === otherNamespace.id)).toBe(false)
    expect(await db!.tag.count({ where: { namespace: 'general', name } })).toBe(1)
    const created = await db!.tag.findUniqueOrThrow({
      where: { namespace_name: { namespace: 'general', name: name.toLowerCase() } }
    })
    expect(created.id).not.toBe(general.id)
    expect(
      await db!.artworkTag.findMany({
        where: { artworkId: f.artworkId, tagId: { in: [general.id, created.id] } },
        select: { provenance: true, sourceRefId: true }
      })
    ).toEqual([
      { provenance: 'MANUAL', sourceRefId: null },
      { provenance: 'MANUAL', sourceRefId: null }
    ])
  })

  it('rolls back newly created names, deletions and additions when association insertion fails', async () => {
    const f = await fixture()
    const fault = await db!.tag.create({ data: { name: `${prefix}-fault` } })
    tagIds.push(fault.id)
    failTagId = fault.id
    await db!.$executeRawUnsafe(`CREATE FUNCTION detail_tag_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."tagId" = ${failTagId} THEN RAISE EXCEPTION 'synthetic association failure'; END IF; RETURN NEW; END $$`)
    await db!.$executeRawUnsafe(
      'CREATE TRIGGER detail_tag_test_reject BEFORE INSERT ON "ArtworkTag" FOR EACH ROW EXECUTE FUNCTION detail_tag_test_reject()'
    )
    triggerInstalled = true
    const before = await associations(f.artworkId)
    const name = `${prefix}-rolled-back`
    await expect(
      updateArtworkTags({
        artworkId: f.artworkId,
        addTagIds: [fault.id],
        removeTagIds: [f.tags[1]!.id],
        newTagNames: [name]
      })
    ).rejects.toThrow('synthetic association failure')
    expect(await associations(f.artworkId)).toEqual(before)
    expect(await db!.tag.count({ where: { namespace: 'general', name } })).toBe(0)
    expect((await db!.tag.findUniqueOrThrow({ where: { id: f.tags[1]!.id } })).artworkCount).toBe(2)
  })

  it('rejects inactive works and missing added IDs without leaving new tags', async () => {
    const f = await fixture()
    const name = `${prefix}-not-created`
    await db!.artwork.update({ where: { id: f.artworkId }, data: { archiveLifecycleState: 'TRASHED' } })
    await expect(
      updateArtworkTags({ artworkId: f.artworkId, addTagIds: [], removeTagIds: [], newTagNames: [name] })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await db!.artwork.update({ where: { id: f.artworkId }, data: { archiveLifecycleState: 'ACTIVE' } })
    await expect(
      updateArtworkTags({ artworkId: f.artworkId, addTagIds: [2_147_483_647], removeTagIds: [], newTagNames: [name] })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(await db!.tag.count({ where: { name } })).toBe(0)
    expect(await associations(f.artworkId)).toHaveLength(6)
  })
})
