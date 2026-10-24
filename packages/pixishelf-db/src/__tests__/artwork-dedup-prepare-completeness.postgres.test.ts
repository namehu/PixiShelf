import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { db, seed, prepared, cleanupFixture, cleanupJobs } from './artwork-dedup-maintenance-fixture'
import { completeArtworkDedupPrepare } from '../artwork-dedup-review'
import { captureArtworkContentSnapshot } from '../media-content-evidence'

async function withChapter() {
  return db!.$transaction(async (tx) => {
    const fixture = await seed(tx)
    const image = await tx.image.findFirstOrThrow({ where: { artworkId: fixture.members[0]![0]! } })
    const chaptersPath = `${image.path}.chapters.json`
    await tx.image.update({ where: { id: image.id }, data: { chaptersPath, chaptersHash: 'c'.repeat(64) } })
    const snapshot = await captureArtworkContentSnapshot(tx, { artworkId: image.artworkId! })
    if (snapshot.status !== 'READY') throw new Error(snapshot.status)
    await tx.artworkContentFingerprint.update({
      where: { artworkId: image.artworkId! },
      data: { sourceRevision: snapshot.value.revision, mediaEpoch: snapshot.value.mediaEpoch }
    })
    await tx.artworkDedupItem.update({
      where: { runId_artworkId: { runId: fixture.run.id, artworkId: image.artworkId! } },
      data: { snapshotRevision: snapshot.value.revision, mediaEpoch: snapshot.value.mediaEpoch }
    })
    const execution = await prepared(tx, fixture)
    await tx.artworkDedupOperationFile.create({
      data: {
        operationId: execution.operationId,
        artworkId: image.artworkId!,
        referenceKey: `chapter:${image.id}`,
        role: 'CHAPTER',
        imageId: image.id,
        logicalRoot: 'source-media:v1',
        rootIdentity: 'fixture',
        canonicalPath: chaptersPath,
        size: 4n,
        status: 'VERIFIED',
        ownershipStatus: 'VERIFIED',
        inspectionStatus: 'VERIFIED'
      }
    })
    return { fixture, image, execution }
  })
}

describe.skipIf(!db)('PREPARE indexed member completeness', () => {
  afterEach(cleanupJobs)
  afterAll(cleanupFixture)

  it('accepts exact media and chapter references in the completed inventory', async () => {
    const { execution } = await withChapter()
    const result = await db!.$transaction((tx) => completeArtworkDedupPrepare(tx, { execution }))
    expect(result).toMatchObject({ status: 'READY', preparedFiles: 3n })
  })

  it.each(['referenceKey', 'imageId', 'artworkId', 'role'] as const)(
    'does not treat a media reference with the wrong %s as a complete member',
    async (field) => {
      const { fixture, image, execution } = await withChapter()
      const other = await db!.image.findFirstOrThrow({ where: { artworkId: fixture.members[0]![1]! } })
      const data =
        field === 'referenceKey'
          ? { referenceKey: `unrelated:${image.id}` }
          : field === 'imageId'
            ? { imageId: other.id }
            : field === 'artworkId'
              ? { artworkId: other.artworkId! }
              : { role: 'SOURCE_FILE' }
      await db!.artworkDedupOperationFile.update({
        where: { operationId_referenceKey: { operationId: execution.operationId, referenceKey: `media:${image.id}` } },
        data
      })
      await expect(db!.$transaction((tx) => completeArtworkDedupPrepare(tx, { execution }))).rejects.toMatchObject({
        code: 'INCOMPLETE_INVENTORY'
      })
      expect(await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: execution.operationId } })).toMatchObject(
        {
          status: 'BUILDING',
          version: 1
        }
      )
    }
  )

  it('requires the registered chapter reference even when every media reference exists', async () => {
    const { image, execution } = await withChapter()
    await db!.artworkDedupOperationFile.delete({
      where: { operationId_referenceKey: { operationId: execution.operationId, referenceKey: `chapter:${image.id}` } }
    })
    await expect(db!.$transaction((tx) => completeArtworkDedupPrepare(tx, { execution }))).rejects.toMatchObject({
      code: 'INCOMPLETE_INVENTORY'
    })
  })
})
