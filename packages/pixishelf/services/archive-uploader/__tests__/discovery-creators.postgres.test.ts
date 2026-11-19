import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PrismaClient,
  activeCreatorMembership,
  consumeDiscoveryCreators,
  lockDiscoveryCreators
} from '@pixishelf/db'
import {
  bindDiscoveryItems,
  setDiscoveryCreators
} from '../discovery-creator-service'
import { listArchiveUploaderScanItems } from '../archive-uploader-service'

vi.mock('server-only', () => ({}))
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const prefix = `discovery-creators-${randomUUID()}`
let sourceId: string
let itemId: string
let artistId: number
let identity: { providerKey: string; externalId: string }
const requestIds: string[] = []
const artistIds: number[] = []
const artworkIds: number[] = []
const requestId = () => {
  const id = randomUUID()
  requestIds.push(id)
  return id
}
async function publish() {
  return db!.$transaction(async (tx) => {
    await lockDiscoveryCreators(tx, identity)
    const artwork = await tx.artwork.create({ data: { title: prefix } })
    artworkIds.push(artwork.id)
    await tx.artworkExternalRef.create({
      data: { ...identity, artworkId: artwork.id, canonicalUrl: 'https://e-hentai.org/g/1/token/', locator: {} }
    })
    await consumeDiscoveryCreators(tx, identity, artwork.id)
    return artwork.id
  })
}
async function effective(artworkId: number) {
  return db!.artworkArtist.findMany({ where: { artworkId, ...activeCreatorMembership } })
}
describe.skipIf(!url)('discovery creator binding PostgreSQL', () => {
  beforeEach(async () => {
    identity = { providerKey: 'e-hentai', externalId: `${prefix}-${randomUUID()}` }
    const artist = await db!.artist.create({ data: { name: prefix } })
    artistId = artist.id
    artistIds.push(artistId)
    const source = await db!.archiveUploaderSource.create({
      data: {
        providerKey: 'e-hentai',
        identityKind: 'NAME',
        identityValue: randomUUID(),
        normalizedIdentity: randomUUID(),
        displayName: prefix
      }
    })
    sourceId = source.id
    const item = await db!.archiveUploaderCatalogItem.create({
      data: {
        ...identity,
        sourceId,
        title: prefix,
        canonicalUrl: 'https://e-hentai.org/g/1/token/',
        relationships: [],
        classification: 'NEW',
        firstSeenAt: new Date(),
        lastSeenAt: new Date()
      }
    })
    itemId = item.id
  })
  afterAll(async () => {
    if (!db) return
    await db.archiveBulkOperation.deleteMany({ where: { idempotencyKey: { in: requestIds } } })
    await db.archiveUploaderSource.deleteMany({ where: { displayName: prefix } })
    await db.discoveryPendingCreator.deleteMany({ where: { artistId: { in: artistIds } } })
    await db.artwork.deleteMany({ where: { id: { in: artworkIds } } })
    await db.artist.deleteMany({ where: { id: { in: artistIds } } })
    await db.$disconnect()
  })
  it('skips unpublished galleries and only fills a still unbound active artwork', async () => {
    const input = { sourceId, itemIds: [itemId], artistIds: [artistId], requestId: requestId() }
    expect((await bindDiscoveryItems(input, 'test', db!))?.counts.skipped).toBe(1)
    expect(await db!.discoveryPendingCreator.count({ where: identity })).toBe(0)
    const artworkId = await publish()
    expect((await bindDiscoveryItems({ ...input, requestId: requestId() }, 'test', db!))?.counts.applied).toBe(1)
    expect((await bindDiscoveryItems({ ...input, requestId: requestId() }, 'test', db!))?.counts.skipped).toBe(1)
    expect((await effective(artworkId)).map((row) => row.artistId)).toEqual([artistId])
  })
  it('filters published artwork by effective creators before counting, including available updates and stale pending rows', async () => {
    const deps = { database: db!, sourceKind: 'ALL' as const }
    const page = () => listArchiveUploaderScanItems({ sourceId, view: 'ALL', unboundOnly: true }, deps)
    await setDiscoveryCreators({ sourceId, artistIds: [artistId] }, db!)
    expect((await page()).counts?.total).toBe(0)
    const artworkId = await publish()
    await db!.discoveryPendingCreator.create({ data: { ...identity, artistId, title: prefix } })
    await db!.archiveUploaderCatalogItem.update({ where: { id: itemId }, data: { classification: 'POSSIBLE_UPDATE' } })
    const unbound = await page()
    expect(unbound.counts).toMatchObject({ total: 1, actionable: 1 })
    expect(unbound.items[0]?.artworkId).toBe(artworkId)
    await bindDiscoveryItems(
      { sourceId, itemIds: [itemId], artistIds: [artistId], requestId: requestId() },
      'test',
      db!
    )
    expect((await page()).items).toEqual([])
    expect(await db!.archiveIntakeItem.count({ where: identity })).toBe(0)
  })
  it('keeps per-item failures and rejects request reuse with another payload or actor', async () => {
    const input = { sourceId, itemIds: [itemId, 'missing'], artistIds: [artistId], requestId: requestId() }
    const result = await bindDiscoveryItems(input, 'test', db!)
    expect(result?.counts).toMatchObject({ skipped: 1, conflict: 1 })
    await expect(bindDiscoveryItems(input, 'another-user', db!)).rejects.toThrow('幂等键')
    await expect(bindDiscoveryItems({ ...input, itemIds: [itemId] }, 'test', db!)).rejects.toThrow('幂等键')
  })
})
