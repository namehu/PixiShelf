// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', async () => ({
  prisma: (await import('../../../../pixishelf-db/src/__tests__/artwork-dedup-maintenance-fixture')).db
}))
import { captureArtworkDedupSources } from '@pixishelf/db'
import { serializeArtworkDedupSourceSnapshot } from '@pixishelf/job-contracts'
import {
  db,
  seed,
  cleanupFixture,
  prefix
} from '../../../../pixishelf-db/src/__tests__/artwork-dedup-maintenance-fixture'
import {
  requestArchiveArtworkMaintenance,
  requestArchivePurgeMaintenance,
  requestArchiveStagingCleanup
} from '../archive-maintenance-service'
import { retryUnresolvedArchivePublication } from '../archive-publication-retry'
const sourceIds: string[] = [],
  jobIds: string[] = [],
  directoryIds: string[] = []
async function publication() {
  const id = `${prefix}-${randomUUID()}`,
    token = randomUUID()
  const source = (
    await db!.$transaction((tx) =>
      captureArtworkDedupSources(tx, { identities: [{ kind: 'PROVIDER', providerKey: 'test', externalId: id }] })
    )
  )[0]!
  sourceIds.push(source.sourceId)
  const proof = serializeArtworkDedupSourceSnapshot([source])
  await db!.systemJob.create({
    data: {
      id,
      type: 'ARCHIVE_PUBLISH',
      status: 'FAILED',
      attempt: 1,
      payload: { archiveImportId: id },
      requestedByUserId: prefix,
      finishedAt: new Date()
    }
  })
  jobIds.push(id)
  await db!.archiveImport.create({
    data: {
      id,
      systemJobId: id,
      providerKey: 'test',
      externalId: id,
      submittedUrl: 'https://example.test/',
      canonicalUrl: 'https://example.test/',
      locator: {},
      status: 'FAILED',
      phase: 'PUBLISH',
      normalizedMetadata: {},
      rawMetadata: {},
      metadataHash: 'a'.repeat(64),
      creatorBucket: 'fixture',
      stagingPath: `.archive-staging/${id}`,
      dedupSourceSnapshot: proof
    }
  })
  await db!.archiveImportExecution.create({ data: { jobId: id, archiveImportId: id, phase: 'PUBLISH' } })
  const root = await db!.mediaContentDirectoryState.findUnique({
    where: { logicalRoot_relativeDirectory: { logicalRoot: 'source-media:v1', relativeDirectory: '' } }
  })
  const directory = await db!.mediaContentDirectoryState.create({
    data: {
      logicalRoot: 'source-media:v1',
      rootIdentity: root?.rootIdentity ?? 'fixture',
      relativeDirectory: `${prefix}/${randomUUID()}`
    }
  })
  directoryIds.push(directory.id)
  await db!.mediaContentPathWrite.create({
    data: {
      directoryId: directory.id,
      scope: 'DIRECTORY',
      sessionId: `archive-publish:${id}`,
      sessionVersion: 1n,
      writeToken: randomUUID(),
      jobId: id,
      executionToken: token,
      executionAttempt: 1,
      startedAt: new Date()
    }
  })
  return { id, source, proof }
}
describe.skipIf(!db)('ordinary archive commands preserve durable dedup evidence', () => {
  afterAll(async () => {
    if (!db) return
    await db.mediaContentPathWrite.deleteMany({ where: { jobId: { in: jobIds } } })
    await db.mediaContentDirectoryState.deleteMany({ where: { id: { in: directoryIds } } })
    await db.archiveImport.deleteMany({ where: { id: { in: jobIds } } })
    await db.systemJob.deleteMany({ where: { OR: [{ id: { in: jobIds } }, { requestedByUserId: prefix }] } })
    await db.artworkDedupSourceIdentity.deleteMany({ where: { id: { in: sourceIds } } })
    await cleanupFixture()
  })
  it.each(['HOLD', 'TOMBSTONE', 'generation', 'null'] as const)(
    'rejects %s original publication proof with App STATE_CONFLICT and no refreshed intent',
    async (mode) => {
      const f = await publication()
      if (mode === 'HOLD' || mode === 'TOMBSTONE')
        {await db!.artworkDedupSourceIdentity.update({
          where: { id: f.source.sourceId },
          data: { status: mode, ownerOperationId: prefix }
        })}
      if (mode === 'generation')
        {await db!.artworkDedupSourceIdentity.update({
          where: { id: f.source.sourceId },
          data: { generation: { increment: 1 } }
        })}
      if (mode === 'null')
        {await db!.archiveImport.update({
          where: { id: f.id },
          data: { dedupSourceSnapshot: (await import('@pixishelf/db')).Prisma.DbNull }
        })}
      const task = await db!.archiveImport.findUniqueOrThrow({ where: { id: f.id }, include: { systemJob: true } })
      const writes = await db!.mediaContentPathWrite.findMany({ where: { jobId: f.id } })
      await expect(
        db!.$transaction((tx) =>
          retryUnresolvedArchivePublication(tx, task, {
            timestamp: new Date(),
            requestedByUserId: prefix,
            message: 'retry'
          })
        )
      ).rejects.toMatchObject({ code: 'STATE_CONFLICT', name: 'ArchiveError' })
      expect(await db!.archiveImport.findUniqueOrThrow({ where: { id: f.id }, include: { systemJob: true } })).toEqual(
        task
      )
      expect(await db!.mediaContentPathWrite.findMany({ where: { jobId: f.id } })).toEqual(writes)
    }
  )
  it('requeues the same original publication job and proof while leaving its owner token untouched', async () => {
    const f = await publication()
    const task = await db!.archiveImport.findUniqueOrThrow({ where: { id: f.id }, include: { systemJob: true } })
    const writes = await db!.mediaContentPathWrite.findMany({ where: { jobId: f.id } })
    expect(
      await db!.$transaction((tx) =>
        retryUnresolvedArchivePublication(tx, task, {
          timestamp: new Date(),
          requestedByUserId: prefix,
          message: 'retry'
        })
      )
    ).toBe(true)
    expect(await db!.archiveImport.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({
      systemJobId: f.id,
      status: 'PENDING',
      dedupSourceSnapshot: f.proof
    })
    expect(await db!.systemJob.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({
      status: 'PENDING',
      attempt: 1
    })
    expect(await db!.mediaContentPathWrite.findMany({ where: { jobId: f.id } })).toEqual(writes)
  })
  it('blocks staging request under source HOLD before writing cleanup intent or a job', async () => {
    const f = await publication()
    await db!.mediaContentPathWrite.deleteMany({ where: { jobId: f.id } })
    await db!.artworkDedupSourceIdentity.update({
      where: { id: f.source.sourceId },
      data: { status: 'HOLD', ownerOperationId: prefix }
    })
    const task = await db!.archiveImport.findUniqueOrThrow({ where: { id: f.id } })
    await expect(
      requestArchiveStagingCleanup(
        { archiveImportId: f.id, requestedByUserId: prefix },
        { database: db! as never, now: () => new Date() }
      )
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(await db!.archiveImport.findUniqueOrThrow({ where: { id: f.id } })).toEqual(task)
    expect(await db!.systemJob.count({ where: { type: 'ARCHIVE_MAINTENANCE', requestedByUserId: prefix } })).toBe(0)
  })
  it('blocks trash/restore/purge with persistent URL hold even without a live Claim', async () => {
    const f = await db!.$transaction((tx) => seed(tx)),
      artworkId = f.members[0]![0]!
    const artwork = await db!.artwork.update({
      where: { id: artworkId },
      data: { createdVia: 'URL_ARCHIVE', source: 'URL_ARCHIVE' }
    })
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
    await db!.artworkDedupOperationArtwork.create({
      data: {
        operationId: operation.id,
        artworkId,
        groupId: f.groupIds[0]!,
        role: 'COPY',
        status: 'RECOVERY_REQUIRED',
        title: prefix,
        sourceLabel: 'URL',
        artworkCreatedAt: artwork.createdAt,
        isUrl: true,
        frozenMediaRevision: artwork.mediaRevision,
        snapshotRevision: 0n,
        mediaEpoch: 0n,
        membersSignature: 'a'.repeat(64),
        contentSha256: 'a'.repeat(64),
        algorithmVersion: 1,
        memberCount: 1n,
        organizationSignature: 'a'.repeat(64),
        sourceSignature: 'a'.repeat(64),
        creatorSignature: 'a'.repeat(64)
      }
    })
    const before = await db!.artwork.findUniqueOrThrow({ where: { id: artworkId } })
    for (const action of ['TRASH_ARCHIVE', 'RESTORE_ARCHIVE'] as const)
      {await expect(
        requestArchiveArtworkMaintenance(
          { artworkId, action, requestedByUserId: prefix },
          { database: db! as never, now: () => new Date() }
        )
      ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })}
    await expect(
      requestArchivePurgeMaintenance(
        { artworkId, requestedByUserId: prefix },
        { database: db! as never, now: () => new Date() }
      )
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(await db!.artwork.findUniqueOrThrow({ where: { id: artworkId } })).toEqual(before)
    expect(await db!.systemJob.count({ where: { type: 'ARCHIVE_MAINTENANCE', requestedByUserId: prefix } })).toBe(0)
  })
})
