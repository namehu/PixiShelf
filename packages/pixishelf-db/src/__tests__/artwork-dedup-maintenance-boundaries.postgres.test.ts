import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { db, seed, prepared, cleanupFixture, cleanupJobs } from './artwork-dedup-maintenance-fixture'
import { completeArtworkDedupPrepare, validateArtworkDedupOperationSnapshot } from '../artwork-dedup-review'
import { saveArtworkDedupOperationFilesPage } from '../artwork-dedup-operation'
import {
  inspectArtworkDedupOperationReaderRecovery,
  recoverArtworkDedupOperationReader,
  isArtworkDedupPrepareRetryable
} from '../artwork-dedup-operation-reader-recovery'

describe.skipIf(!db)('maintenance narrow SQL and reader recovery boundaries', () => {
  afterEach(cleanupJobs)
  afterAll(cleanupFixture)
  it.each(['CHAPTER', 'META', 'MANIFEST'])(
    'does not trust caller ownership when a foreign %s reference shares the physical path',
    async (kind) => {
      const f = await db!.$transaction((tx) => seed(tx))
      await db!.artworkDedupRun.update({
        where: { id: f.run.id },
        data: {
          rootBindings: {
            version: 1,
            source: { logicalRoot: 'source-media:v1', rootIdentity: 'fixture' },
            archive: { logicalRoot: 'source-media:v1', rootIdentity: 'fixture' },
            archiveRelativePrefix: ''
          }
        }
      })
      const execution = await db!.$transaction((tx) => prepared(tx, f))
      const [target, foreign] = await db!.image.findMany({
        where: { artworkId: { in: f.members.flat() } },
        orderBy: { id: 'asc' }
      })
      if (kind === 'CHAPTER')
        await db!.image.update({ where: { id: foreign!.id }, data: { chaptersPath: target!.path } })
      else if (kind === 'META')
        await db!.artwork.update({ where: { id: foreign!.artworkId! }, data: { metaSource: target!.path } })
      else {
        const ref = await db!.artworkExternalRef.create({
          data: {
            artworkId: foreign!.artworkId!,
            providerKey: 'fixture',
            externalId: randomUUID(),
            canonicalUrl: 'https://example.invalid',
            locator: {}
          }
        })
        await db!.archiveRevision.create({
          data: {
            artworkId: foreign!.artworkId!,
            externalRefId: ref.id,
            archivePath: 'fixture',
            manifestPath: target!.path,
            mediaSnapshot: [],
            metadataHash: 'a'.repeat(64),
            isCurrent: true
          }
        })
      }
      await db!.$transaction((tx) =>
        saveArtworkDedupOperationFilesPage(tx, {
          execution,
          entries: [
            {
              artworkId: target!.artworkId!,
              imageId: target!.id,
              referenceKey: `media:${target!.id}`,
              role: 'MEDIA',
              logicalRoot: 'source-media:v1',
              rootIdentity: 'fixture',
              canonicalPath: target!.path,
              size: 10n,
              status: 'VERIFIED',
              ownershipStatus: 'VERIFIED',
              inspectionStatus: 'VERIFIED'
            }
          ]
        })
      )
      expect(
        await db!.artworkDedupOperationFile.findUnique({
          where: {
            operationId_referenceKey: { operationId: execution.operationId, referenceKey: `media:${target!.id}` }
          }
        })
      ).toMatchObject({ status: 'BLOCKED', ownershipStatus: 'SHARED', blockReason: 'SHARED_PATH' })
    }
  )
  it('does not turn a duplicated COPY path into inflated reclaimable bytes', async () => {
    const f = await db!.$transaction((tx) => seed(tx))
    const execution = await db!.$transaction((tx) => prepared(tx, f))
    const copy = await db!.artworkDedupOperationArtwork.findFirstOrThrow({
      where: { operationId: execution.operationId, role: 'COPY' }
    })
    const file = await db!.artworkDedupOperationFile.findFirstOrThrow({
      where: { operationId: execution.operationId, artworkId: copy.artworkId }
    })
    const { fileId: _fileId, operationId: _operationId, version: _version, ...entry } = file
    await db!.$transaction((tx) =>
      saveArtworkDedupOperationFilesPage(tx, {
        execution,
        entries: [{ ...entry, referenceKey: `${entry.referenceKey}:duplicate`, ownershipStatus: 'VERIFIED' }]
      })
    )
    const result = await db!.$transaction((tx) => completeArtworkDedupPrepare(tx, { execution }))
    expect(result).toMatchObject({ status: 'FAILED', logicalBytes: null, preparedFiles: 3n })
  })
  it('validates only the requested frozen member on a page, then all members at completion', async () => {
    const f = await db!.$transaction((tx) => seed(tx))
    const execution = await db!.$transaction((tx) => prepared(tx, f))
    const [current, changed] = f.members[0]!
    const image = await db!.image.findFirstOrThrow({ where: { artworkId: changed } })
    await db!.image.update({ where: { id: image.id }, data: { size: 11n } })
    expect(
      await db!.$transaction((tx) => validateArtworkDedupOperationSnapshot(tx, execution.operationId, current))
    ).toBe(true)
    expect(await db!.$transaction((tx) => validateArtworkDedupOperationSnapshot(tx, execution.operationId))).toBe(false)
    await expect(
      db!.$transaction((tx) => validateArtworkDedupOperationSnapshot(tx, execution.operationId, 2147483647))
    ).rejects.toMatchObject({ code: 'SCOPE_MISMATCH' })
  })
  it('requires stopped dispatchers and a fresh exact inspection before releasing an offline operation reader', async () => {
    const f = await db!.$transaction((tx) => seed(tx))
    const execution = await db!.$transaction((tx) => prepared(tx, f))
    await db!.artworkDedupOperation.update({
      where: { id: execution.operationId },
      data: { readerToken: 'fixture-reader', readerState: 'BLOCKED' }
    })
    const inspect = () =>
      db!.$transaction((tx) =>
        inspectArtworkDedupOperationReaderRecovery(tx, { operationId: execution.operationId, now: new Date() })
      )
    await expect(inspect()).rejects.toMatchObject({ status: 'WRITING' })
    await db!.systemJob.update({
      where: { id: execution.jobId },
      data: { status: 'PAUSED', workerId: null, leaseToken: null, leaseExpiresAt: null }
    })
    const first = await inspect()
    const input = {
      operationId: execution.operationId,
      expectedDigest: first.digest,
      expectedReaderToken: 'fixture-reader',
      operator: 'fixture',
      confirmAllWritersStopped: true,
      now: new Date()
    }
    const recover = (change = {}) =>
      db!.$transaction((tx) => recoverArtworkDedupOperationReader(tx, { ...input, ...change }))
    await expect(recover({ confirmAllWritersStopped: false })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(recover({ expectedReaderToken: 'different' })).rejects.toMatchObject({ code: 'CONFLICT' })
    await db!.artworkDedupOperation.update({
      where: { id: execution.operationId },
      data: { version: { increment: 1 } }
    })
    await expect(recover()).rejects.toMatchObject({ code: 'CONFLICT' })
    let release!: () => void, ready!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const locked = new Promise<void>((resolve) => (ready = resolve))
    const dispatcher = db!.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('lane/background-writer',0))::text`
      ready()
      await gate
    })
    await locked
    try {
      await expect(inspect()).rejects.toMatchObject({ status: 'WRITING' })
    } finally {
      release()
      await dispatcher
    }
    const current = await inspect()
    expect(await recover({ expectedDigest: current.digest })).toEqual({
      operationId: execution.operationId,
      recovered: true
    })
    const op = await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: execution.operationId } })
    const job = await db!.systemJob.findUniqueOrThrow({ where: { id: execution.jobId } })
    expect(op).toMatchObject({ status: 'BUILDING', readerState: 'IDLE', readerToken: null, executionVersion: 1 })
    expect(isArtworkDedupPrepareRetryable(op, job, new Date())).toBe(true)
    expect(
      isArtworkDedupPrepareRetryable(op, { ...job, leaseExpiresAt: new Date(Date.now() + 60000) }, new Date())
    ).toBe(false)
    expect(isArtworkDedupPrepareRetryable({ ...op, readerToken: 'still-alive' }, job, new Date())).toBe(false)
    expect(await db!.systemJobEvent.count({ where: { jobId: job.id, type: 'job.stage_changed' } })).toBe(1)
    await expect(recover({ expectedDigest: current.digest })).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})
