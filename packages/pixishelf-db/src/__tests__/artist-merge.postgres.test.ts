import { randomUUID } from 'node:crypto'
import { PrismaClient, type Prisma } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import {
  applyArtistMerge,
  artistMergeBlockers,
  captureArtistMerge,
  mergeEvidenceState,
  mergeJson,
  resolveArtistId
} from '../artist-merge'
import { activeCreatorMembership, editArtworkCreators, lockCreatorCatalog, syncSourceCreators } from '../creators'
import { consumeDiscoveryCreators } from '../discovery-creators'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
afterAll(async () => {
  await db?.$disconnect()
})
const rollback = new Error('rollback artist merge fixture')
async function fixture(run: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await db!.$transaction(
      async (tx) => {
        await run(tx)
        throw rollback
      },
      { timeout: 30000 }
    )
  } catch (error) {
    if (error !== rollback) throw error
  }
}
async function pair(tx: Prisma.TransactionClient) {
  const source = await tx.artist.create({ data: { name: 'source', bio: 'source bio', isStarred: true } })
  const target = await tx.artist.create({ data: { name: 'target' } })
  return { source, target }
}
async function prepare(tx: Prisma.TransactionClient, source: number, target: number) {
  const snapshot = await captureArtistMerge(tx, source, target)
  return tx.artistMerge.create({
    data: {
      sourceArtistId: source,
      targetArtistId: target,
      requestedBy: 'test',
      status: 'QUEUED',
      fingerprint: snapshot.fingerprint,
      summary: mergeJson(snapshot.summary),
      before: mergeJson(snapshot.before)
    }
  })
}
async function active(tx: Prisma.TransactionClient, artworkId: number) {
  return (
    await tx.artworkArtist.findMany({ where: { artworkId, ...activeCreatorMembership }, orderBy: { artistId: 'asc' } })
  ).map((m) => m.artistId)
}

describe('duplicate evidence union', () => {
  it('never creates positive evidence from two inactive records', () => {
    const removed = new Date()
    expect(mergeEvidenceState({ present: false, excludedAt: null }, { present: true, excludedAt: removed })).toEqual({
      present: true,
      excludedAt: removed
    })
    expect(mergeEvidenceState({ present: true, excludedAt: null }, { present: true, excludedAt: removed })).toEqual({
      present: true,
      excludedAt: null
    })
  })
})

describe.skipIf(!url)('artist merge PostgreSQL invariants', () => {
  it('accepts the durable merge job and excludes its own execution from blockers', () =>
    fixture(async (tx) => {
      const { source, target } = await pair(tx)
      const plan = await prepare(tx, source.id, target.id)
      const job = await tx.systemJob.create({ data: { type: 'ARTIST_MERGE', payload: { mergeId: plan.id } } })
      await tx.artistMerge.update({ where: { id: plan.id }, data: { systemJobId: job.id } })
      await applyArtistMerge(tx, plan.id, job.id)
      await tx.systemJob.update({ where: { id: job.id }, data: { status: 'COMPLETED' } })
      expect(await tx.artistMerge.findUnique({ where: { id: plan.id } })).toMatchObject({
        systemJobId: job.id,
        status: 'COMPLETE'
      })
    }))
  it('blocks active archive snapshots and preserves history while rejecting their later retry', () =>
    fixture(async (tx) => {
      const { source, target } = await pair(tx)
      const archiveSource = await tx.archiveUploaderSource.create({
        data: {
          providerKey: 'e-hentai',
          displayName: 'snapshot fixture',
          identityKind: 'NAME',
          identityValue: 'snapshot-fixture',
          normalizedIdentity: 'snapshot-fixture'
        }
      })
      const job = await tx.systemJob.create({
        data: { type: 'ARCHIVE_UPLOADER_SCAN', executionLane: 'ARCHIVE_RESOLVE', status: 'PAUSED' }
      })
      const run = await tx.archiveUploaderScanRun.create({
        data: {
          sourceId: archiveSource.id,
          systemJobId: job.id,
          mode: 'LATEST',
          searchIdentityKind: 'NAME',
          searchIdentityValue: 'snapshot-fixture',
          status: 'PAUSED',
          defaultCreatorIds: [source.id]
        }
      })
      const plan = await prepare(tx, source.id, target.id)
      expect((await artistMergeBlockers(tx, [source.id, target.id])).map((item) => item.jobId)).toContain(job.id)
      await expect(applyArtistMerge(tx, plan.id)).rejects.toThrow('未结束任务')
      await tx.archiveUploaderScanRun.update({ where: { id: run.id }, data: { status: 'CANCELLED' } })
      await tx.systemJob.update({ where: { id: job.id }, data: { status: 'CANCELLED' } })
      await applyArtistMerge(tx, plan.id)
      expect(await tx.archiveUploaderScanRun.findUnique({ where: { id: run.id } })).toMatchObject({
        defaultCreatorIds: [source.id]
      })
      await tx.$executeRawUnsafe('SAVEPOINT stale_snapshot')
      await expect(tx.systemJob.update({ where: { id: job.id }, data: { status: 'PENDING' } })).rejects.toThrow(
        '已合并'
      )
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT stale_snapshot')
    }))
  it('unions works, preserves exclusions and coauthors, retains target profile and storage identity', () =>
    fixture(async (tx) => {
      const { source, target } = await pair(tx)
      const other = await tx.artist.create({ data: { name: 'coauthor' } })
      const one = await tx.artwork.create({
        data: { title: 'one', artistId: source.id, storagePath: 'unchanged/path', storageKey: 'unchanged-key' }
      })
      const two = await tx.artwork.create({ data: { title: 'two', artistId: target.id } })
      await editArtworkCreators(tx, one.id, [source.id, target.id, other.id], 'ADD')
      await editArtworkCreators(tx, one.id, [target.id], 'REMOVE')
      const removed = await tx.artwork.create({ data: { title: 'removed' } })
      await editArtworkCreators(tx, removed.id, [source.id, target.id], 'ADD')
      await editArtworkCreators(tx, removed.id, [source.id, target.id], 'REMOVE')
      const hidden = await tx.artwork.create({ data: { title: 'hidden', artistId: source.id, deletedAt: new Date() } })
      const snapshot = await captureArtistMerge(tx, source.id, target.id)
      expect(snapshot.summary).toMatchObject({
        sourceCount: 1,
        targetCount: 1,
        commonCount: 0,
        mergedCount: 2,
        allMemberships: 3
      })
      const plan = await prepare(tx, source.id, target.id)
      await applyArtistMerge(tx, plan.id)
      expect(await active(tx, one.id)).toEqual([target.id, other.id])
      expect(await active(tx, two.id)).toEqual([target.id])
      expect(await active(tx, hidden.id)).toEqual([target.id])
      expect(await active(tx, removed.id)).toEqual([])
      expect(await tx.artist.findUnique({ where: { id: target.id } })).toEqual(target)
      expect(await tx.artwork.findUnique({ where: { id: one.id } })).toMatchObject({
        artistId: source.id,
        storagePath: 'unchanged/path',
        storageKey: 'unchanged-key'
      })
      expect(await tx.artist.findUnique({ where: { id: source.id } })).toMatchObject({ mergedIntoId: target.id })
      expect(await tx.artistMerge.findUnique({ where: { id: plan.id } })).toMatchObject({
        status: 'COMPLETE',
        before: expect.any(Object),
        after: expect.any(Object)
      })
      expect(await applyArtistMerge(tx, plan.id)).toEqual(plan.summary)
    }))

  it('deduplicates common works and colliding manual evidence', () =>
    fixture(async (tx) => {
      const { source, target } = await pair(tx)
      const artwork = await tx.artwork.create({ data: { title: 'shared' } })
      await editArtworkCreators(tx, artwork.id, [source.id, target.id], 'ADD')
      expect((await captureArtistMerge(tx, source.id, target.id)).summary).toMatchObject({
        sourceCount: 1,
        targetCount: 1,
        commonCount: 1,
        mergedCount: 1
      })
      await applyArtistMerge(tx, (await prepare(tx, source.id, target.id)).id)
      expect(await tx.artworkArtistEvidence.count({ where: { membership: { artworkId: artwork.id } } })).toBe(1)
    }))

  it('keeps source ownership when later source refresh withdraws attribution', () =>
    fixture(async (tx) => {
      const work = await tx.artwork.create({ data: { title: 'source evidence' } })
      const ref = await tx.artworkExternalRef.create({
        data: {
          artworkId: work.id,
          providerKey: 'e-hentai',
          externalId: randomUUID(),
          canonicalUrl: 'https://e-hentai.org/g/1/token/',
          locator: {}
        }
      })
      const tag = { namespace: 'artist' as const, name: randomUUID() }
      await syncSourceCreators(tx, work.id, ref.id, 'e-hentai', [tag])
      const sourceId = (await active(tx, work.id))[0]!
      const target = await tx.artist.create({ data: { name: 'curated' } })
      await applyArtistMerge(tx, (await prepare(tx, sourceId, target.id)).id)
      await syncSourceCreators(tx, work.id, ref.id, 'e-hentai', [tag])
      expect(await active(tx, work.id)).toEqual([target.id])
      await syncSourceCreators(tx, work.id, ref.id, 'e-hentai', [])
      expect(await active(tx, work.id)).toEqual([])
    }))

  it('moves every archive binding and consumes pending bindings on future publication', () =>
    fixture(async (tx) => {
      const { source, target } = await pair(tx)
      const archiveSource = await tx.archiveUploaderSource.create({
        data: {
          providerKey: 'e-hentai',
          displayName: 'fixture',
          identityKind: 'NAME',
          identityValue: 'fixture',
          normalizedIdentity: 'fixture'
        }
      })
      await tx.discoverySourceCreator.createMany({
        data: [source, target].map((artist) => ({ sourceId: archiveSource.id, artistId: artist.id }))
      })
      const identity = { providerKey: 'e-hentai', externalId: randomUUID() }
      const suppressed = { providerKey: 'e-hentai', externalId: randomUUID() }
      await tx.discoveryPendingCreator.createMany({
        data: [source, target].flatMap((artist) =>
          [identity, suppressed].map((ref) => ({ ...ref, artistId: artist.id, title: 'pending' }))
        )
      })
      await tx.discoveryCreatorSuppression.createMany({
        data: [source, target].map((artist) => ({ ...suppressed, artistId: artist.id }))
      })
      await tx.localImportArtistMapping.create({ data: { artistDirectory: randomUUID(), artistId: source.id } })
      const mapping = await tx.artistSourceTagMapping.create({
        data: { artistId: source.id, providerKey: 'e-hentai', namespace: 'artist', sourceName: randomUUID() }
      })
      const ref = await tx.artistExternalRef.create({
        data: { artistId: source.id, providerKey: 'pixiv', externalId: randomUUID() }
      })
      await applyArtistMerge(tx, (await prepare(tx, source.id, target.id)).id)
      expect(await tx.discoverySourceCreator.count({ where: { sourceId: archiveSource.id } })).toBe(1)
      expect(await tx.discoveryPendingCreator.count({ where: { artistId: target.id } })).toBe(2)
      expect(await tx.discoveryCreatorSuppression.count({ where: { artistId: target.id } })).toBe(1)
      expect(await tx.localImportArtistMapping.count({ where: { artistId: target.id } })).toBe(1)
      expect(await tx.artistSourceTagMapping.findUnique({ where: { id: mapping.id } })).toMatchObject({
        artistId: target.id,
        version: 2
      })
      expect(await tx.artistExternalRef.findUnique({ where: { id: ref.id } })).toMatchObject({ artistId: target.id })
      const work = await tx.artwork.create({ data: { title: 'future' } })
      await consumeDiscoveryCreators(tx, identity, work.id)
      expect(await active(tx, work.id)).toEqual([target.id])
      const excluded = await tx.artwork.create({ data: { title: 'suppressed' } })
      await consumeDiscoveryCreators(tx, suppressed, excluded.id)
      expect(await active(tx, excluded.id)).toEqual([])
    }))

  it('resolves continuous merges for legacy inserts without rewriting storage artistId', () =>
    fixture(async (tx) => {
      const { source, target } = await pair(tx)
      const final = await tx.artist.create({ data: { name: 'final' } })
      await applyArtistMerge(tx, (await prepare(tx, source.id, target.id)).id)
      await applyArtistMerge(tx, (await prepare(tx, target.id, final.id)).id)
      expect(await resolveArtistId(tx, source.id)).toBe(final.id)
      const work = await tx.artwork.create({ data: { title: 'legacy', artistId: source.id } })
      expect(work.artistId).toBe(source.id)
      expect(await active(tx, work.id)).toEqual([final.id])
    }))

  it('rejects self/cross-kind merges, conflicting provider identities and stale previews', () =>
    fixture(async (tx) => {
      const { source, target } = await pair(tx)
      const group = await tx.artist.create({ data: { name: 'group', kind: 'GROUP' } })
      await expect(captureArtistMerge(tx, source.id, source.id)).rejects.toThrow('自身')
      await expect(captureArtistMerge(tx, source.id, group.id)).rejects.toThrow('社团')
      const plan = await prepare(tx, source.id, target.id)
      await tx.artist.update({ where: { id: target.id }, data: { name: 'changed' } })
      await expect(applyArtistMerge(tx, plan.id)).rejects.toThrow('重新预览')
      await tx.artistExternalRef.createMany({
        data: [source, target].map((artist) => ({
          artistId: artist.id,
          providerKey: 'pixiv',
          externalId: randomUUID()
        }))
      })
      const conflict = await prepare(tx, source.id, target.id)
      await expect(applyArtistMerge(tx, conflict.id)).rejects.toThrow('不同外部账号')
      expect(await tx.artist.findUnique({ where: { id: source.id } })).toMatchObject({ mergedIntoId: null })
    }))

  it('blocks paused/global work, but ignores unrelated explicit artist jobs', () =>
    fixture(async (tx) => {
      const { source, target } = await pair(tx)
      const unrelated = await tx.artist.create({ data: { name: 'unrelated' } })
      const global = await tx.systemJob.create({ data: { type: 'SCAN', status: 'PAUSED' } })
      const explicit = await tx.systemJob.create({
        data: { type: 'PIXIV_ARTIST_ENRICHMENT', status: 'PENDING', payload: { artistId: unrelated.id } }
      })
      expect((await artistMergeBlockers(tx, [source.id, target.id])).map((job) => job.jobId)).toContain(global.id)
      expect((await artistMergeBlockers(tx, [source.id, target.id])).map((job) => job.jobId)).not.toContain(explicit.id)
      await expect(applyArtistMerge(tx, (await prepare(tx, source.id, target.id)).id)).rejects.toThrow('未结束任务')
    }))

  it('guards old artist writes and retrying frozen job IDs at the database boundary', () =>
    fixture(async (tx) => {
      const { source, target } = await pair(tx)
      const oldJob = await tx.systemJob.create({
        data: { type: 'PIXIV_ARTIST_ENRICHMENT', status: 'FAILED', payload: { artistId: source.id } }
      })
      await applyArtistMerge(tx, (await prepare(tx, source.id, target.id)).id)
      await tx.$executeRawUnsafe('SAVEPOINT stale_artist')
      await expect(tx.artist.update({ where: { id: source.id }, data: { name: 'resurrect' } })).rejects.toThrow(
        '已合并'
      )
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT stale_artist')
      await expect(tx.systemJob.update({ where: { id: oldJob.id }, data: { status: 'PENDING' } })).rejects.toThrow(
        '已合并'
      )
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT stale_artist')
      await expect(
        tx.discoveryPendingCreator.create({
          data: { providerKey: 'e-hentai', externalId: randomUUID(), title: 'stale', artistId: source.id }
        })
      ).rejects.toThrow('已合并')
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT stale_artist')
    }))

  it('rolls back all changes if the enclosing queue finalization fails', async () => {
    const setup = await db!.$transaction(async (tx) => {
      const { source, target } = await pair(tx)
      const work = await tx.artwork.create({ data: { title: 'rollback', artistId: source.id } })
      const plan = await prepare(tx, source.id, target.id)
      return { source, target, work, plan }
    })
    const failure = new Error('injected queue finalization failure')
    await expect(
      db!.$transaction(async (tx) => {
        await applyArtistMerge(tx, setup.plan.id)
        throw failure
      })
    ).rejects.toBe(failure)
    expect(await db!.artist.findUnique({ where: { id: setup.source.id } })).toMatchObject({ mergedIntoId: null })
    expect(await db!.artworkArtist.findMany({ where: { artworkId: setup.work.id } })).toMatchObject([
      { artistId: setup.source.id }
    ])
    expect(await db!.artistMerge.findUnique({ where: { id: setup.plan.id } })).toMatchObject({
      status: 'QUEUED',
      after: null
    })
    await db!.artwork.delete({ where: { id: setup.work.id } })
    await db!.artistMerge.delete({ where: { id: setup.plan.id } })
    await db!.artist.deleteMany({ where: { id: { in: [setup.source.id, setup.target.id] } } })
  })

  it('serializes a stale concurrent binding and enqueue behind the merge commit', async () => {
    const setup = await db!.$transaction(async (tx) => {
      const { source, target } = await pair(tx)
      return { source, target, plan: await prepare(tx, source.id, target.id) }
    })
    let signalLocked!: () => void
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve
    })
    let release!: () => void
    const proceed = new Promise<void>((resolve) => {
      release = resolve
    })
    const merging = db!.$transaction(
      async (tx) => {
        await lockCreatorCatalog(tx)
        signalLocked()
        await proceed
        await applyArtistMerge(tx, setup.plan.id)
      },
      { timeout: 10000 }
    )
    await locked
    const binding = db!.discoveryPendingCreator
      .create({
        data: {
          artistId: setup.source.id,
          providerKey: 'e-hentai',
          externalId: randomUUID(),
          title: 'concurrent stale binding'
        }
      })
      .then(
        () => null,
        (error: Error) => error
      )
    const enqueue = db!.systemJob
      .create({ data: { type: 'PIXIV_ARTIST_ENRICHMENT', payload: { artistId: setup.source.id } } })
      .then(
        () => null,
        (error: Error) => error
      )
    release()
    await merging
    expect((await binding)?.message).toContain('已合并')
    expect((await enqueue)?.message).toContain('已合并')
    expect(await db!.discoveryPendingCreator.count({ where: { artistId: setup.source.id } })).toBe(0)
  })
})
