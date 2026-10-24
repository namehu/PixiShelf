import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { db, seed, cleanupFixture, prefix } from './artwork-dedup-maintenance-fixture'
import { captureArtworkDedupSources } from '../artwork-dedup-claims'
import { inspectArtworkDedupArchiveDrain } from '../artwork-dedup-archive-drain'
describe.skipIf(!db)('archive maintenance drain evidence', () => {
  afterAll(cleanupFixture)
  it('counts every attempt/token, including old FAILED jobs, without treating leases or HOLD as drain', async () => {
    await expect(
      db!.$transaction(async (tx) => {
        const f = await seed(tx)
        const op = await tx.artworkDedupOperation.create({
          data: {
            runId: f.run.id,
            artistId: f.artist.id,
            requestedBy: f.actor.id,
            idempotencyKey: randomUUID(),
            requestDigest: prefix,
            runVersion: 1,
            frozenReviewRevision: 0,
            selectionKind: 'EXPLICIT'
          }
        })
        const source = (
          await captureArtworkDedupSources(tx, {
            identities: [{ kind: 'PROVIDER', providerKey: 'fixture', externalId: prefix }]
          })
        )[0]!
        await tx.artworkDedupOperationSource.create({
          data: {
            operationId: op.id,
            artworkId: f.members[0]![0]!,
            sourceId: source.sourceId,
            frozenGeneration: source.generation
          }
        })
        await tx.artworkDedupSourceIdentity.update({
          where: { id: source.sourceId },
          data: { status: 'HOLD', ownerOperationId: op.id }
        })
        const job = await tx.systemJob.create({
          data: {
            type: 'ARCHIVE_DOWNLOAD',
            executionLane: 'ARCHIVE_DOWNLOAD',
            payload: {},
            status: 'FAILED',
            attempt: 2
          }
        })
        const item = await tx.archiveImport.create({
          data: {
            systemJobId: job.id,
            providerKey: 'fixture',
            externalId: prefix,
            submittedUrl: 'https://example.invalid',
            canonicalUrl: 'https://example.invalid',
            locator: {},
            normalizedMetadata: {},
            rawMetadata: {},
            metadataHash: 'a'.repeat(64),
            creatorBucket: prefix,
            stagingPath: prefix,
            phase: 'DOWNLOAD',
            status: 'FAILED'
          }
        })
        const first = await tx.archiveStagingGeneration.create({
          data: {
            token: randomUUID(),
            jobId: job.id,
            archiveImportId: item.id,
            path: prefix,
            drainedAt: new Date(),
            sealedAt: new Date(),
            manifestSha256: 'a'.repeat(64)
          }
        })
        expect(await inspectArtworkDedupArchiveDrain(tx, op.id)).toMatchObject({
          drained: false,
          unregisteredJobIds: [job.id],
          undrainedTokens: []
        })
        const second = await tx.archiveStagingGeneration.create({
          data: { token: randomUUID(), jobId: job.id, archiveImportId: item.id, path: prefix }
        })
        expect(await inspectArtworkDedupArchiveDrain(tx, op.id)).toMatchObject({
          drained: false,
          unregisteredJobIds: [],
          undrainedTokens: [second.token]
        })
        await tx.archiveStagingGeneration.update({ where: { token: second.token }, data: { drainedAt: new Date() } })
        expect(await inspectArtworkDedupArchiveDrain(tx, op.id)).toMatchObject({ drained: true })
        const cleanupJob = await tx.systemJob.create({
          data: {
            type: 'ARCHIVE_MAINTENANCE',
            executionLane: 'BACKGROUND_WRITER',
            status: 'RUNNING',
            workerId: prefix, leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000),
            payload: { action: 'CLEAN_STAGING', archiveImportId: item.id }
          }
        })
        expect(await inspectArtworkDedupArchiveDrain(tx, op.id)).toMatchObject({
          drained: false,
          stopJobIds: [cleanupJob.id],
          activeWriteIds: []
        })
        const directory = await tx.mediaContentDirectoryState.create({
          data: {
            logicalRoot: 'archive-media:v1',
            rootIdentity: prefix,
            relativeDirectory: `${prefix}/staging`
          }
        })
        const write = await tx.mediaContentPathWrite.create({
          data: {
            directoryId: directory.id,
            scope: 'DIRECTORY',
            sessionId: `archive-cleanup:${cleanupJob.id}`,
            sessionVersion: 1n,
            writeToken: randomUUID(),
            jobId: cleanupJob.id,
            executionToken: cleanupJob.leaseToken, executionAttempt: 1,
            startedAt: new Date()
          }
        })
        for (const status of ['FAILED', 'CANCELLED'] as const) {
          await tx.systemJob.update({ where: { id: cleanupJob.id }, data: { status, workerId: null, leaseToken: null, leaseExpiresAt: null } })
          expect(await inspectArtworkDedupArchiveDrain(tx, op.id)).toMatchObject({
            drained: false,
            stopJobIds: [],
            activeWriteIds: [write.id]
          })
        }
        // Session binding still finds a declaration even when its optional jobId is missing.
        await tx.mediaContentPathWrite.update({
          where: { id: write.id },
          data: { jobId: null, executionToken: null, executionAttempt: null, status: 'RECOVERY_REQUIRED' }
        })
        expect(await inspectArtworkDedupArchiveDrain(tx, op.id)).toMatchObject({
          drained: false,
          activeWriteIds: [write.id]
        })
        await tx.mediaContentPathWrite.update({ where: { id: write.id }, data: { status: 'COMPLETED' } })
        // An unrelated operation/lifecycle task is not an old Import cleanup and cannot self-block drain.
        await tx.systemJob.create({
          data: {
            type: 'ARCHIVE_MAINTENANCE',
            executionLane: 'BACKGROUND_WRITER',
            status: 'RUNNING',
            workerId: prefix, leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000),
            payload: { action: 'RECONCILE', archiveImportId: item.id }
          }
        })
        await tx.systemJob.create({
          data: {
            type: 'ARCHIVE_MAINTENANCE',
            executionLane: 'BACKGROUND_WRITER',
            status: 'PENDING',
            payload: { action: 'CLEAN_STAGING', archiveImportId: `${item.id}-other` }
          }
        })
        expect(await inspectArtworkDedupArchiveDrain(tx, op.id)).toMatchObject({
          drained: true,
          stopJobIds: [],
          activeWriteIds: []
        })

        const old = await tx.systemJob.create({
          data: {
            type: 'ARCHIVE_DOWNLOAD',
            executionLane: 'ARCHIVE_DOWNLOAD',
            payload: {},
            status: 'FAILED',
            attempt: 1
          }
        })
        await tx.archiveImportExecution.create({ data: { jobId: old.id, archiveImportId: item.id, phase: 'DOWNLOAD' } })
        expect(await inspectArtworkDedupArchiveDrain(tx, op.id)).toMatchObject({
          drained: false,
          unregisteredJobIds: [old.id]
        })
        await tx.archiveStagingGeneration.create({
          data: { token: randomUUID(), jobId: old.id, archiveImportId: item.id, path: prefix, drainedAt: new Date() }
        })
        await tx.systemJob.update({
          where: { id: job.id },
          data: { status: 'CANCELLING', workerId: prefix, leaseToken: first.token, leaseExpiresAt: new Date(0) }
        })
        expect(await inspectArtworkDedupArchiveDrain(tx, op.id)).toMatchObject({ drained: false, stopJobIds: [job.id] })
        expect(await tx.archiveStagingGeneration.findUnique({ where: { token: first.token } })).toMatchObject({
          drainedAt: first.drainedAt
        })
        throw new Error('rollback synthetic archive drain')
      })
    ).rejects.toThrow('rollback synthetic archive drain')
  })
})
