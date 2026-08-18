import { randomUUID } from 'node:crypto'
import { createDatabaseClient, disconnectDatabase } from '@pixishelf/db'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { deleteArtwork } from '../../artwork-service'
import { requestArchiveArtworkMaintenance, requestArchivePurgeMaintenance } from '../archive-maintenance-service'

const testDatabaseUrl = Reflect.get(process.env, 'PIXISHELF_TEST_DATABASE_URL') as string | undefined
const describePostgres = testDatabaseUrl ? describe.sequential : describe.skip
const prefix = `archive-maintenance-command-${randomUUID()}`
const database = createDatabaseClient(testDatabaseUrl ? { datasourceUrl: testDatabaseUrl } : undefined)

describePostgres('archive maintenance command PostgreSQL contracts', () => {
  beforeAll(async () => database.$connect())
  beforeEach(cleanupDatabase)
  afterAll(async () => {
    await cleanupDatabase()
    await disconnectDatabase(database)
  })

  it('serializes concurrent trash requests into one durable lifecycle intent and job', async () => {
    const fixture = await seedPublishedArchive('concurrent-trash')
    const requestedAt = new Date('2026-08-18T12:00:00.000Z')

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        requestArchiveArtworkMaintenance(
          {
            artworkId: fixture.artworkId,
            action: 'TRASH_ARCHIVE',
            requestedByUserId: `${prefix}-admin`,
            parentJobId: fixture.importJobId,
            requestedAt
          },
          { database: database as never, now: () => requestedAt }
        )
      )
    )

    expect(results.filter((result) => !result.reused)).toHaveLength(1)
    expect(new Set(results.map((result) => result.jobId))).toHaveProperty('size', 1)
    const artwork = await database.artwork.findUniqueOrThrow({
      where: { id: fixture.artworkId },
      include: { archiveRevisions: true }
    })
    expect(artwork).toMatchObject({ archiveLifecycleState: 'TRASHING', deletedAt: requestedAt })
    expect(artwork.archiveRevisions).toEqual([
      expect.objectContaining({
        trashPath: `.trash/archive/${fixture.artworkId}/${fixture.revisionId}`,
        trashedAt: requestedAt,
        purgeAfter: new Date('2026-08-25T12:00:00.000Z')
      })
    ])

    const jobs = await database.systemJob.findMany({
      where: { type: 'ARCHIVE_MAINTENANCE', parentJobId: fixture.importJobId }
    })
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      executionLane: 'BACKGROUND_WRITER',
      status: 'PENDING',
      requestedByUserId: `${prefix}-admin`,
      payload: { action: 'TRASH_ARCHIVE', artworkId: fixture.artworkId }
    })
    await expect(database.systemJobEvent.count({ where: { jobId: jobs[0]!.id, type: 'job.queued' } })).resolves.toBe(
      1
    )
  })

  it('reuses active purge, blocks restore, and re-materializes after terminal purge failure', async () => {
    const fixture = await seedPublishedArchive('purge-restore-race')
    const dueAt = new Date('2026-08-18T12:00:00.000Z')
    await database.artwork.update({
      where: { id: fixture.artworkId },
      data: { archiveLifecycleState: 'TRASHED', deletedAt: new Date('2026-08-11T00:00:00.000Z') }
    })
    await database.archiveRevision.updateMany({
      where: { artworkId: fixture.artworkId },
      data: {
        trashPath: `.trash/archive/${fixture.artworkId}/${fixture.revisionId}`,
        trashedAt: new Date('2026-08-11T00:00:00.000Z'),
        purgeAfter: new Date('2026-08-18T00:00:00.000Z')
      }
    })

    const [first, duplicate] = await Promise.all([
      requestArchivePurgeMaintenance(
        { artworkId: fixture.artworkId, requestedByUserId: null, requestedAt: dueAt },
        { database: database as never, now: () => dueAt }
      ),
      requestArchivePurgeMaintenance(
        { artworkId: fixture.artworkId, requestedByUserId: null, requestedAt: dueAt },
        { database: database as never, now: () => dueAt }
      )
    ])
    expect(new Set([first.jobId, duplicate.jobId])).toHaveProperty('size', 1)
    expect([first.reused, duplicate.reused].sort()).toEqual([false, true])

    await expect(
      requestArchiveArtworkMaintenance(
        {
          artworkId: fixture.artworkId,
          action: 'RESTORE_ARCHIVE',
          requestedByUserId: `${prefix}-admin`,
          requestedAt: dueAt
        },
        { database: database as never, now: () => dueAt }
      )
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    await expect(database.artwork.findUniqueOrThrow({ where: { id: fixture.artworkId } })).resolves.toMatchObject({
      archiveLifecycleState: 'TRASHED'
    })

    await database.systemJob.update({ where: { id: first.jobId }, data: { status: 'FAILED', finishedAt: dueAt } })
    await expect(
      requestArchiveArtworkMaintenance(
        {
          artworkId: fixture.artworkId,
          action: 'RESTORE_ARCHIVE',
          requestedByUserId: `${prefix}-admin`,
          requestedAt: dueAt
        },
        { database: database as never, now: () => dueAt }
      )
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT', message: '作品保留期已结束，不能再恢复' })
    const retriedAt = new Date('2026-08-18T13:00:00.000Z')
    const retry = await requestArchivePurgeMaintenance(
      { artworkId: fixture.artworkId, requestedByUserId: null, requestedAt: retriedAt },
      { database: database as never, now: () => retriedAt }
    )
    expect(retry).toMatchObject({ reused: false })
    expect(retry.jobId).not.toBe(first.jobId)
    await expect(
      database.systemJob.count({
        where: {
          type: 'ARCHIVE_MAINTENANCE',
          parentJobId: fixture.importJobId,
          payload: { equals: { action: 'PURGE_ARCHIVE', artworkId: fixture.artworkId } }
        }
      })
    ).resolves.toBe(2)
  })

  it('routes an ordinary artwork.delete call for URL archives through durable central maintenance', async () => {
    const fixture = await seedPublishedArchive('artwork-delete')

    await expect(
      deleteArtwork(fixture.artworkId, { requestedByUserId: `${prefix}-admin` })
    ).resolves.toMatchObject({ id: fixture.artworkId, archiveLifecycleState: 'TRASHING' })

    await expect(
      database.systemJob.findFirst({
        where: {
          type: 'ARCHIVE_MAINTENANCE',
          requestedByUserId: `${prefix}-admin`,
          payload: { equals: { action: 'TRASH_ARCHIVE', artworkId: fixture.artworkId } }
        }
      })
    ).resolves.toMatchObject({ executionLane: 'BACKGROUND_WRITER', status: 'PENDING' })
  })
})

async function seedPublishedArchive(suffix: string) {
  const importJobId = `${prefix}-${suffix}-import-job`
  const importId = `${prefix}-${suffix}-import`
  const revisionId = `${prefix}-${suffix}-revision`
  await database.systemJob.create({
    data: {
      id: importJobId,
      type: 'ARCHIVE_IMPORT',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: 1,
      status: 'COMPLETED',
      triggerSource: 'MANUAL',
      requestedByUserId: `${prefix}-admin`,
      payload: { archiveImportId: importId },
      progress: 100,
      finishedAt: new Date('2026-08-18T11:00:00.000Z')
    }
  })
  const artwork = await database.artwork.create({
    data: {
      title: `${prefix}-${suffix}`,
      createdVia: 'URL_ARCHIVE',
      source: 'URL_ARCHIVE',
      archiveLifecycleState: 'ACTIVE'
    }
  })
  const externalRef = await database.artworkExternalRef.create({
    data: {
      artworkId: artwork.id,
      // Production provider keys are short, bounded identifiers; keep the randomized test scope in externalId/title.
      providerKey: 'stage4b-test',
      externalId: suffix,
      canonicalUrl: `https://example.test/${suffix}`,
      locator: {}
    }
  })
  await database.archiveImport.create({
    data: {
      id: importId,
      systemJobId: importJobId,
      providerKey: externalRef.providerKey,
      externalId: externalRef.externalId,
      externalRefId: externalRef.id,
      submittedUrl: externalRef.canonicalUrl,
      canonicalUrl: externalRef.canonicalUrl,
      locator: {},
      status: 'COMPLETED',
      normalizedMetadata: {},
      rawMetadata: {},
      metadataHash: 'a'.repeat(64),
      creatorBucket: 'fixture',
      stagingPath: `.archive-staging/${importId}`,
      publishedArtworkId: artwork.id
    }
  })
  await database.archiveRevision.create({
    data: {
      id: revisionId,
      artworkId: artwork.id,
      externalRefId: externalRef.id,
      archiveImportId: importId,
      archivePath: `sources/test/fixture/${suffix}/revisions/${revisionId}`,
      manifestPath: `sources/test/fixture/${suffix}/revisions/${revisionId}/manifest.json`,
      mediaSnapshot: [],
      metadataHash: 'a'.repeat(64),
      isCurrent: true
    }
  })
  return { artworkId: artwork.id, importJobId, revisionId }
}

async function cleanupDatabase() {
  const parentJobs = await database.systemJob.findMany({
    where: { id: { startsWith: prefix } },
    select: { id: true }
  })
  const parentJobIds = parentJobs.map(({ id }) => id)
  if (parentJobIds.length > 0) {
    await database.systemJob.deleteMany({ where: { parentJobId: { in: parentJobIds } } })
    await database.archiveImport.deleteMany({ where: { systemJobId: { in: parentJobIds } } })
  }
  await database.artwork.deleteMany({ where: { title: { startsWith: prefix } } })
  await database.systemJob.deleteMany({ where: { id: { in: parentJobIds } } })
}
