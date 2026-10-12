import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@pixishelf/db'
import { afterAll, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { listArchiveTrash, restoreArchiveTrash } from '../archive-trash-service'
import { listArchiveTasks } from '../archive-task-service'
import { requestArchiveArtworkMaintenance } from '../archive-maintenance-service'
import {
  getArchiveUploaderCatalogCounts,
  listArchiveUploaderCatalogState
} from '../../archive-uploader/archive-uploader-catalog-state'

const url = process.env.PIXISHELF_TEST_DATABASE_URL
const db = new PrismaClient(url ? { datasourceUrl: url } : undefined)
const prefix = `trash-${randomUUID()}`
const suite = url ? describe.sequential : describe.skip

suite('archive trash persistent lifecycle', () => {
  afterAll(async () => {
    await db.archiveUploaderSource.deleteMany({ where: { displayName: { startsWith: prefix } } })
    await db.artwork.deleteMany({ where: { title: { startsWith: prefix } } })
    await db.systemJob.deleteMany({ where: { requestedByUserId: prefix } })
    await db.archiveBulkOperation.deleteMany({ where: { requestedByUserId: prefix } })
    await db.archiveDeletedIdentity.deleteMany({ where: { externalId: { startsWith: prefix } } })
    await db.$disconnect()
  })

  it('paginates equal deletion timestamps without duplicate works or revisions', async () => {
    const deletedAt = new Date()
    const fixtures = []
    for (const suffix of ['page-a', 'page-b', 'page-c']) {
      const fixture = await seed(suffix)
      await db.artwork.update({ where: { id: fixture.artwork.id }, data: { deletedAt, archiveLifecycleState: 'TRASHED' } })
      fixtures.push(fixture)
    }
    const first = await listArchiveTrash({ search: `${prefix}-page-`, limit: 2 }, db)
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()
    const second = await listArchiveTrash({ search: `${prefix}-page-`, limit: 2, cursor: first.nextCursor! }, db)
    expect(second.items).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
    expect([...first.items, ...second.items].map((item) => item.id)).toEqual(fixtures.map((item) => item.artwork.id).sort((a, b) => b - a))
  })

  it('groups revisions, hides deleted task history, restores atomically and reports mixed bulk results', async () => {
    const fixture = await seed('restore')
    const now = new Date()
    await requestArchiveArtworkMaintenance(
      { artworkId: fixture.artwork.id, action: 'TRASH_ARCHIVE', requestedByUserId: prefix },
      { database: db as never, now: () => now }
    )
    const identities = await db.archiveDeletedIdentity.findMany({ where: { artworkId: fixture.artwork.id } })
    expect(identities).toHaveLength(2)
    expect(identities.every((row) => row.purgedAt === null)).toBe(true)
    const tasks = await listArchiveTasks({ search: fixture.externalId }, { database: db })
    expect(tasks.items).toHaveLength(0)
    const trash = await listArchiveTrash({ search: fixture.artwork.title }, db)
    expect(trash.items).toHaveLength(1)
    expect(trash.items[0]).toMatchObject({ lifecycleState: 'TRASHING', canRestore: false })
    await expect(getArchiveUploaderCatalogCounts(db, [fixture.source.id])).resolves.toEqual(
      new Map([[fixture.source.id, { actionable: 0, processing: 0, archived: 0, deleted: 1, attention: 0, total: 1 }]])
    )
    const rows = await listArchiveUploaderCatalogState(db, { sourceId: fixture.source.id, view: 'DELETED', limit: 50 })
    expect(rows.items[0]).toMatchObject({ workflowStage: 'DELETED', canRearchive: false })

    await db.systemJob.updateMany({
      where: { type: 'ARCHIVE_MAINTENANCE', requestedByUserId: prefix },
      data: { status: 'COMPLETED' }
    })
    await db.artwork.update({ where: { id: fixture.artwork.id }, data: { archiveLifecycleState: 'TRASHED' } })
    const request = { artworkIds: [fixture.artwork.id, 2147483647], idempotencyKey: `${prefix}-restore` }
    const bulk = await restoreArchiveTrash(request, prefix, db)
    expect(bulk?.counts.applied).toBe(1)
    expect((bulk?.counts.failed ?? 0) + (bulk?.counts.conflict ?? 0)).toBe(1)
    expect((await restoreArchiveTrash(request, prefix, db))?.id).toBe(bulk?.id)
    await db.artwork.update({
      where: { id: fixture.artwork.id },
      data: { deletedAt: null, archiveLifecycleState: 'ACTIVE' }
    })
    expect(await db.archiveDeletedIdentity.count({ where: { artworkId: fixture.artwork.id } })).toBe(0)
    expect((await listArchiveTrash({ search: fixture.artwork.title }, db)).items).toHaveLength(0)
    expect((await listArchiveTasks({ search: fixture.externalId }, { database: db })).items).toHaveLength(2)
    expect((await getArchiveUploaderCatalogCounts(db, [fixture.source.id])).get(fixture.source.id)?.archived).toBe(1)
  })

  it('preserves deletion after purge and source recreation, and only successful publication clears it', async () => {
    const fixture = await seed('purge')
    const deletedAt = new Date(Date.now() - 8 * 86400000)
    await db.artwork.update({
      where: { id: fixture.artwork.id },
      data: { deletedAt, archiveLifecycleState: 'TRASHED' }
    })
    await db.artwork.delete({ where: { id: fixture.artwork.id } })
    const deletion = await db.archiveDeletedIdentity.findUniqueOrThrow({
      where: { providerKey_externalId: { providerKey: 'test', externalId: fixture.externalId } }
    })
    expect(deletion.purgedAt).not.toBeNull()
    const oldTask = await db.archiveImport.findUniqueOrThrow({ where: { id: fixture.importIds[0] } })
    expect(oldTask).toMatchObject({ publishedArtworkId: null, publishedArtworkDeletedAt: deletedAt })
    expect(oldTask.publishedArtworkPurgedAt).not.toBeNull()
    expect((await listArchiveTasks({ search: fixture.externalId }, { database: db })).items).toHaveLength(0)
    await db.archiveUploaderSource.delete({ where: { id: fixture.source.id } })
    const source = await seedSource(fixture.externalId)
    const results = await listArchiveUploaderCatalogState(db, { sourceId: source.id, view: 'DELETED', limit: 50 })
    expect(results.items[0]).toMatchObject({ workflowStage: 'DELETED', canRearchive: true, artworkId: null })
    const newArtwork = await db.artwork.create({
      data: { title: `${prefix}-new`, createdVia: 'URL_ARCHIVE', source: 'URL_ARCHIVE' }
    })
    const task = await seedImport(fixture.externalId, newArtwork.id, 'retry', 'RUNNING')
    expect(await db.archiveDeletedIdentity.count({ where: { externalId: fixture.externalId } })).toBe(1)
    await db.archiveImport.update({ where: { id: task }, data: { status: 'FAILED' } })
    expect(await db.archiveDeletedIdentity.count({ where: { externalId: fixture.externalId } })).toBe(1)
    await db.archiveImport.update({ where: { id: task }, data: { status: 'COMPLETED' } })
    expect(await db.archiveDeletedIdentity.count({ where: { externalId: fixture.externalId } })).toBe(0)
    expect((await db.archiveImport.findUniqueOrThrow({ where: { id: oldTask.id } })).publishedArtworkDeletedAt).toEqual(
      deletedAt
    )
  })
})

async function seed(suffix: string) {
  const externalId = `${prefix}-${suffix}`
  const artwork = await db.artwork.create({
    data: { title: externalId, source: 'URL_ARCHIVE', createdVia: 'URL_ARCHIVE' }
  })
  const importIds: string[] = []
  for (const index of [0, 1]) {
    const identity = index ? `${externalId}-alias` : externalId
    const ref = await db.artworkExternalRef.create({
      data: {
        artworkId: artwork.id,
        providerKey: 'test',
        externalId: identity,
        canonicalUrl: `https://example.test/${identity}`,
        locator: {}
      }
    })
    const importId = await seedImport(identity, artwork.id, String(index), 'COMPLETED')
    importIds.push(importId)
    await db.archiveRevision.create({
      data: {
        artworkId: artwork.id,
        externalRefId: ref.id,
        archiveImportId: importId,
        archivePath: `${externalId}/${index}`,
        manifestPath: `${externalId}/${index}/manifest.json`,
        metadataHash: 'hash',
        mediaSnapshot: [],
        isCurrent: index === 0
      }
    })
  }
  return { artwork, importIds, externalId, source: await seedSource(externalId) }
}

async function seedImport(externalId: string, artworkId: number, suffix: string, status: 'RUNNING' | 'COMPLETED') {
  const id = `${externalId}-${suffix}`
  await db.systemJob.create({
    data: {
      id,
      type: 'ARCHIVE_IMPORT',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: 1,
      triggerSource: 'MANUAL',
      requestedByUserId: prefix,
      status: 'COMPLETED',
      payload: {}
    }
  })
  await db.archiveImport.create({
    data: {
      id,
      systemJobId: id,
      providerKey: 'test',
      externalId,
      submittedUrl: `https://example.test/${externalId}`,
      canonicalUrl: `https://example.test/${externalId}`,
      locator: {},
      status,
      normalizedMetadata: {},
      rawMetadata: {},
      metadataHash: 'hash',
      creatorBucket: 'test',
      stagingPath: id,
      publishedArtworkId: artworkId
    }
  })
  return id
}

async function seedSource(externalId: string) {
  const source = await db.archiveUploaderSource.create({
    data: {
      providerKey: 'test',
      displayName: `${prefix}-source`,
      identityKind: 'NAME',
      identityValue: externalId,
      normalizedIdentity: externalId
    }
  })
  await db.archiveUploaderCatalogItem.create({
    data: {
      sourceId: source.id,
      providerKey: 'test',
      externalId,
      canonicalUrl: `https://example.test/${externalId}`,
      title: externalId,
      relationships: [],
      classification: 'ARCHIVED',
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      lastOutcome: 'ARCHIVED'
    }
  })
  return source
}
