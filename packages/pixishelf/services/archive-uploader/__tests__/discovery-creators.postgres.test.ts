import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PrismaClient,
  activeCreatorMembership,
  consumeDiscoveryCreators,
  editArtworkCreators,
  lockDiscoveryCreators
} from '@pixishelf/db'
import {
  bindDiscoveryItems,
  cancelPendingCreators,
  listPendingCreators,
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
  it('deduplicates across sources, survives source deletion and supports orphan cancellation', async () => {
    const input = { sourceId, itemIds: [itemId], artistIds: [artistId, artistId], requestId: requestId() }
    expect((await bindDiscoveryItems(input, 'test', db!))?.counts.created).toBe(1)
    const other = await db!.archiveUploaderSource.create({
      data: {
        providerKey: 'e-hentai',
        displayName: prefix,
        identityKind: 'NAME',
        identityValue: randomUUID(),
        normalizedIdentity: randomUUID()
      }
    })
    const item = await db!.archiveUploaderCatalogItem.create({
      data: {
        ...identity,
        sourceId: other.id,
        title: prefix,
        canonicalUrl: 'https://e-hentai.org/g/1/token/',
        relationships: [],
        classification: 'NEW',
        firstSeenAt: new Date(),
        lastSeenAt: new Date()
      }
    })
    await bindDiscoveryItems({ ...input, sourceId: other.id, itemIds: [item.id], requestId: requestId() }, 'test', db!)
    expect(await db!.discoveryPendingCreator.count({ where: identity })).toBe(1)
    await db!.archiveUploaderSource.delete({ where: { id: sourceId } })
    expect((await bindDiscoveryItems(input, 'test', db!))?.counts.created).toBe(1)
    const pending = (await listPendingCreators({ limit: 100 }, db!)).items.find(
      (row) => row.externalId === identity.externalId
    )!
    expect(pending.artist.id).toBe(artistId)
    await cancelPendingCreators({ pendingIds: [pending.id], requestId: requestId() }, 'test', db!)
    expect(await db!.discoveryCreatorSuppression.count({ where: identity })).toBe(1)
  })
  it('serializes binding against publication in both orders and prevents replay after removal', async () => {
    const input = { sourceId, itemIds: [itemId], artistIds: [artistId], requestId: requestId() }
    const [, artworkId] = await Promise.all([bindDiscoveryItems(input, 'test', db!), publish()])
    expect((await effective(artworkId)).map((row) => row.artistId)).toEqual([artistId])
    expect(await db!.discoveryPendingCreator.count({ where: identity })).toBe(0)
    await db!.$transaction((tx) => editArtworkCreators(tx, artworkId, [artistId], 'REMOVE'))
    await bindDiscoveryItems(input, 'test', db!)
    expect(await effective(artworkId)).toEqual([])
    expect((await bindDiscoveryItems({ ...input, requestId: requestId() }, 'test', db!))?.counts.applied).toBe(1)
    expect(await db!.discoveryCreatorSuppression.count({ where: identity })).toBe(0)
  })
  it('cancels only pending relations, even when publication races cancellation', async () => {
    await bindDiscoveryItems(
      { sourceId, itemIds: [itemId], artistIds: [artistId], requestId: requestId() },
      'test',
      db!
    )
    const pending = await db!.discoveryPendingCreator.findFirstOrThrow({ where: identity })
    const [artworkId, result] = await Promise.all([
      publish(),
      cancelPendingCreators({ pendingIds: [pending.id], requestId: requestId() }, 'test', db!)
    ])
    expect(await db!.discoveryPendingCreator.count({ where: identity })).toBe(0)
    expect((await effective(artworkId)).length).toBe(result?.counts.applied ? 0 : 1)
  })
  it('filters unbound results before pagination and does not enqueue when setting defaults or binding', async () => {
    await setDiscoveryCreators({ sourceId, artistIds: [artistId] }, db!)
    expect(await db!.archiveUploaderScanRun.count({ where: { sourceId } })).toBe(0)
    const deps = { database: db!, sourceKind: 'ALL' as const }
    expect((await listArchiveUploaderScanItems({ sourceId, unboundOnly: true }, deps)).counts.total).toBe(1)
    await bindDiscoveryItems(
      { sourceId, itemIds: [itemId], artistIds: [artistId], requestId: requestId() },
      'test',
      db!
    )
    expect((await listArchiveUploaderScanItems({ sourceId, unboundOnly: true }, deps)).items).toEqual([])
    const page = await listArchiveUploaderScanItems({ sourceId }, deps)
    expect(page.items[0]?.pendingCreators[0]?.id).toBe(artistId)
    await publish()
    expect(
      (await listArchiveUploaderScanItems({ sourceId, view: 'ALL' }, deps)).items[0]?.effectiveCreators[0]?.id
    ).toBe(artistId)
    expect(await db!.archiveIntakeItem.count({ where: identity })).toBe(0)
  })
  it('keeps per-item failures and rejects request reuse with another payload or actor', async () => {
    const input = { sourceId, itemIds: [itemId, 'missing'], artistIds: [artistId], requestId: requestId() }
    const result = await bindDiscoveryItems(input, 'test', db!)
    expect(result?.counts).toMatchObject({ created: 1, conflict: 1 })
    await expect(bindDiscoveryItems(input, 'another-user', db!)).rejects.toThrow('幂等键')
    await expect(bindDiscoveryItems({ ...input, itemIds: [itemId] }, 'test', db!)).rejects.toThrow('幂等键')
  })
})
