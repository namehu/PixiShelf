import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ArchiveMaintenancePayload, WorkerCapability } from '@pixishelf/job-contracts'
import {
  Prisma,
  PrismaClient,
  inspectMediaContentRecovery,
  grantMediaContentRecovery,
  resumeGrantedMediaContentRecovery,
  withMediaContentOwnerPublication
} from '@pixishelf/db'
import { readExecutorMediaRecoveryDomainSnapshot } from '../../scan/media-content-recovery.ts'
import {
  MutableQueueClock,
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ClaimedJob,
  type EnqueuedChildJob,
  type ExecutionContext,
  type QueueDatabase
} from '@pixishelf/job-runtime'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveMediaContentRoots } from '../../media-content/roots.ts'
import { executeArchiveMaintenance } from '../maintenance-executor.js'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const prefix = `archive-maintenance-${randomUUID()}`
const capabilities: WorkerCapability[] = [
  { jobType: 'ARCHIVE_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
]
const roots: string[] = []

describePostgres('archive maintenance PostgreSQL integration', () => {
  beforeEach(async () => {
    await cleanupDatabase()
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanupDatabase()
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
    await prisma.$disconnect()
  })

  it('fenced cleanup removes deterministic files and clears durable checkpoints', async () => {
    const root = await temporaryRoot()
    const now = new Date('2026-08-18T10:00:00.000Z')
    const importJobId = `${prefix}-import-job`
    const importId = `${prefix}-import`
    await seedSystemJob(importJobId, 'ARCHIVE_IMPORT', { archiveImportId: importId }, now, 'COMPLETED')
    await db().archiveImport.create({
      data: {
        id: importId,
        systemJobId: importJobId,
        providerKey: 'test',
        externalId: 'cleanup',
        submittedUrl: 'https://example.test/cleanup',
        canonicalUrl: 'https://example.test/cleanup',
        locator: {},
        status: 'FAILED',
        normalizedMetadata: {},
        rawMetadata: {},
        metadataHash: 'a'.repeat(64),
        creatorBucket: 'bucket',
        stagingPath: `.archive-staging/${importId}`,
        cleanupRequestedAt: now
      }
    })
    await writeFixture(root, `.archive-staging/${importId}/checkpoint`)
    await writeFixture(root, `sources/test/bucket/cleanup/revisions/${importId}/checkpoint`)
    await writeFile(
      path.join(root, `sources/test/bucket/cleanup/revisions/${importId}/manifest.json`),
      JSON.stringify({ revisionId: importId, provider: { key: 'test', externalId: 'cleanup' }, media: [] })
    )
    const maintenanceJobId = await seedSystemJob(
      `${prefix}-cleanup-job`,
      'ARCHIVE_MAINTENANCE',
      { action: 'CLEAN_STAGING', archiveImportId: importId },
      now
    )

    await runClaimedMaintenance(maintenanceJobId, root, now)

    await expect(db().archiveImport.findUniqueOrThrow({ where: { id: importId } })).resolves.toMatchObject({
      cleanupRequestedAt: null,
      completedItems: 0,
      failedItems: 0
    })
    await expect(db().systemJob.findUniqueOrThrow({ where: { id: maintenanceJobId } })).resolves.toMatchObject({
      status: 'COMPLETED'
    })
    await expect(readFile(path.join(root, `.archive-staging/${importId}/checkpoint`))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('fenced trash and restore preserve lifecycle/path invariants on real rows', async () => {
    const root = await temporaryRoot()
    const now = new Date('2026-08-18T11:00:00.000Z')
    const artwork = await db().artwork.create({
      data: {
        title: prefix,
        createdVia: 'URL_ARCHIVE',
        source: 'URL_ARCHIVE',
        archiveLifecycleState: 'TRASHING',
        deletedAt: now
      }
    })
    const externalRef = await db().artworkExternalRef.create({
      data: {
        artworkId: artwork.id,
        providerKey: 'test-maintenance',
        externalId: prefix,
        canonicalUrl: 'https://example.test/archive',
        locator: {}
      }
    })
    const archivePath = `sources/test/bucket/${prefix}/revisions/rev-1`
    const trashPath = `.trash/archive/${artwork.id}/rev-1`
    await db().archiveRevision.create({
      data: {
        id: `${prefix}-revision`,
        artworkId: artwork.id,
        externalRefId: externalRef.id,
        archivePath,
        manifestPath: `${archivePath}/manifest.json`,
        mediaSnapshot: [],
        metadataHash: 'b'.repeat(64),
        isCurrent: true,
        trashPath,
        trashedAt: now,
        purgeAfter: new Date(now.getTime() + 60_000)
      }
    })
    await writeFixture(root, `${archivePath}/media/file.jpg`)
    const trashJobId = await seedSystemJob(
      `${prefix}-trash-job`,
      'ARCHIVE_MAINTENANCE',
      { action: 'TRASH_ARCHIVE', artworkId: artwork.id },
      now
    )

    await runClaimedMaintenance(trashJobId, root, now)
    await expect(db().artwork.findUniqueOrThrow({ where: { id: artwork.id } })).resolves.toMatchObject({
      archiveLifecycleState: 'TRASHED',
      deletedAt: now
    })
    await expect(readFile(path.join(root, trashPath, 'media/file.jpg'), 'utf8')).resolves.toBe('fixture')

    const restoreAt = new Date(now.getTime() + 1_000)
    await db().artwork.update({ where: { id: artwork.id }, data: { archiveLifecycleState: 'RESTORING' } })
    const restoreJobId = await seedSystemJob(
      `${prefix}-restore-job`,
      'ARCHIVE_MAINTENANCE',
      { action: 'RESTORE_ARCHIVE', artworkId: artwork.id },
      restoreAt
    )
    await runClaimedMaintenance(restoreJobId, root, restoreAt)

    await expect(db().artwork.findUniqueOrThrow({ where: { id: artwork.id } })).resolves.toMatchObject({
      archiveLifecycleState: 'ACTIVE',
      deletedAt: null
    })
    await expect(
      db().archiveRevision.findUniqueOrThrow({ where: { id: `${prefix}-revision` } })
    ).resolves.toMatchObject({
      trashPath: null,
      trashedAt: null,
      purgeAfter: null
    })
    await expect(readFile(path.join(root, archivePath, 'media/file.jpg'), 'utf8')).resolves.toBe('fixture')
  })

  it('permanently purges due trash paths, revisions, images, and artwork on real rows', async () => {
    const root = await temporaryRoot()
    const now = new Date('2026-08-18T13:00:00.000Z')
    const artwork = await db().artwork.create({
      data: {
        title: prefix,
        createdVia: 'URL_ARCHIVE',
        source: 'URL_ARCHIVE',
        archiveLifecycleState: 'TRASHED',
        deletedAt: new Date('2026-08-11T00:00:00.000Z')
      }
    })
    const externalRef = await db().artworkExternalRef.create({
      data: {
        artworkId: artwork.id,
        providerKey: 'test-purge',
        externalId: `${prefix}-purge`,
        canonicalUrl: 'https://example.test/purge',
        locator: {}
      }
    })
    const archivePath = `sources/test/bucket/${prefix}/revisions/rev-purge`
    const trashPath = `.trash/archive/${artwork.id}/rev-purge`
    const revision = await db().archiveRevision.create({
      data: {
        id: `${prefix}-purge-revision`,
        artworkId: artwork.id,
        externalRefId: externalRef.id,
        archivePath,
        manifestPath: `${archivePath}/manifest.json`,
        mediaSnapshot: [],
        metadataHash: 'c'.repeat(64),
        isCurrent: true,
        trashPath,
        trashedAt: new Date('2026-08-11T00:00:00.000Z'),
        purgeAfter: new Date('2026-08-18T00:00:00.000Z')
      }
    })
    const image = await db().image.create({ data: { artworkId: artwork.id, path: `${trashPath}/media/file.jpg` } })
    await writeFixture(root, `${trashPath}/media/file.jpg`)
    const purgeJobId = await seedSystemJob(
      `${prefix}-purge-job`,
      'ARCHIVE_MAINTENANCE',
      { action: 'PURGE_ARCHIVE', artworkId: artwork.id },
      now
    )

    await runClaimedMaintenance(purgeJobId, root, now)

    await expect(db().artwork.findUnique({ where: { id: artwork.id } })).resolves.toBeNull()
    await expect(db().archiveRevision.findUnique({ where: { id: revision.id } })).resolves.toBeNull()
    await expect(db().image.findUnique({ where: { id: image.id } })).resolves.toBeNull()
    await expect(readFile(path.join(root, trashPath, 'media/file.jpg'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(db().systemJob.findUniqueOrThrow({ where: { id: purgeJobId } })).resolves.toMatchObject({
      status: 'COMPLETED',
      result: { action: 'PURGE_ARCHIVE', artworkId: artwork.id }
    })
  })
  it.each(['TRASH_ARCHIVE', 'RESTORE_ARCHIVE', 'PURGE_ARCHIVE'] as const)(
    'resumes %s after file work but before database commit using one explicit offline grant',
    async (action) => {
      const root = await temporaryRoot()
      const now = new Date()
      const expectedState =
        action === 'TRASH_ARCHIVE' ? 'TRASHING' : action === 'RESTORE_ARCHIVE' ? 'RESTORING' : 'TRASHED'
      const artwork = await db().artwork.create({
        data: {
          title: prefix,
          createdVia: 'URL_ARCHIVE',
          source: 'URL_ARCHIVE',
          archiveLifecycleState: expectedState,
          deletedAt: now
        }
      })
      const externalRef = await db().artworkExternalRef.create({
        data: {
          artworkId: artwork.id,
          providerKey: 'offline-maintenance',
          externalId: `${prefix}-${action}`,
          canonicalUrl: 'https://example.test/offline-maintenance',
          locator: {}
        }
      })
      const archivePath = `sources/test/bucket/${prefix}/revisions/${action}`
      const trashPath = `.trash/archive/${artwork.id}/${action}`
      await db().archiveRevision.create({
        data: {
          id: `${prefix}-offline-${action}`,
          artworkId: artwork.id,
          externalRefId: externalRef.id,
          archivePath,
          trashPath,
          manifestPath: `${archivePath}/manifest.json`,
          mediaSnapshot: [],
          metadataHash: 'd'.repeat(64),
          isCurrent: true,
          trashedAt: now,
          purgeAfter: new Date(now.getTime() - 1000)
        }
      })
      await db().image.create({ data: { artworkId: artwork.id, path: `${archivePath}/media/file.jpg` } })
      await writeFixture(root, `${action === 'TRASH_ARCHIVE' ? archivePath : trashPath}/media/file.jpg`)
      const jobId = await seedSystemJob(
        `${prefix}-offline-${action}`,
        'ARCHIVE_MAINTENANCE',
        { action, artworkId: artwork.id },
        now
      )
      const clock = new MutableQueueClock(now)
      const repository = new PostgresQueueRepository(db() as unknown as QueueDatabase, {
        clock,
        leaseDurationMs: 60_000,
        transactionMaxWaitMs: 5_000,
        transactionTimeoutMs: 20_000
      })
      const first = (await repository.claim(`${prefix}-offline-worker`, capabilities))!
      expect(first.id).toBe(jobId)
      const original = executionContext(repository, first)
      const crashed = {
        ...original,
        finalizeInTransaction: async () => {
          throw new Error('injected before business commit')
        }
      }
      await expect(executeArchiveMaintenance(crashed, { database: db(), config: { scanRoot: root } })).rejects.toThrow(
        'injected'
      )
      const oldSource = await db().artworkContentSource.findUniqueOrThrow({ where: { artworkId: artwork.id } })
      const oldClaims = await db().mediaContentPathWrite.findMany({ where: { jobId }, orderBy: { id: 'asc' } })
      expect(oldClaims).toHaveLength(2)
      expect(oldClaims.every((claim) => claim.status === 'ACTIVE')).toBe(true)

      // The test has awaited the interrupted executor; all its filesystem work is stopped.
      await repository.release({
        jobId,
        workerId: first.workerId,
        executionToken: first.executionToken,
        attempt: first.attempt
      })
      const inspection = await db().$transaction((tx) =>
        inspectMediaContentRecovery(tx, {
          jobId,
          sessionId: `archive-maintenance:${jobId}`,
          now,
          readDomainSnapshot: readExecutorMediaRecoveryDomainSnapshot
        })
      )
      if (inspection.status !== 'READY') throw new Error(`Inspection rejected: ${inspection.status}`)
      const granted = await db().$transaction((tx) =>
        grantMediaContentRecovery(tx, {
          snapshot: inspection.value.snapshot,
          expectedDigest: inspection.value.digest,
          backupCheckpointRef: 'disposable-fixture-checkpoint',
          operator: 'fixture-operator',
          confirmAllWritersStopped: true,
          now,
          readDomainSnapshot: readExecutorMediaRecoveryDomainSnapshot
        })
      )
      if (granted.status !== 'READY') throw new Error(`Grant rejected: ${granted.status}`)
      expect(granted.value.nextAttempt).toBe(first.attempt + 1)
      expect(await db().artworkContentSource.findUniqueOrThrow({ where: { artworkId: artwork.id } })).toEqual(oldSource)

      const second = (await repository.claim(`${prefix}-recovered-worker`, capabilities))!
      expect(second.attempt).toBe(first.attempt + 1)
      const resumed = executionContext(repository, second)
      const finalize = resumed.finalizeInTransaction
      resumed.finalizeInTransaction = async (operation) => {
        const claimed = await db().mediaContentPathWrite.findMany({ where: { jobId }, orderBy: { id: 'asc' } })
        expect(claimed.map((item) => item.writeToken)).toEqual(oldClaims.map((item) => item.writeToken))
        expect(claimed.every((item) => item.executionToken === second.executionToken)).toBe(true)
        expect(await db().artworkContentSource.findUniqueOrThrow({ where: { artworkId: artwork.id } })).toEqual(
          oldSource
        )
        return finalize(operation)
      }
      await executeArchiveMaintenance(resumed, { database: db(), config: { scanRoot: root } })
      expect(await db().systemJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: 'COMPLETED' })
      await expect(
        executeArchiveMaintenance(original, { database: db(), config: { scanRoot: root } })
      ).rejects.toThrow()
      if (action === 'PURGE_ARCHIVE') {
        expect(await db().artwork.findUnique({ where: { id: artwork.id } })).toBeNull()
        await expect(readFile(path.join(root, trashPath, 'media/file.jpg'))).rejects.toMatchObject({ code: 'ENOENT' })
      } else {
        expect(await db().artwork.findUniqueOrThrow({ where: { id: artwork.id } })).toMatchObject({
          archiveLifecycleState: action === 'TRASH_ARCHIVE' ? 'TRASHED' : 'ACTIVE'
        })
        expect(
          await readFile(
            path.join(root, action === 'TRASH_ARCHIVE' ? trashPath : archivePath, 'media/file.jpg'),
            'utf8'
          )
        ).toBe('fixture')
      }
    }
  )

  it.each(['TRASH_ARCHIVE', 'RESTORE_ARCHIVE', 'PURGE_ARCHIVE'] as const)(
    'recovers all 101 revisions for %s after file work and one offline grant',
    async (action) => {
      const fixture = await interruptedLargeMaintenance(action)
      const { root, now, artwork, jobId, repository, original, oldClaims, oldSource, revisions, sentinels } = fixture
      const domain = await db().$transaction((tx) =>
        readExecutorMediaRecoveryDomainSnapshot(tx, { jobId, sessionId: `archive-maintenance:${jobId}` })
      )
      expect(domain).toMatchObject({
        revisions: { version: 1, count: '101', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }
      })
      expect(JSON.stringify(domain).length).toBeLessThan(1500)
      const inspection = await inspectMaintenance(fixture)
      const granted = await grantMaintenance(fixture, inspection)
      if (granted.status !== 'READY') throw new Error(`Grant rejected: ${granted.status}`)
      expect(await resumeMaintenance(fixture, granted.value.grantId)).toMatchObject({
        status: 'READY',
        value: { jobId, status: 'PENDING', nextAttempt: original.job.attempt + 1, reused: false }
      })
      const second = (await repository.claim(`${prefix}-large-recovered-worker`, capabilities))!
      expect(second.id).toBe(jobId)
      expect(second.attempt).toBe(original.job.attempt + 1)
      const resumed = executionContext(repository, second)
      const finalize = resumed.finalizeInTransaction
      resumed.finalizeInTransaction = async (operation) => {
        const claims = await db().mediaContentPathWrite.findMany({ where: { jobId }, orderBy: { id: 'asc' } })
        expect(claims).toHaveLength(2)
        expect(claims.map((claim) => claim.writeToken)).toEqual(oldClaims.map((claim) => claim.writeToken))
        expect(claims.every((claim) => claim.executionToken === second.executionToken)).toBe(true)
        expect(await db().artworkContentSource.findUniqueOrThrow({ where: { artworkId: artwork.id } })).toEqual(
          oldSource
        )
        const snapshot = inspection.value.snapshot
        const owner = snapshot.claims[0]!.owner
        await expect(
          db().$transaction((tx) =>
            withMediaContentOwnerPublication(
              tx,
              {
                owner: { ...owner, sessionVersion: BigInt(owner.sessionVersion) },
                handles: snapshot.claims.map((claim) => ({
                  ...claim.handle,
                  declarationVersion: BigInt(claim.handle.declarationVersion)
                })),
                outcome: 'committed',
                now
              },
              async () => undefined
            )
          )
        ).rejects.toThrow()
        return finalize(operation)
      }
      await executeArchiveMaintenance(resumed, { database: db(), config: { scanRoot: root } })
      expect(await db().systemJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: 'COMPLETED' })
      expect(
        await db().mediaContentRecoveryGrant.findUniqueOrThrow({ where: { id: granted.value.grantId } })
      ).toMatchObject({
        status: 'CONSUMED',
        consumedExecutionToken: second.executionToken
      })
      const finalClaims = await db().mediaContentPathWrite.findMany({ where: { jobId }, orderBy: { id: 'asc' } })
      expect(finalClaims).toHaveLength(2)
      for (const [index, claim] of finalClaims.entries()) {
        expect(claim).toMatchObject({
          status: 'COMPLETED',
          declarationVersion: oldClaims[index]!.declarationVersion + 2n
        })
      }
      await expect(
        executeArchiveMaintenance(original, { database: db(), config: { scanRoot: root } })
      ).rejects.toThrow()
      if (action === 'PURGE_ARCHIVE') {
        expect(await db().artwork.findUnique({ where: { id: artwork.id } })).toBeNull()
      } else {
        expect(await db().artwork.findUniqueOrThrow({ where: { id: artwork.id } })).toMatchObject({
          archiveLifecycleState: action === 'TRASH_ARCHIVE' ? 'TRASHED' : 'ACTIVE'
        })
        expect(await db().archiveRevision.count({ where: { artworkId: artwork.id } })).toBe(101)
      }
      for (const revision of revisions) {
        const target = action === 'RESTORE_ARCHIVE' ? revision.archivePath : revision.trashPath
        if (action === 'PURGE_ARCHIVE') {
          await expect(readFile(path.join(root, target, 'media/file.jpg'))).rejects.toMatchObject({ code: 'ENOENT' })
        } else {
          expect(await readFile(path.join(root, target, 'media/file.jpg'), 'utf8')).toBe('fixture')
          const source = action === 'TRASH_ARCHIVE' ? revision.archivePath : revision.trashPath
          await expect(readFile(path.join(root, source, 'media/file.jpg'))).rejects.toMatchObject({ code: 'ENOENT' })
        }
      }
      for (const sentinel of sentinels) expect(await readFile(path.join(root, sentinel), 'utf8')).toBe('fixture')
    }
  )

  it('rejects 101st revision path/date drift at grant, resume and consume without releasing gates', async () => {
    const fixture = await interruptedLargeMaintenance('TRASH_ARCHIVE')
    const { revisions, jobId, repository, root, oldClaims, oldSource, artwork, sentinels } = fixture
    const last = revisions[100]!
    const inspection = await inspectMaintenance(fixture)
    await db().archiveRevision.update({ where: { id: last.id }, data: { archivePath: `${last.archivePath}-changed` } })
    expect(await grantMaintenance(fixture, inspection)).toMatchObject({ status: 'STALE' })
    expect(await db().mediaContentRecoveryGrant.count({ where: { jobId } })).toBe(0)
    await db().archiveRevision.update({ where: { id: last.id }, data: { archivePath: last.archivePath } })
    const granted = await grantMaintenance(fixture, inspection)
    if (granted.status !== 'READY') throw new Error(`Grant rejected: ${granted.status}`)
    await db().archiveRevision.update({
      where: { id: last.id },
      data: { purgeAfter: new Date(last.purgeAfter.getTime() + 1) }
    })
    expect(await resumeMaintenance(fixture, granted.value.grantId)).toMatchObject({ status: 'STALE' })
    expect(await db().systemJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: 'PAUSED' })
    await db().archiveRevision.update({ where: { id: last.id }, data: { purgeAfter: last.purgeAfter } })
    expect(await resumeMaintenance(fixture, granted.value.grantId)).toMatchObject({ status: 'READY' })
    const second = (await repository.claim(`${prefix}-large-drift-worker`, capabilities))!
    expect(second.id).toBe(jobId)
    await db().archiveRevision.update({ where: { id: last.id }, data: { trashPath: `${last.trashPath}-changed` } })
    await executeArchiveMaintenance(executionContext(repository, second), {
      database: db(),
      config: { scanRoot: root }
    })
    expect(await db().systemJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: 'PAUSED' })
    expect(
      await db().systemJobEvent.findFirstOrThrow({
        where: { jobId, attempt: second.attempt, type: 'job.paused' }
      })
    ).toMatchObject({ data: { reason: 'ACTION_REQUIRED', data: { errorCode: 'CONTENT_WRITE_RECOVERY_REQUIRED' } } })
    expect(
      await db().mediaContentRecoveryGrant.findUniqueOrThrow({ where: { id: granted.value.grantId } })
    ).toMatchObject({ status: 'ACTIVE' })
    expect(await db().mediaContentPathWrite.findMany({ where: { jobId }, orderBy: { id: 'asc' } })).toEqual(oldClaims)
    expect(await db().artworkContentSource.findUniqueOrThrow({ where: { artworkId: artwork.id } })).toEqual(oldSource)
    for (const revision of revisions)
      expect(await readFile(path.join(root, revision.trashPath, 'media/file.jpg'), 'utf8')).toBe('fixture')
    for (const sentinel of sentinels) expect(await readFile(path.join(root, sentinel), 'utf8')).toBe('fixture')
  })
})

type RecoverableMaintenanceAction = 'TRASH_ARCHIVE' | 'RESTORE_ARCHIVE' | 'PURGE_ARCHIVE'

async function interruptedLargeMaintenance(action: RecoverableMaintenanceAction) {
  const root = await temporaryRoot()
  const now = new Date()
  const artwork = await db().artwork.create({
    data: {
      title: prefix,
      createdVia: 'URL_ARCHIVE',
      source: 'URL_ARCHIVE',
      deletedAt: now,
      archiveLifecycleState:
        action === 'TRASH_ARCHIVE' ? 'TRASHING' : action === 'RESTORE_ARCHIVE' ? 'RESTORING' : 'TRASHED'
    }
  })
  const externalRef = await db().artworkExternalRef.create({
    data: {
      artworkId: artwork.id,
      providerKey: 'large-maintenance',
      externalId: `${prefix}-${action}`,
      canonicalUrl: 'https://example.test/large-maintenance',
      locator: {}
    }
  })
  const revisions = Array.from({ length: 101 }, (_, index) => {
    const suffix = String(index + 1).padStart(3, '0')
    const archivePath = `sources/test/bucket/${prefix}/revisions/${suffix}`
    return {
      id: `${prefix}-large-${suffix}`,
      artworkId: artwork.id,
      externalRefId: externalRef.id,
      archivePath,
      trashPath: `.trash/archive/${artwork.id}/${suffix}`,
      manifestPath: `${archivePath}/manifest.json`,
      mediaSnapshot: [],
      metadataHash: 'e'.repeat(64),
      isCurrent: index === 100,
      trashedAt: now,
      purgeAfter: new Date(now.getTime() - 1000)
    }
  })
  await db().archiveRevision.createMany({ data: revisions })
  await db().image.create({ data: { artworkId: artwork.id, path: `${revisions[100]!.archivePath}/media/file.jpg` } })
  for (const revision of revisions)
    await writeFixture(root, `${action === 'TRASH_ARCHIVE' ? revision.archivePath : revision.trashPath}/media/file.jpg`)
  const sentinels = [
    `sources/test/bucket/${prefix}-neighbor/revisions/001/media/file.jpg`,
    `.trash/archive/${artwork.id + 1}/001/media/file.jpg`
  ]
  for (const sentinel of sentinels) await writeFixture(root, sentinel)
  const jobId = await seedSystemJob(
    `${prefix}-large-${action}`,
    'ARCHIVE_MAINTENANCE',
    { action, artworkId: artwork.id },
    now
  )
  const repository = new PostgresQueueRepository(db() as unknown as QueueDatabase, {
    clock: new MutableQueueClock(now),
    leaseDurationMs: 60_000,
    transactionMaxWaitMs: 5_000,
    transactionTimeoutMs: 20_000
  })
  const first = (await repository.claim(`${prefix}-large-worker`, capabilities))!
  expect(first.id).toBe(jobId)
  const original = executionContext(repository, first)
  const crashed = {
    ...original,
    finalizeInTransaction: async () => {
      throw new Error('injected before large maintenance commit')
    }
  }
  await expect(executeArchiveMaintenance(crashed, { database: db(), config: { scanRoot: root } })).rejects.toThrow(
    'injected'
  )
  const oldSource = await db().artworkContentSource.findUniqueOrThrow({ where: { artworkId: artwork.id } })
  const oldClaims = await db().mediaContentPathWrite.findMany({ where: { jobId }, orderBy: { id: 'asc' } })
  expect(oldClaims).toHaveLength(2)
  expect(oldClaims.every((claim) => claim.status === 'ACTIVE')).toBe(true)
  // The failed executor has returned; no filesystem work remains running before offline recovery.
  await original.finalizeInTransaction(async (scope) => {
    await scope.pause({ reason: 'ACTION_REQUIRED', message: 'Fixture interrupted before business commit' })
  })
  return { root, now, artwork, jobId, repository, original, oldSource, oldClaims, revisions, sentinels }
}

async function inspectMaintenance(fixture: { jobId: string; now: Date }) {
  const inspection = await db().$transaction((tx) =>
    inspectMediaContentRecovery(tx, {
      jobId: fixture.jobId,
      sessionId: `archive-maintenance:${fixture.jobId}`,
      now: fixture.now,
      readDomainSnapshot: readExecutorMediaRecoveryDomainSnapshot
    })
  )
  if (inspection.status !== 'READY') throw new Error(`Inspection rejected: ${inspection.status}`)
  return inspection
}

function grantMaintenance(fixture: { now: Date }, inspection: Awaited<ReturnType<typeof inspectMaintenance>>) {
  return db().$transaction((tx) =>
    grantMediaContentRecovery(tx, {
      snapshot: inspection.value.snapshot,
      expectedDigest: inspection.value.digest,
      backupCheckpointRef: 'disposable-large-fixture-checkpoint',
      operator: 'fixture-operator',
      confirmAllWritersStopped: true,
      now: fixture.now,
      readDomainSnapshot: readExecutorMediaRecoveryDomainSnapshot
    })
  )
}

function resumeMaintenance(fixture: { now: Date }, grantId: string) {
  return db().$transaction((tx) =>
    resumeGrantedMediaContentRecovery(tx, {
      grantId,
      operator: 'fixture-operator',
      confirmAllWritersStopped: true,
      now: fixture.now,
      readDomainSnapshot: readExecutorMediaRecoveryDomainSnapshot
    })
  )
}

async function runClaimedMaintenance(jobId: string, root: string, now: Date) {
  const repository = new PostgresQueueRepository(db() as unknown as QueueDatabase, {
    clock: new MutableQueueClock(now),
    leaseDurationMs: 60_000,
    transactionMaxWaitMs: 5_000,
    transactionTimeoutMs: 20_000
  })
  const claimed = await repository.claim(`${prefix}-worker`, capabilities)
  expect(claimed?.id).toBe(jobId)
  await executeArchiveMaintenance(executionContext(repository, claimed!), {
    database: db(),
    config: { scanRoot: root },
    now: () => now
  })
}

async function seedSystemJob(
  id: string,
  type: 'ARCHIVE_IMPORT' | 'ARCHIVE_MAINTENANCE',
  payload: Record<string, unknown>,
  now: Date,
  status: 'PENDING' | 'COMPLETED' = 'PENDING'
) {
  await db().systemJob.create({
    data: {
      id,
      type,
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: 1,
      status,
      triggerSource: type === 'ARCHIVE_MAINTENANCE' ? 'MANUAL' : 'SYSTEM',
      payload: payload as Prisma.InputJsonValue,
      queuePriority: 0,
      effectivePriority: 0,
      availableAt: now,
      maxAttempts: 3,
      ...(status === 'COMPLETED' ? { finishedAt: now, progress: 100 } : {})
    }
  })
  return id
}

function executionContext(repository: PostgresQueueRepository, job: ClaimedJob) {
  const fence = { jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt }
  const context: ExecutionContext<ArchiveMaintenancePayload, EnqueuedChildJob> = {
    job,
    payload: job.payload as ArchiveMaintenancePayload,
    signal: new AbortController().signal,
    progress: (update) => repository.updateProgress({ ...fence, ...update }),
    enqueueChild: async () => {
      throw new Error('archive maintenance does not enqueue child jobs')
    },
    mutateInTransaction: (operation) => repository.withFencedMutationTransaction(fence, operation),
    finalizeInTransaction: async (operation) => {
      await repository.withFencedExecutionTransaction(fence, operation)
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  }
  return context
}

async function cleanupDatabase() {
  if (!prisma) return
  await prisma.archiveImport.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.artwork.deleteMany({ where: { title: prefix } })
  await prisma.jobResourceLease.deleteMany({ where: { ownerJobId: { startsWith: prefix } } })
  await prisma.mediaContentRecoveryGrant.deleteMany({ where: { jobId: { startsWith: prefix } } })
  await prisma.systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
  // Test executors have returned before cleanup; remove only these synthetic roots' durable claims.
  for (const root of roots) {
    const binding = await resolveMediaContentRoots({
      sourceRoot: root,
      archiveRoot: root,
      expectedPixivRootIdentity: null
    })
    await prisma.mediaContentPathWrite.deleteMany({
      where: { directory: { rootIdentity: binding.source.rootIdentity } }
    })
    await prisma.mediaContentDirectoryState.deleteMany({ where: { rootIdentity: binding.source.rootIdentity } })
  }
}

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-archive-maintenance-pg-'))
  roots.push(root)
  return root
}

async function writeFixture(root: string, relativePath: string) {
  const target = path.join(root, relativePath)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, 'fixture')
}

function db() {
  if (!prisma) throw new Error('QUEUE_KERNEL_TEST_DATABASE_URL is required')
  return prisma
}
