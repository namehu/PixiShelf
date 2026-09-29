import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  PrismaClient,
  activeCreatorMembership,
  bindDiscoveryCreators,
  consumeDiscoveryCreators,
  lockDiscoveryCreators
} from '@pixishelf/db'
import { editArchiveTaskCreators } from '../archive-task-creators'
import { listArchiveTasks } from '../archive-task-service'

const url = process.env.PIXISHELF_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const prefix = `task-creators-${randomUUID()}`
const providerKey = `test-${randomUUID().slice(0, 8)}`
const artistIds: number[] = []
const artworkIds: number[] = []
let artistId: number
let identity: { providerKey: string; externalId: string }
let taskId: string

async function seedTask(externalId = identity.externalId, createdAt = new Date()) {
  const job = await db!.systemJob.create({
    data: {
      type: 'ARCHIVE_IMPORT',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: 2,
      status: 'FAILED',
      triggerSource: 'MANUAL',
      requestedByUserId: prefix,
      payload: {}
    }
  })
  return db!.archiveImport.create({
    data: {
      systemJobId: job.id,
      providerKey,
      externalId,
      status: 'FAILED',
      submittedUrl: 'https://example.test/gallery',
      canonicalUrl: 'https://example.test/gallery',
      locator: {},
      normalizedMetadata: { titles: { display: `${prefix} title` } },
      rawMetadata: {},
      metadataHash: 'a'.repeat(64),
      creatorBucket: prefix,
      stagingPath: `.archive-staging/${job.id}`,
      createdAt
    }
  })
}
function edit(action: 'ADD' | 'REMOVE', ids = [artistId], requestId = randomUUID()) {
  return editArchiveTaskCreators({ taskId, artistIds: ids, action, requestId }, prefix, db!)
}
async function publish() {
  return db!.$transaction(async (tx) => {
    await lockDiscoveryCreators(tx, identity)
    const artwork = await tx.artwork.create({ data: { title: prefix } })
    artworkIds.push(artwork.id)
    await tx.artworkExternalRef.create({
      data: { ...identity, artworkId: artwork.id, canonicalUrl: 'https://example.test/gallery', locator: {} }
    })
    await consumeDiscoveryCreators(tx, identity, artwork.id)
    return artwork.id
  })
}
const summary = async (id = taskId) => (await listArchiveTasks({ taskId: id }, { database: db! })).items[0]!

describe.skipIf(!url)('archive task creators PostgreSQL', () => {
  beforeEach(async () => {
    identity = { providerKey, externalId: randomUUID() }
    const artist = await db!.artist.create({ data: { name: prefix } })
    artistId = artist.id
    artistIds.push(artistId)
    taskId = (await seedTask()).id
  })
  afterAll(async () => {
    if (!db) return
    await db.archiveBulkOperation.deleteMany({ where: { requestedByUserId: prefix } })
    await db.archiveImport.deleteMany({ where: { providerKey } })
    await db.systemJob.deleteMany({ where: { requestedByUserId: prefix } })
    await db.discoveryPendingCreator.deleteMany({ where: { providerKey } })
    await db.artwork.deleteMany({ where: { id: { in: artworkIds } } })
    await db.artist.deleteMany({ where: { id: { in: artistIds } } })
    await db.$disconnect()
  })

  it('supports manual tasks without a catalog, shares identity, and never starts downloads', async () => {
    const other = await seedTask()
    await db!.archiveImport.update({ where: { id: other.id }, data: { status: 'CANCELLED' } })
    const jobs = await db!.systemJob.count({ where: { requestedByUserId: prefix } })
    expect((await edit('ADD', [artistId, artistId]))?.counts.created).toBe(1)
    expect((await summary(other.id)).pendingCreators.map((row) => row.id)).toEqual([artistId])
    expect(await db!.discoveryPendingCreator.count({ where: identity })).toBe(1)
    expect(await db!.archiveUploaderCatalogItem.count({ where: identity })).toBe(0)
    expect(await db!.systemJob.count({ where: { requestedByUserId: prefix } })).toBe(jobs)
    expect((await db!.archiveImport.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('FAILED')
  })

  it('filters binding by identity before pagination and keeps direct detail lookup independent', async () => {
    const older1 = await seedTask('older-1', new Date('2026-01-01'))
    const older2 = await seedTask('older-2', new Date('2026-01-02'))
    await edit('ADD')
    const input = {
      providerKey,
      unboundOnly: true,
      limit: 1,
      search: `${prefix} title`,
      statuses: ['FAILED'] as ['FAILED']
    }
    const page1 = await listArchiveTasks(input, { database: db! })
    expect(page1.items.map((row) => row.id)).toEqual([older2.id])
    const page2 = await listArchiveTasks({ ...input, cursor: page1.nextCursor! }, { database: db! })
    expect(page2.items.map((row) => row.id)).toEqual([older1.id])
    expect((await listArchiveTasks({ ...input, taskId }, { database: db! })).items).toHaveLength(1)
    await publish()
    expect((await summary()).effectiveCreators.map((row) => row.id)).toEqual([artistId])
    expect((await listArchiveTasks(input, { database: db! })).items.map((row) => row.id)).toEqual([older2.id])
  })

  it('serializes add/remove with publication and preserves unrelated creators', async () => {
    const [, artworkId] = await Promise.all([edit('ADD'), publish()])
    const other = await db!.artist.create({ data: { name: prefix, kind: 'GROUP' } })
    artistIds.push(other.id)
    await edit('ADD', [other.id])
    await edit('REMOVE')
    expect((await summary()).effectiveCreators.map((row) => row.id)).toEqual([other.id])
    expect(await db!.artworkArtist.count({ where: { artworkId, artistId, ...activeCreatorMembership } })).toBe(0)
    await db!.$transaction(async (tx) => {
      await lockDiscoveryCreators(tx, identity)
      await bindDiscoveryCreators(tx, identity, [artistId], { automatic: true, title: prefix })
    })
    expect((await summary()).effectiveCreators.map((row) => row.id)).toEqual([other.id])
  })

  it('removes the relation even if pending binding is published while removal starts', async () => {
    await edit('ADD')
    await Promise.all([publish(), edit('REMOVE')])
    const result = await summary()
    expect(result.effectiveCreators).toEqual([])
    expect(result.pendingCreators).toEqual([])
    expect(await db!.discoveryCreatorSuppression.count({ where: { ...identity, artistId } })).toBe(1)
  })

  it('replays durable receipts without restoring cancelled bindings and rejects altered requests', async () => {
    const requestId = randomUUID()
    const first = await edit('ADD', [artistId], requestId)
    await edit('REMOVE')
    expect((await edit('ADD', [artistId], requestId))?.id).toBe(first?.id)
    expect((await summary()).pendingCreators).toEqual([])
    await expect(edit('REMOVE', [artistId], requestId)).rejects.toThrow('幂等键')
    await expect(
      editArchiveTaskCreators({ taskId, action: 'ADD', artistIds: [artistId], requestId }, 'other-user', db!)
    ).rejects.toThrow('幂等键')
    await edit('ADD')
    expect((await summary()).pendingCreators.map((row) => row.id)).toEqual([artistId])
    expect(await db!.discoveryCreatorSuppression.count({ where: identity })).toBe(0)
  })

  it('rejects trashed/cleaning works and missing artists without modifying bindings', async () => {
    const artworkId = await publish()
    await db!.artwork.update({
      where: { id: artworkId },
      data: { deletedAt: new Date(), archiveLifecycleState: 'TRASHED' }
    })
    expect((await edit('ADD'))?.counts.conflict).toBe(1)
    expect((await summary()).creatorEditBlockedReason).toContain('回收站')
    await db!.artwork.update({ where: { id: artworkId }, data: { deletedAt: null, archiveLifecycleState: 'ACTIVE' } })
    await db!.archiveImport.update({ where: { id: taskId }, data: { cleanupRequestedAt: new Date() } })
    expect((await edit('REMOVE'))?.counts.conflict).toBe(1)
    await db!.archiveImport.update({ where: { id: taskId }, data: { cleanupRequestedAt: null } })
    expect((await edit('ADD', [2147483647]))?.counts.conflict).toBe(1)
    expect((await summary()).effectiveCreators).toEqual([])
  })
})
