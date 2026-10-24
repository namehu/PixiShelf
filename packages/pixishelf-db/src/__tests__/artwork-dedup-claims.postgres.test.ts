import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { db, seed, prepared, cleanupFixture, cleanupJobs, prefix } from './artwork-dedup-maintenance-fixture'
import { completeArtworkDedupPrepare } from '../artwork-dedup-review'
import {
  claimArtworkDedupScope,
  assertArtworkDedupWritable,
  assertArtworkDedupPathWritable,
  captureArtworkDedupSourceGeneration,
  assertArtworkDedupSourcePublication,
  assertNoArtworkDedupUrlHold,
  artworkDedupUrlHoldPredicate,
  type ArtworkDedupWriteKind
} from '../artwork-dedup-claims'
import { beginMediaContentPathWrite, beginMediaContentSourceWrite } from '../media-content-writes'

const operationIds: string[] = [],
  sourceIds: string[] = [],
  writeTokens: string[] = []
let originalRoots: string[] = []
let initialized = false
async function ready(fixture?: Awaited<ReturnType<typeof seed>>) {
  if (!initialized) {
    originalRoots = (await db!.mediaContentDirectoryState.findMany({ select: { id: true } })).map((r) => r.id)
    initialized = true
  }
  const f = fixture ?? (await db!.$transaction((tx) => seed(tx)))
  const execution = await db!.$transaction((tx) => prepared(tx, f))
  operationIds.push(execution.operationId)
  const roots = await Promise.all(
    (['source-media:v1', 'archive-media:v1'] as const).map(async (logicalRoot) => ({
      logicalRoot,
      rootIdentity:
        (
          await db!.mediaContentDirectoryState.findUnique({
            where: { logicalRoot_relativeDirectory: { logicalRoot, relativeDirectory: '' } }
          })
        )?.rootIdentity ?? (logicalRoot === 'source-media:v1' ? 'fixture' : 'archive-fixture')
    }))
  )
  const rootBindings = { version: 1, source: roots[0]!, archive: roots[1]!, archiveRelativePrefix: '' }
  await db!.artworkDedupOperation.update({ where: { id: execution.operationId }, data: { rootBindings } })
  await db!.artworkDedupOperationFile.updateMany({
    where: { operationId: execution.operationId },
    data: { rootIdentity: roots[0]!.rootIdentity }
  })
  const op = await db!.$transaction((tx) => completeArtworkDedupPrepare(tx, { execution }))
  expect(op.status).toBe('READY')
  await db!.artworkDedupOperation.update({
    where: { id: op.id },
    data: {
      status: 'ISOLATING',
      mode: 'ISOLATE',
      backupCheckpointRef: prefix,
      backupConfirmedAt: new Date(),
      externalWritesStoppedAt: new Date()
    }
  })
  await db!.systemJob.update({
    where: { id: execution.jobId },
    data: {
      payload: { operationId: execution.operationId, executionVersion: execution.executionVersion, mode: 'ISOLATE' }
    }
  })
  const files = await db!.artworkDedupOperationFile.findMany({
    where: { operationId: op.id },
    orderBy: { artworkId: 'asc' }
  })
  return { f, execution, expectedVersion: op.version, files, roots: rootBindings }
}
const claim = (f: Awaited<ReturnType<typeof ready>>, tx: Prisma.TransactionClient) =>
  claimArtworkDedupScope(tx, { execution: f.execution, expectedVersion: f.expectedVersion })
function pathWrite(f: Awaited<ReturnType<typeof ready>>) {
  const token = randomUUID()
  writeTokens.push(token)
  return {
    directory: { ...f.roots.source, relativeDirectory: prefix },
    scope: { kind: 'PATH' as const, relativePath: f.files[0]!.canonicalPath },
    owner: { ownerUserId: null, sessionId: prefix, sessionVersion: 1n, execution: null },
    writeToken: token,
    upload: null,
    parent: null,
    now: new Date()
  }
}
async function assertEmpty(operationId: string) {
  expect(await db!.artworkDedupClaim.count({ where: { operationId } })).toBe(0)
  expect(await db!.artworkDedupOperationSource.count({ where: { operationId } })).toBe(0)
  expect(await db!.artworkDedupSourceIdentity.count({ where: { ownerOperationId: operationId } })).toBe(0)
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// No sleep-based race assertions: a second connection proves the lock conflict via PostgreSQL lock_timeout.
describe.skipIf(!db)('global artwork/source maintenance claims', () => {
  afterEach(cleanupJobs)
  afterAll(async () => {
    if (!db) return
    const bound = await db.artworkDedupOperationSource.findMany({
      where: { operationId: { in: operationIds } },
      select: { sourceId: true }
    })
    await db.artworkDedupClaim.deleteMany({ where: { operationId: { in: operationIds } } })
    await db.artworkDedupOperationSource.deleteMany({ where: { operationId: { in: operationIds } } })
    await db.artworkDedupSourceIdentity.deleteMany({
      where: { id: { in: [...sourceIds, ...bound.map((b) => b.sourceId)] } }
    })
    await db.mediaContentPathWrite.deleteMany({ where: { writeToken: { in: writeTokens } } })
    await db.mediaContentDirectoryState.deleteMany({
      where: {
        id: { notIn: originalRoots },
        OR: [{ relativeDirectory: { startsWith: prefix } }, { relativeDirectory: '' }],
        mediaSources: { none: {} },
        writes: { none: {} }
      }
    })
    await cleanupFixture()
  })

  it('claims keeper and copy idempotently, preserves generation, and only permits keeper reading', async () => {
    const f = await ready()
    const expected = {
      operationId: f.execution.operationId,
      executionVersion: 1,
      claimedArtworks: 2n,
      sourceBindings: 2n
    }
    await expect(
      db!.$transaction(async (tx) => {
        await claim(f, tx)
        throw new Error('rollback completed claim')
      })
    ).rejects.toThrow('rollback completed claim')
    await assertEmpty(f.execution.operationId)
    expect(
      await db!.artworkDedupSourceIdentity.count({
        where: { canonicalPath: { in: f.files.map((file) => file.canonicalPath) } }
      })
    ).toBe(0)
    expect(await db!.$transaction((tx) => claim(f, tx))).toEqual(expected)
    expect(await db!.$transaction((tx) => claim(f, tx))).toEqual(expected)
    const claims = await db!.artworkDedupClaim.findMany({ where: { operationId: f.execution.operationId } })
    for (const row of claims)
      for (const kind of ['READING', 'ORGANIZATION', 'STRUCTURE', 'CONTENT', 'DELETE'] as ArtworkDedupWriteKind[]) {
        const result = db!.$transaction((tx) => assertArtworkDedupWritable(tx, { artworkId: row.artworkId, kind }))
        if (row.role === 'KEEPER' && kind === 'READING') await expect(result).resolves.toBeUndefined()
        else await expect(result).rejects.toMatchObject({ code: 'ARTWORK_CLAIMED' })
      }
    await expect(
      db!.$transaction((tx) =>
        claimArtworkDedupScope(tx, { execution: f.execution, expectedVersion: f.expectedVersion - 1 })
      )
    ).rejects.toMatchObject({ code: 'STALE' })
    expect(
      (await db!.artworkDedupSourceIdentity.findMany({ where: { ownerOperationId: f.execution.operationId } })).every(
        (s) => s.generation === 0n && s.status === 'HOLD'
      )
    ).toBe(true)
  })

  it('rejects a later artist plan after the first global claim survives its writer turn', async () => {
    const first = await db!.$transaction((tx) => seed(tx)),
      second = await db!.$transaction((tx) => seed(tx))
    for (const artworkId of first.members.flat())
      await db!.artworkArtist.create({
        data: {
          artworkId,
          artistId: second.artist.id,
          evidence: { create: { evidenceKey: 'manual', provenance: 'MANUAL' } }
        }
      })
    await db!.artworkDedupGroupMember.deleteMany({ where: { runId: second.run.id } })
    await db!.artworkDedupItem.deleteMany({ where: { runId: second.run.id } })
    for (const item of await db!.artworkDedupItem.findMany({ where: { runId: first.run.id } })) {
      await db!.artworkDedupItem.create({ data: { ...item, runId: second.run.id } })
      await db!.artworkDedupGroupMember.create({
        data: { runId: second.run.id, groupId: second.groupIds[0]!, artworkId: item.artworkId }
      })
    }
    second.members = first.members
    const a = await ready(first)
    await db!.systemJob.update({
      where: { id: a.execution.jobId },
      data: { status: 'PAUSED', leaseExpiresAt: null, leaseToken: null, workerId: null }
    })
    const b = await ready(second)
    await db!.systemJob.update({
      where: { id: b.execution.jobId },
      data: { status: 'PAUSED', leaseExpiresAt: null, leaseToken: null, workerId: null }
    })
    await db!.systemJob.update({
      where: { id: a.execution.jobId },
      data: {
        status: 'RUNNING',
        leaseExpiresAt: new Date(Date.now() + 60000),
        leaseToken: randomUUID(),
        workerId: prefix
      }
    })
    await db!.$transaction((tx) => claim(a, tx))
    // The queue enforces one active writer. Persistent claims must protect the next writer too.
    await db!.systemJob.update({
      where: { id: a.execution.jobId },
      data: { status: 'COMPLETED', leaseExpiresAt: null, leaseToken: null, workerId: null }
    })
    await db!.systemJob.update({
      where: { id: b.execution.jobId },
      data: {
        status: 'RUNNING',
        leaseExpiresAt: new Date(Date.now() + 60000),
        leaseToken: randomUUID(),
        workerId: prefix
      }
    })
    await expect(db!.$transaction((tx) => claim(b, tx))).rejects.toMatchObject({ code: 'SOURCE_HELD' })
    await assertEmpty(b.execution.operationId)
    expect(await db!.artworkDedupClaim.count({ where: { operationId: a.execution.operationId } })).toBe(2)
  })

  it('blocks an existing path declaration, rolls back all claims, and blocks legacy write primitives after claiming', async () => {
    const f = await ready(),
      write = pathWrite(f)
    expect((await db!.$transaction((tx) => beginMediaContentPathWrite(tx, write))).status).toBe('READY')
    await expect(db!.$transaction((tx) => claim(f, tx))).rejects.toMatchObject({ code: 'CONTENT_WRITING' })
    await assertEmpty(f.execution.operationId)
    await db!.mediaContentPathWrite.update({ where: { writeToken: write.writeToken }, data: { status: 'ROLLED_BACK' } })
    const acquired = deferred(),
      release = deferred()
    const holding = db!.$transaction(
      async (tx) => {
        await claim(f, tx)
        acquired.resolve()
        await release.promise
      },
      { timeout: 10000 }
    )
    await acquired.promise
    const later = pathWrite(f)
    try {
      await expect(
        db!.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL lock_timeout='100ms'")
          await beginMediaContentPathWrite(tx, later)
        })
      ).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } })
      await expect(
        db!.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL lock_timeout='100ms'")
          await beginMediaContentSourceWrite(tx, {
            artworkIds: [f.files[0]!.artworkId],
            imageIds: [],
            writeToken: randomUUID(),
            now: new Date()
          })
        })
      ).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } })
    } finally {
      release.resolve()
      await holding
    }
    expect((await db!.$transaction((tx) => beginMediaContentPathWrite(tx, later))).status).toBe('WRITING')
    await expect(
      db!.$transaction((tx) =>
        beginMediaContentSourceWrite(tx, {
          artworkIds: [f.files[0]!.artworkId],
          imageIds: [],
          writeToken: randomUUID(),
          now: new Date()
        })
      )
    ).rejects.toMatchObject({ status: 'WRITING' })
    expect(await db!.mediaContentPathWrite.count({ where: { writeToken: later.writeToken } })).toBe(0)
  })

  it('rejects an existing Artwork content writer and rolls back newly derived sources', async () => {
    const f = await ready()
    await db!.$transaction((tx) =>
      beginMediaContentSourceWrite(tx, {
        artworkIds: [f.files[0]!.artworkId],
        imageIds: [],
        writeToken: randomUUID(),
        now: new Date()
      })
    )
    await expect(db!.$transaction((tx) => claim(f, tx))).rejects.toMatchObject({ code: 'STALE' })
    await assertEmpty(f.execution.operationId)
  })

  it('retains stable provider generations and blocks late new-source publication after a claim', async () => {
    const f = await db!.$transaction((tx) => seed(tx))
    const identity = { kind: 'PROVIDER' as const, providerKey: 'fixture', externalId: randomUUID() }
    await db!.artworkExternalRef.create({
      data: {
        artworkId: f.members[0]![0]!,
        providerKey: identity.providerKey,
        externalId: identity.externalId,
        canonicalUrl: 'https://example.invalid',
        locator: {}
      }
    })
    const captured = await db!.$transaction((tx) => captureArtworkDedupSourceGeneration(tx, { identity }))
    sourceIds.push(captured.sourceId)
    expect(
      await db!.$transaction((tx) => assertArtworkDedupSourcePublication(tx, { identity, expectedGeneration: 0n }))
    ).toEqual(captured)
    const op = await ready(f)
    await db!.$transaction((tx) => claim(op, tx))
    await expect(
      db!.$transaction((tx) =>
        assertArtworkDedupSourcePublication(tx, { identity, expectedGeneration: captured.generation })
      )
    ).rejects.toMatchObject({ code: 'SOURCE_HELD' })
    const changedIdentity = { ...identity, externalId: randomUUID() }
    const changedSource = await db!.$transaction((tx) =>
      captureArtworkDedupSourceGeneration(tx, { identity: changedIdentity })
    )
    sourceIds.push(changedSource.sourceId)
    await db!.artworkDedupSourceIdentity.update({
      where: { id: changedSource.sourceId },
      data: { generation: { increment: 1 } }
    })
    await expect(
      db!.$transaction((tx) =>
        assertArtworkDedupSourcePublication(tx, { identity: changedIdentity, expectedGeneration: 0n })
      )
    ).rejects.toMatchObject({ code: 'SOURCE_GENERATION_CHANGED' })
    expect(
      (await db!.$transaction((tx) => captureArtworkDedupSourceGeneration(tx, { identity: changedIdentity })))
        .generation
    ).toBe(1n)
  })

  it('matches complete directory segments and rejects root changes without clearing a hold', async () => {
    const f = await ready()
    const identity = { kind: 'DIRECTORY' as const, ...f.roots.source, canonicalPath: `${prefix}/a` }
    const parentSource = await db!.$transaction((tx) =>
      captureArtworkDedupSourceGeneration(tx, { identity: { ...identity, canonicalPath: f.files[0]!.canonicalPath } })
    )
    sourceIds.push(parentSource.sourceId)
    const source = await db!.$transaction((tx) => captureArtworkDedupSourceGeneration(tx, { identity }))
    sourceIds.push(source.sourceId)
    await db!.artworkDedupSourceIdentity.update({
      where: { id: source.sourceId },
      data: { status: 'TOMBSTONE', ownerOperationId: randomUUID() }
    })
    await expect(
      db!.$transaction((tx) =>
        assertArtworkDedupPathWritable(tx, {
          directory: { ...f.roots.source, relativeDirectory: prefix },
          scope: { kind: 'PATH', relativePath: `${prefix}/a/file` }
        })
      )
    ).rejects.toMatchObject({ code: 'SOURCE_HELD' })
    await expect(
      db!.$transaction((tx) =>
        assertArtworkDedupPathWritable(tx, {
          directory: { ...f.roots.source, relativeDirectory: prefix },
          scope: { kind: 'PATH', relativePath: `${prefix}/ab/file` }
        })
      )
    ).resolves.toBeUndefined()
    await expect(
      db!.$transaction((tx) =>
        captureArtworkDedupSourceGeneration(tx, { identity: { ...identity, rootIdentity: 'changed-root' } })
      )
    ).rejects.toMatchObject({ status: 'ROOT_CHANGED' })
    expect(await db!.artworkDedupSourceIdentity.findUniqueOrThrow({ where: { id: source.sourceId } })).toMatchObject({
      status: 'TOMBSTONE',
      generation: 0n
    })
    await db!.artworkDedupSourceIdentity.update({
      where: { id: parentSource.sourceId },
      data: { status: 'TOMBSTONE', ownerOperationId: randomUUID() }
    })
    await expect(db!.$transaction((tx) => claim(f, tx))).rejects.toMatchObject({ code: 'SOURCE_HELD' })
    await assertEmpty(f.execution.operationId)
  })

  it('keeps URL hold independent of ordinary expiry and survives missing Artwork through durable evidence', async () => {
    const f = await ready()
    await db!.$transaction((tx) => claim(f, tx))
    const copy = await db!.artworkDedupClaim.findFirstOrThrow({
      where: { operationId: f.execution.operationId, role: 'COPY' }
    })
    await db!.artworkDedupOperationArtwork.update({
      where: { operationId_artworkId: { operationId: f.execution.operationId, artworkId: copy.artworkId } },
      data: { isUrl: true, status: 'ISOLATED' }
    })
    const ref = await db!.artworkExternalRef.create({
      data: {
        artworkId: copy.artworkId,
        providerKey: 'fixture',
        externalId: randomUUID(),
        canonicalUrl: 'https://example.invalid',
        locator: {}
      }
    })
    await db!.archiveRevision.create({
      data: {
        artworkId: copy.artworkId,
        externalRefId: ref.id,
        archivePath: prefix,
        manifestPath: `${prefix}/manifest.json`,
        mediaSnapshot: [],
        metadataHash: 'a'.repeat(64),
        trashPath: `${prefix}/trash`,
        trashedAt: new Date('1999-12-01'),
        purgeAfter: new Date('2000-01-01')
      }
    })
    await expect(
      db!.$transaction((tx) => assertNoArtworkDedupUrlHold(tx, { artworkId: copy.artworkId }))
    ).rejects.toMatchObject({ code: 'URL_HELD' })
    await db!.artwork.delete({ where: { id: copy.artworkId } })
    const [held] = await db!.$queryRaw<{ held: boolean }[]>(
      Prisma.sql`SELECT ${artworkDedupUrlHoldPredicate(Prisma.sql`${copy.artworkId}::integer`)} held`
    )
    expect(held!.held).toBe(true)
    expect(await db!.artworkDedupClaim.count({ where: { artworkId: copy.artworkId } })).toBe(1)
  })
})
