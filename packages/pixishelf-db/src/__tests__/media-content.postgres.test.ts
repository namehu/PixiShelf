import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import { lockCreatorCatalog } from '../creators'
import { assertMediaContentDirectorySnapshot, captureMediaContentDirectory } from '../media-content-directory'
import {
  bindMediaContentDirectories,
  captureArtworkContentSnapshot,
  observeMediaContentSources,
  publishArtworkContentFingerprint,
  publishMediaContentFingerprints,
  readArtworkContentFingerprintPage,
  readArtworkContentMembersPage
} from '../media-content-evidence'
import {
  ackMediaContentUploadChunk,
  assertMediaContentOwnerPublication,
  beginMediaContentPathWrite,
  beginMediaContentSourceWrite,
  finishMediaContentSourceWrite,
  getMediaContentUploadCheckpoint,
  markMediaContentWriteRecoveryRequired,
  prepareMediaContentUploadChunk,
  rebindCompletedArchivePublicationMediaWrite,
  resolveMediaContentChildWrites,
  resumeMediaContentSourceWrite,
  restartMediaContentUploadFromStart,
  withMediaContentOwnerPublication
} from '../media-content-writes'
import type {
  MediaContentChunkReceipt,
  MediaContentDirectoryKey,
  MediaContentOwner,
  MediaContentReadEvidence,
  MediaContentResult,
  MediaContentTransaction
} from '../media-content-types'

const url =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const database = url ? new PrismaClient({ datasourceUrl: url }) : null
const fixtureRootPrefix = 'media-content-fixture-root-'
const fixtureRootIdentity = `${fixtureRootPrefix}${randomUUID()}`
const fixtureDirectoryPrefix = `content-fixture-${randomUUID()}`
const rollback = new Error('rollback content fixture')
const now = new Date('2026-10-23T00:00:00Z')
const hash = 'a'.repeat(64)
const owner: MediaContentOwner = {
  ownerUserId: 'fixture-account',
  sessionId: 'fixture-session',
  sessionVersion: 1n,
  execution: null
}
const ready = <T>(result: MediaContentResult<T> | { status: 'OBSERVATION_REQUIRED' }): T => {
  expect(result.status).toBe('READY')
  if (result.status !== 'READY') throw new Error(result.status)
  return result.value
}
async function isolated(body: (tx: MediaContentTransaction) => Promise<void>) {
  await expect(
    database!.$transaction(
      async (tx) => {
        await body(tx)
        throw rollback
      },
      { timeout: 30_000 }
    )
  ).rejects.toBe(rollback)
}
async function directoryKey(tx: MediaContentTransaction): Promise<MediaContentDirectoryKey> {
  await lockCreatorCatalog(tx)
  const root = await tx.mediaContentDirectoryState.findUnique({
    where: { logicalRoot_relativeDirectory: { logicalRoot: 'source-media:v1', relativeDirectory: '' } }
  })
  return {
    logicalRoot: 'source-media:v1',
    rootIdentity: root?.rootIdentity ?? fixtureRootIdentity,
    relativeDirectory: `${fixtureDirectoryPrefix}-${randomUUID()}`
  }
}
async function fixture(tx: MediaContentTransaction, count = 2) {
  // Artwork DML takes the catalog lock; production writers acquire it before media root locks.
  await lockCreatorCatalog(tx)
  const directory = ready(await captureMediaContentDirectory(tx, { directory: await directoryKey(tx) }))
  const artwork = await tx.artwork.create({ data: { title: 'content fixture' } })
  await tx.image.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      artworkId: artwork.id,
      path: `/${directory.relativeDirectory}/${i}.jpg`,
      size: 10n,
      sortOrder: i
    }))
  })
  const snapshot = ready(await captureArtworkContentSnapshot(tx, { artworkId: artwork.id }))
  const members = ready(await readArtworkContentMembersPage(tx, { snapshot, afterImageId: null, limit: 500 })).members
  const bindings = members.slice(0, 100).map((member) => ({
    imageId: member.imageId,
    expectedSourcePath: member.sourcePath,
    expectedSourceRevision: member.sourceRevision,
    directory
  }))
  if (bindings.length) ready(await bindMediaContentDirectories(tx, { snapshot, bindings }))
  const entries: MediaContentReadEvidence[] = bindings.map((binding, i) => ({
    ...binding,
    canonicalPath: binding.expectedSourcePath.slice(1),
    state: {
      size: 9007199254740993n + BigInt(i),
      mtimeNs: 1700000000000000001n,
      ctimeNs: 1700000000000000002n,
      deviceId: 8n,
      inode: 9007199254740995n
    },
    sha256: hash,
    hashedAt: now
  }))
  return { artwork, directory, snapshot, members, entries }
}

async function archiveHandoffFixture(tx: MediaContentTransaction) {
  const { directory, artwork } = await fixture(tx, 1)
  const executionToken = randomUUID()
  const expires = new Date(now.getTime() + 60_000)
  const job = await tx.systemJob.create({
    data: {
      type: 'ARCHIVE_PUBLISH',
      status: 'RUNNING',
      attempt: 2,
      workerId: 'content-fixture',
      leaseToken: executionToken,
      leaseExpiresAt: expires
    }
  })
  const download = await tx.systemJob.create({
    data: { type: 'ARCHIVE_DOWNLOAD', executionLane: 'ARCHIVE_DOWNLOAD', status: 'COMPLETED' }
  })
  const generationToken = randomUUID()
  const externalId = randomUUID()
  const stagingPath = `${directory.relativeDirectory}/staging`
  const reference = await tx.artworkExternalRef.create({
    data: {
      artworkId: artwork.id,
      providerKey: 'content-fixture',
      externalId,
      canonicalUrl: 'https://fixture.invalid/content',
      locator: {}
    }
  })
  const archiveImport = await tx.archiveImport.create({
    data: {
      systemJobId: job.id,
      phase: 'PUBLISH',
      generationToken,
      sealedManifestSha256: hash,
      providerKey: reference.providerKey,
      externalId,
      externalRefId: reference.id,
      submittedUrl: reference.canonicalUrl,
      canonicalUrl: reference.canonicalUrl,
      locator: {},
      status: 'RUNNING',
      normalizedMetadata: {},
      rawMetadata: {},
      metadataHash: hash,
      creatorBucket: 'fixture',
      stagingPath
    }
  })
  await tx.archiveImportExecution.createMany({
    data: [
      { jobId: job.id, archiveImportId: archiveImport.id, phase: 'PUBLISH' },
      { jobId: download.id, archiveImportId: archiveImport.id, phase: 'DOWNLOAD' }
    ]
  })
  await tx.archiveStagingGeneration.create({
    data: {
      token: generationToken,
      archiveImportId: archiveImport.id,
      jobId: download.id,
      path: stagingPath,
      manifestSha256: hash,
      sealedAt: now,
      drainedAt: now
    }
  })
  await tx.jobResourceLease.create({
    data: {
      resourceKey: 'lane/background-writer',
      ownerJobId: job.id,
      workerId: job.workerId!,
      leaseToken: executionToken,
      expiresAt: expires,
      heartbeatAt: now
    }
  })
  const previousOwner: MediaContentOwner = {
    ownerUserId: null,
    sessionId: `archive-publish:${archiveImport.id}`,
    sessionVersion: 1n,
    execution: { jobId: job.id, executionToken: randomUUID(), executionAttempt: 1 }
  }
  const handle = ready(
    await beginMediaContentPathWrite(tx, {
      directory,
      scope: { kind: 'DIRECTORY' },
      owner: previousOwner,
      writeToken: randomUUID(),
      upload: null,
      parent: null,
      now
    })
  )
  const source = await beginMediaContentSourceWrite(tx, {
    artworkIds: [artwork.id],
    imageIds: [],
    writeToken: handle.writeToken,
    now
  })
  const input: Parameters<typeof rebindCompletedArchivePublicationMediaWrite>[1] = {
    owner: { ...previousOwner, execution: { jobId: job.id, executionToken, executionAttempt: 2 } },
    previous: { owner: previousOwner, handle, source },
    expectedArtworkId: artwork.id,
    proof: {
      kind: 'FINAL_VERIFIED_STAGING_ABSENT',
      archiveImportId: archiveImport.id,
      generationToken,
      manifestSha256: hash,
      stagingPath,
      finalDirectory: directory
    },
    now
  }
  return input
}

describe.skipIf(!database)('media content source and publication contracts', () => {
  afterAll(async () => {
    if (!database) return
    try {
      await database.$transaction(async (tx) => {
        await lockCreatorCatalog(tx)
        const roots = await tx.$queryRaw<Array<{ id: string; rootIdentity: string }>>`
          SELECT id, "rootIdentity" FROM "MediaContentDirectoryState"
          WHERE "logicalRoot" = 'source-media:v1' AND "relativeDirectory" = ''
          FOR UPDATE`
        expect(
          await tx.mediaContentDirectoryState.count({
            where: { logicalRoot: 'source-media:v1', relativeDirectory: { startsWith: fixtureDirectoryPrefix } }
          })
        ).toBe(0)
        const root = roots[0]
        if (!root?.rootIdentity.startsWith(fixtureRootPrefix)) return
        // Recovery fixtures may still borrow this root. The last fixture suite releases it;
        // a pre-existing non-fixture root is never ours to delete.
        if (await tx.mediaContentDirectoryState.count({
          where: { logicalRoot: 'source-media:v1', relativeDirectory: { not: '' } }
        })) return
        await tx.mediaContentDirectoryState.delete({ where: { id: root.id } })
      })
    } finally {
      await database.$disconnect()
    }
  })
  it('keeps order/title independent, retains BigInt and actual hash time, and observes changes explicitly', async () =>
    isolated(async (tx) => {
      const { artwork, snapshot, entries } = await fixture(tx)
      expect(ready(await publishMediaContentFingerprints(tx, { snapshot, algorithmVersion: 1, entries }))).toEqual({
        count: 2
      })
      ready(
        await publishArtworkContentFingerprint(tx, {
          snapshot,
          algorithmVersion: 1,
          membersSignature: hash,
          contentSha256: hash,
          completedAt: now
        })
      )
      await tx.artwork.update({ where: { id: artwork.id }, data: { title: 'renamed' } })
      await tx.image.updateMany({ where: { artworkId: artwork.id }, data: { sortOrder: 9 } })
      expect(ready(await captureArtworkContentSnapshot(tx, { artworkId: artwork.id }))).toEqual(snapshot)
      const page = ready(await readArtworkContentMembersPage(tx, { snapshot, afterImageId: null, limit: 500 }))
      expect(page.members[0]!.fingerprint).toMatchObject({
        size: 9007199254740993n,
        hashedAt: now,
        inode: 9007199254740995n
      })
      const ordered = ready(
        await readArtworkContentFingerprintPage(tx, { snapshot, algorithmVersion: 1, after: null, limit: 1 })
      )
      expect(ordered.entries[0]!.size).toBe(9007199254740993n)
      expect(
        ready(
          await readArtworkContentFingerprintPage(tx, {
            snapshot,
            algorithmVersion: 1,
            after: ordered.nextCursor,
            limit: 1
          })
        ).entries[0]!.size
      ).toBe(9007199254740994n)
      const changed = { ...entries[0]!, sha256: 'b'.repeat(64) }
      expect(await publishMediaContentFingerprints(tx, { snapshot, algorithmVersion: 1, entries: [changed] })).toEqual({
        status: 'OBSERVATION_REQUIRED'
      })
      expect(ready(await captureArtworkContentSnapshot(tx, { artworkId: artwork.id }))).toEqual(snapshot)
      const observed = ready(await observeMediaContentSources(tx, { snapshot, observations: [changed] }))
      expect(observed.changed).toBe(true)
      expect(observed.snapshot.revision).toBe(snapshot.revision + 1n)
      expect(observed.changedSources).toEqual([{ imageId: changed.imageId, sourceRevision: 1n }])
      expect(
        await tx.mediaContentFingerprint.count({ where: { imageId: { in: entries.map((e) => e.imageId) } } })
      ).toBe(1)
      expect(await tx.artworkContentFingerprint.findUnique({ where: { artworkId: artwork.id } })).toBeNull()
      expect(await readArtworkContentMembersPage(tx, { snapshot, afterImageId: null, limit: 1 })).toEqual({
        status: 'STALE'
      })
    }))

  it('invalidates direct SQL path/member changes and full-replacement epochs, while token mismatch preserves gates', async () =>
    isolated(async (tx) => {
      const { artwork, snapshot, entries, members } = await fixture(tx)
      ready(await publishMediaContentFingerprints(tx, { snapshot, algorithmVersion: 1, entries }))
      await tx.$executeRaw`UPDATE "Image" SET path = '/moved.jpg' WHERE id = ${members[0]!.imageId}`
      expect(await readArtworkContentMembersPage(tx, { snapshot, afterImageId: null, limit: 1 })).toEqual({
        status: 'STALE'
      })
      expect(await tx.mediaContentSource.findUnique({ where: { imageId: members[0]!.imageId } })).toMatchObject({
        revision: 1n,
        directoryStateId: null
      })
      const before = ready(await captureArtworkContentSnapshot(tx, { artworkId: artwork.id }))
      const token = await beginMediaContentSourceWrite(tx, {
        artworkIds: [artwork.id],
        imageIds: [],
        writeToken: randomUUID(),
        now
      })
      expect(await captureArtworkContentSnapshot(tx, { artworkId: artwork.id })).toEqual({ status: 'WRITING' })
      expect(
        await finishMediaContentSourceWrite(tx, { token: { ...token, writeToken: 'wrong' }, outcome: 'committed' })
      ).toBe(false)
      expect(await captureArtworkContentSnapshot(tx, { artworkId: artwork.id })).toEqual({ status: 'WRITING' })
      expect(await finishMediaContentSourceWrite(tx, { token, outcome: 'verified-rollback' })).toBe(true)
      const after = ready(await captureArtworkContentSnapshot(tx, { artworkId: artwork.id }))
      expect(after.mediaEpoch).toBe(before.mediaEpoch + 1n)
      expect(
        await publishArtworkContentFingerprint(tx, {
          snapshot: after,
          algorithmVersion: 1,
          membersSignature: hash,
          contentSha256: hash,
          completedAt: now
        })
      ).toEqual({ status: 'INCOMPLETE' })
      await tx.image.delete({ where: { id: members[0]!.imageId } })
      expect(ready(await captureArtworkContentSnapshot(tx, { artworkId: artwork.id })).revision).toBe(
        after.revision + 1n
      )
    }))

  it('bounds one large artwork at 500 members and each evidence transaction at 100', async () =>
    isolated(async (tx) => {
      const { snapshot, members, entries } = await fixture(tx, 501)
      expect(snapshot.memberCount).toBe(501n)
      expect(members).toHaveLength(500)
      const page = ready(
        await readArtworkContentMembersPage(tx, { snapshot, afterImageId: members.at(-1)!.imageId, limit: 500 })
      )
      expect(page.members).toHaveLength(1)
      expect(page.nextCursor).toBeNull()
      await expect(readArtworkContentMembersPage(tx, { snapshot, afterImageId: null, limit: 501 })).rejects.toThrow()
      await expect(
        publishMediaContentFingerprints(tx, { snapshot, algorithmVersion: 1, entries: [...entries, entries[0]!] })
      ).rejects.toThrow()
      expect(
        await publishArtworkContentFingerprint(tx, {
          snapshot,
          algorithmVersion: 1,
          membersSignature: hash,
          contentSha256: hash,
          completedAt: now
        })
      ).toEqual({ status: 'INCOMPLETE' })
    }))

  it('keeps a READY upload gated, replays a lost response, and atomically publishes the Image', async () =>
    isolated(async (tx) => {
      // Image DML also acquires the catalog lock, including uploads without an Artwork.
      await lockCreatorCatalog(tx)
      const directory = await directoryKey(tx)
      const old = ready(await captureMediaContentDirectory(tx, { directory }))
      const handle = ready(
        await beginMediaContentPathWrite(tx, {
          directory,
          scope: { kind: 'PATH', relativePath: `${directory.relativeDirectory}/new.jpg` },
          owner,
          writeToken: randomUUID(),
          upload: { declaredFileSize: 4n, totalChunks: 1 },
          parent: null,
          now
        })
      )
      expect(await captureMediaContentDirectory(tx, { directory })).toEqual({ status: 'WRITING' })
      expect(
        ready(
          await prepareMediaContentUploadChunk(tx, {
            owner,
            handle,
            declaredFileSize: 4n,
            totalChunks: 1,
            requestId: 'chunk',
            chunkIndex: 0,
            offset: 0n,
            observedFileSize: 99n
          })
        ).action
      ).toBe('WRITE')
      const receipt: MediaContentChunkReceipt = {
        requestId: 'chunk',
        chunkIndex: 0,
        offset: 0n,
        byteLength: 4n,
        sha256: hash
      }
      const checkpoint = ready(
        await ackMediaContentUploadChunk(tx, { owner, handle, receipt, verifiedFileSize: 4n, now })
      )
      expect(checkpoint.status).toBe('READY')
      expect(
        ready(
          await prepareMediaContentUploadChunk(tx, {
            owner,
            handle,
            declaredFileSize: 4n,
            totalChunks: 1,
            requestId: 'chunk',
            chunkIndex: 0,
            offset: 0n,
            observedFileSize: 4n
          })
        ).action
      ).toBe('REPLAY')
      expect(
        ready(await ackMediaContentUploadChunk(tx, { owner, handle, receipt, verifiedFileSize: 4n, now })).handle
      ).toEqual(checkpoint.handle)
      expect(
        await getMediaContentUploadCheckpoint(tx, {
          owner: { ...owner, ownerUserId: 'other' },
          writeId: handle.writeId,
          writeToken: handle.writeToken
        })
      ).toEqual({ status: 'MISSING' })
      expect(await captureMediaContentDirectory(tx, { directory })).toEqual({ status: 'WRITING' })
      await expect(
        withMediaContentOwnerPublication(tx, { owner, handles: [handle], outcome: 'committed', now }, async () => null)
      ).rejects.toMatchObject({ status: 'STALE' })
      const result = await withMediaContentOwnerPublication(
        tx,
        { owner, handles: [checkpoint.handle], outcome: 'committed', now },
        (active) => active.image.create({ data: { path: '/new.jpg' } })
      )
      expect(await tx.image.findUnique({ where: { id: result.result.id } })).not.toBeNull()
      expect(
        ready(
          await getMediaContentUploadCheckpoint(tx, { owner, writeId: handle.writeId, writeToken: handle.writeToken })
        ).status
      ).toBe('COMPLETED')
      expect(await assertMediaContentDirectorySnapshot(tx, { snapshot: old })).toEqual({ status: 'STALE' })
      expect(ready(await captureMediaContentDirectory(tx, { directory })).generation).toBe(old.generation + 2n)
    }))

  it('restarts only an owned failed top-level upload and rejects every old chunk version without clearing its source gate', async () =>
    isolated(async (tx) => {
      const { directory, members } = await fixture(tx, 1)
      const handle = ready(
        await beginMediaContentPathWrite(tx, {
          directory,
          scope: { kind: 'PATH', relativePath: `${directory.relativeDirectory}/0.jpg` },
          owner,
          writeToken: randomUUID(),
          upload: { declaredFileSize: 4n, totalChunks: 2 },
          parent: null,
          now
        })
      )
      const source = await beginMediaContentSourceWrite(tx, {
        artworkIds: [],
        imageIds: [members[0]!.imageId],
        writeToken: handle.writeToken,
        now
      })
      const receipt = { requestId: 'first', chunkIndex: 0, offset: 0n, byteLength: 2n, sha256: hash }
      const ack = ready(await ackMediaContentUploadChunk(tx, { owner, handle, receipt, verifiedFileSize: 2n, now }))
      const failed = ready(
        await markMediaContentWriteRecoveryRequired(tx, { owner, handle: ack.handle, failureCode: 'UNKNOWN_IO', now })
      )
      expect(
        await restartMediaContentUploadFromStart(tx, {
          owner: { ...owner, ownerUserId: 'other-account' },
          handle: failed,
          now
        })
      ).toEqual({ status: 'STALE' })
      const restarted = ready(await restartMediaContentUploadFromStart(tx, { owner, handle: failed, now }))
      expect(restarted).toMatchObject({
        status: 'ACTIVE',
        declaredFileSize: 4n,
        totalChunks: 2,
        nextChunkIndex: 0,
        committedBytes: 0n,
        lastReceipt: null
      })
      expect(restarted.handle.declarationVersion).toBe(failed.declarationVersion + 1n)
      expect(
        await prepareMediaContentUploadChunk(tx, {
          owner,
          handle,
          declaredFileSize: 4n,
          totalChunks: 2,
          requestId: 'first',
          chunkIndex: 0,
          offset: 0n,
          observedFileSize: 2n
        })
      ).toEqual({ status: 'STALE' })
      expect(await ackMediaContentUploadChunk(tx, { owner, handle, receipt, verifiedFileSize: 2n, now })).toEqual({
        status: 'STALE'
      })
      expect(await restartMediaContentUploadFromStart(tx, { owner, handle: restarted.handle, now })).toEqual({
        status: 'STALE'
      })
      expect(await tx.mediaContentSource.findUnique({ where: { imageId: members[0]!.imageId } })).toMatchObject({
        writeToken: source.writeToken
      })
      expect(await captureMediaContentDirectory(tx, { directory })).toEqual({ status: 'WRITING' })
      expect(
        ready(
          await prepareMediaContentUploadChunk(tx, {
            owner,
            handle: restarted.handle,
            declaredFileSize: 4n,
            totalChunks: 2,
            requestId: 'restart-first',
            chunkIndex: 0,
            offset: 0n,
            observedFileSize: 2n
          })
        ).action
      ).toBe('WRITE')
    }))

  it('allows independent paths to finish despite directory generation changes and keeps intermediate claims', async () =>
    isolated(async (tx) => {
      const { directory, snapshot } = await fixture(tx)
      const begin = (path: string) =>
        beginMediaContentPathWrite(tx, {
          directory,
          scope: { kind: 'PATH', relativePath: `${directory.relativeDirectory}/${path}` },
          owner,
          writeToken: randomUUID(),
          upload: null,
          parent: null,
          now
        })
      const first = ready(await begin('a.jpg'))
      const second = ready(await begin('b.jpg'))
      expect(await begin('a.jpg')).toEqual({ status: 'WRITING' })
      expect(await readArtworkContentMembersPage(tx, { snapshot, afterImageId: null, limit: 1 })).toEqual({
        status: 'STALE'
      })
      await assertMediaContentOwnerPublication(tx, { owner, handles: [first] })
      expect(await captureMediaContentDirectory(tx, { directory })).toEqual({ status: 'WRITING' })
      await withMediaContentOwnerPublication(
        tx,
        { owner, handles: [first], outcome: 'committed', now },
        async () => null
      )
      expect(await captureMediaContentDirectory(tx, { directory })).toEqual({ status: 'WRITING' })
      await withMediaContentOwnerPublication(
        tx,
        { owner, handles: [second], outcome: 'committed', now },
        async () => null
      )
      ready(await captureMediaContentDirectory(tx, { directory }))
    }))

  it('requires every directory child resolved before ignoring failed files and completing', async () =>
    isolated(async (tx) => {
      const directory = await directoryKey(tx)
      const parent = ready(
        await beginMediaContentPathWrite(tx, {
          directory,
          scope: { kind: 'DIRECTORY' },
          owner,
          writeToken: randomUUID(),
          upload: null,
          parent: null,
          now
        })
      )
      const child = ready(
        await beginMediaContentPathWrite(tx, {
          directory,
          scope: { kind: 'PATH', relativePath: `${directory.relativeDirectory}/partial.jpg` },
          owner,
          writeToken: randomUUID(),
          upload: { declaredFileSize: 4n, totalChunks: 2 },
          parent,
          now
        })
      )
      const recovery = ready(
        await markMediaContentWriteRecoveryRequired(tx, { owner, handle: child, failureCode: 'UNKNOWN_WRITE', now })
      )
      await expect(
        withMediaContentOwnerPublication(tx, { owner, handles: [parent], outcome: 'committed', now }, async () => null)
      ).rejects.toMatchObject({ status: 'INCOMPLETE' })
      ready(
        await resolveMediaContentChildWrites(tx, {
          owner,
          parent,
          children: [
            {
              handle: recovery,
              resolution: {
                kind: 'VERIFIED_ROLLBACK',
                disposition: 'ISOLATED',
                evidenceId: 'verified-recovery-location'
              }
            }
          ],
          now
        })
      )
      await withMediaContentOwnerPublication(
        tx,
        { owner, handles: [parent], outcome: 'committed', now },
        async () => null
      )
      ready(await captureMediaContentDirectory(tx, { directory }))
      expect(await tx.mediaContentPathWrite.findUnique({ where: { id: child.writeId } })).toMatchObject({
        status: 'ROLLED_BACK',
        childDisposition: 'ISOLATED'
      })
    }))

  it('resumes only the exact live source token range without advancing its version', async () =>
    isolated(async (tx) => {
      const { artwork, members } = await fixture(tx)
      const token = { artworkIds: [], imageIds: members.map((member) => member.imageId), writeToken: randomUUID() }
      expect(await resumeMediaContentSourceWrite(tx, { token })).toEqual({ status: 'MISSING' })
      await beginMediaContentSourceWrite(tx, { ...token, now })
      const before = await tx.artworkContentSource.findUniqueOrThrow({ where: { artworkId: artwork.id } })
      expect(ready(await resumeMediaContentSourceWrite(tx, { token }))).toEqual(token)
      expect(
        await resumeMediaContentSourceWrite(tx, { token: { ...token, imageIds: token.imageIds.slice(0, 1) } })
      ).toEqual({ status: 'STALE' })
      expect(await resumeMediaContentSourceWrite(tx, { token: { ...token, writeToken: randomUUID() } })).toEqual({
        status: 'STALE'
      })
      await expect(beginMediaContentSourceWrite(tx, { ...token, now })).rejects.toMatchObject({ status: 'WRITING' })
      expect(await tx.artworkContentSource.findUniqueOrThrow({ where: { artworkId: artwork.id } })).toEqual(before)
      expect(await finishMediaContentSourceWrite(tx, { token, outcome: 'committed' })).toBe(true)
      expect(await finishMediaContentSourceWrite(tx, { token, outcome: 'committed' })).toBe(false)
    }))

  it('invalidates nested directory snapshots and refuses another root identity or execution attempt', async () =>
    isolated(async (tx) => {
      const directory = await directoryKey(tx)
      const nested = { ...directory, relativeDirectory: `${directory.relativeDirectory}/child` }
      const snapshot = ready(await captureMediaContentDirectory(tx, { directory: nested }))
      const workerOwner: MediaContentOwner = {
        ...owner,
        execution: { jobId: 'job', executionToken: 'execution', executionAttempt: 1 }
      }
      const input = {
        directory,
        scope: { kind: 'DIRECTORY' as const },
        owner: workerOwner,
        writeToken: randomUUID(),
        upload: null,
        parent: null,
        now
      }
      const handle = ready(await beginMediaContentPathWrite(tx, input))
      expect(ready(await beginMediaContentPathWrite(tx, input))).toEqual(handle)
      expect(
        await beginMediaContentPathWrite(tx, {
          ...input,
          owner: { ...workerOwner, execution: { ...workerOwner.execution!, executionAttempt: 2 } }
        })
      ).toEqual({ status: 'STALE' })
      expect(await captureMediaContentDirectory(tx, { directory: nested })).toEqual({ status: 'WRITING' })
      expect(
        await captureMediaContentDirectory(tx, { directory: { ...nested, rootIdentity: 'another-volume' } })
      ).toEqual({ status: 'ROOT_CHANGED' })
      await withMediaContentOwnerPublication(
        tx,
        { owner: workerOwner, handles: [handle], outcome: 'committed', now },
        async () => null
      )
      expect(await assertMediaContentDirectorySnapshot(tx, { snapshot })).toEqual({ status: 'STALE' })
      expect(await beginMediaContentPathWrite(tx, input)).toEqual({ status: 'STALE' })
    }))

  it('invalidates a parent scan when a child write begins and finishes, without invalidating sibling artworks', async () =>
    isolated(async (tx) => {
      const sibling = await fixture(tx, 1)
      const parent = ready(await captureMediaContentDirectory(tx, { directory: await directoryKey(tx) }))
      const root = ready(await captureMediaContentDirectory(tx, { directory: { ...parent, relativeDirectory: '' } }))
      const child = { ...parent, relativeDirectory: `${parent.relativeDirectory}/new-child` }
      const handle = ready(
        await beginMediaContentPathWrite(tx, {
          directory: child,
          scope: { kind: 'PATH', relativePath: `${child.relativeDirectory}/new.jpg` },
          owner,
          writeToken: randomUUID(),
          upload: null,
          parent: null,
          now
        })
      )
      await withMediaContentOwnerPublication(
        tx,
        { owner, handles: [handle], outcome: 'committed', now },
        async () => null
      )
      expect(await assertMediaContentDirectorySnapshot(tx, { snapshot: parent })).toEqual({ status: 'STALE' })
      expect(await assertMediaContentDirectorySnapshot(tx, { snapshot: root })).toEqual({ status: 'STALE' })
      expect(ready(await captureArtworkContentSnapshot(tx, { artworkId: sibling.artwork.id }))).toEqual(
        sibling.snapshot
      )
      expect(ready(await assertMediaContentDirectorySnapshot(tx, { snapshot: sibling.directory }))).toEqual(
        sibling.directory
      )
    }))

  it('rolls back domain DML and the claim release together if the final owner CAS loses', async () => {
    const setup = await database!.$transaction(async (tx) => {
      const directory = await directoryKey(tx)
      const handle = ready(
        await beginMediaContentPathWrite(tx, {
          directory,
          scope: { kind: 'DIRECTORY' },
          owner,
          writeToken: randomUUID(),
          upload: null,
          parent: null,
          now
        })
      )
      return { directory, handle }
    })
    const title = `owner-cas-${randomUUID()}`
    try {
      await expect(
        database!.$transaction(async (tx) => {
          // The publication callback creates an Artwork after the owner gate locks the media root.
          await lockCreatorCatalog(tx)
          return withMediaContentOwnerPublication(
            tx,
            { owner, handles: [setup.handle], outcome: 'committed', now },
            async (active) => {
              await active.artwork.create({ data: { title } })
              await active.mediaContentPathWrite.update({
                where: { id: setup.handle.writeId },
                data: { declarationVersion: { increment: 1n } }
              })
            }
          )
        })
      ).rejects.toMatchObject({ status: 'STALE' })
      expect(await database!.artwork.count({ where: { title } })).toBe(0)
      expect(await database!.mediaContentPathWrite.findUnique({ where: { id: setup.handle.writeId } })).toMatchObject({
        status: 'ACTIVE',
        declarationVersion: setup.handle.declarationVersion
      })
    } finally {
      await database!.mediaContentPathWrite.delete({ where: { id: setup.handle.writeId } })
      await database!.mediaContentDirectoryState.delete({ where: { id: setup.handle.directoryId } })
    }
  })

  it('fails publication promptly instead of deadlocking a direct SQL Image delete trigger', async () => {
    const setup = await database!.$transaction((tx) => fixture(tx, 1))
    let imageLocked!: () => void
    const locked = new Promise<void>((resolve) => {
      imageLocked = resolve
    })
    let allowDelete!: () => void
    const mayDelete = new Promise<void>((resolve) => {
      allowDelete = resolve
    })
    const deletion = database!.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Image" WHERE id = ${setup.members[0]!.imageId} FOR UPDATE`
        imageLocked()
        await mayDelete
        await tx.$executeRaw`DELETE FROM "Image" WHERE id = ${setup.members[0]!.imageId}`
      },
      { timeout: 10_000 }
    )
    try {
      await locked
      await expect(
        database!.$transaction((tx) =>
          publishMediaContentFingerprints(tx, { snapshot: setup.snapshot, algorithmVersion: 1, entries: setup.entries })
        )
      ).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } })
      allowDelete()
      await deletion
      expect(
        await database!.mediaContentFingerprint.findUnique({ where: { imageId: setup.members[0]!.imageId } })
      ).toBeNull()
      const after = ready(
        await database!.$transaction((tx) => captureArtworkContentSnapshot(tx, { artworkId: setup.artwork.id }))
      )
      expect(after.memberCount).toBe(0n)
      expect(after.revision).toBe(setup.snapshot.revision + 1n)
    } finally {
      allowDelete()
      await deletion
      await database!.image.deleteMany({ where: { artworkId: setup.artwork.id } })
      await database!.artwork.delete({ where: { id: setup.artwork.id } })
      await database!.mediaContentDirectoryState.delete({ where: { id: setup.directory.directoryId } })
    }
  })

  it('hands off only completed archive publication to the current fenced attempt without advancing its source epoch', async () =>
    isolated(async (tx) => {
      const input = await archiveHandoffFixture(tx)
      const before = await tx.artworkContentSource.findUniqueOrThrow({ where: { artworkId: input.expectedArtworkId! } })
      const rebound = ready(await rebindCompletedArchivePublicationMediaWrite(tx, input))
      expect(rebound.source).toEqual(input.previous.source)
      expect(rebound.handle.declarationVersion).toBe(input.previous.handle.declarationVersion + 1n)
      expect(rebound.handle.writeToken).toBe(input.previous.handle.writeToken)
      expect(
        await tx.artworkContentSource.findUniqueOrThrow({ where: { artworkId: input.expectedArtworkId! } })
      ).toEqual(before)
      expect(ready(await rebindCompletedArchivePublicationMediaWrite(tx, { ...input, previous: rebound }))).toEqual(
        rebound
      )
      await expect(
        assertMediaContentOwnerPublication(tx, { owner: input.previous.owner, handles: [input.previous.handle] })
      ).rejects.toMatchObject({ status: 'STALE' })
      await withMediaContentOwnerPublication(
        tx,
        { owner: rebound.owner, handles: [rebound.handle], outcome: 'committed', now },
        async (active) => {
          expect(await finishMediaContentSourceWrite(active, { token: rebound.source, outcome: 'committed' })).toBe(
            true
          )
        }
      )
    }))

  it.each(['cleanup', 'manifest', 'undrained', 'source-range', 'expired-lease'] as const)(
    'preserves the old archive claim when handoff proof fails: %s',
    async (failure) =>
      isolated(async (tx) => {
        const input = await archiveHandoffFixture(tx)
        if (failure === 'cleanup')
          await tx.archiveImport.update({
            where: { id: input.proof.archiveImportId },
            data: { cleanupRequestedAt: now }
          })
        if (failure === 'manifest') input.proof.manifestSha256 = 'b'.repeat(64)
        if (failure === 'undrained')
          await tx.archiveStagingGeneration.update({
            where: { token: input.proof.generationToken },
            data: { drainedAt: null }
          })
        if (failure === 'source-range') input.previous.source.artworkIds = []
        if (failure === 'expired-lease')
          await tx.jobResourceLease.update({
            where: { resourceKey: 'lane/background-writer' },
            data: { expiresAt: now }
          })
        expect(await rebindCompletedArchivePublicationMediaWrite(tx, input)).toEqual({ status: 'STALE' })
        expect(
          await tx.mediaContentPathWrite.findUnique({ where: { id: input.previous.handle.writeId } })
        ).toMatchObject({
          status: 'ACTIVE',
          declarationVersion: input.previous.handle.declarationVersion,
          executionToken: input.previous.owner.execution!.executionToken
        })
      })
  )
})
