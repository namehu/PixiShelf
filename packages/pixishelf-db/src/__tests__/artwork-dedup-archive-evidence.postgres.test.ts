import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { db, seed, prepared, prefix, cleanupFixture } from './artwork-dedup-maintenance-fixture'
import { captureArtworkContentSnapshot } from '../media-content-evidence'
import { readArtworkDedupArchiveManifestEvidence, readArtworkDedupInventoryPage } from '../artwork-dedup-operation'

describe.skipIf(!db)('sealed archive database evidence', () => {
  afterAll(cleanupFixture)
  it('requires sealed/drained identity and an exact item-image bijection; inventory exposes real page indexes', async () => {
    const rollback = new Error('fixture rollback')
    try {
      await db!.$transaction(
        async (tx) => {
          const f = await seed(tx)
          const target = f.members[0]![0]!
          await tx.artwork.update({ where: { id: target }, data: { createdVia: 'URL_ARCHIVE' } })
          const job = await tx.systemJob.create({ data: { type: 'ARCHIVE_IMPORT', payload: {}, status: 'COMPLETED' } })
          const ref = await tx.artworkExternalRef.create({
            data: {
              artworkId: target,
              providerKey: 'fixture',
              externalId: randomUUID(),
              canonicalUrl: 'https://example.invalid',
              locator: {}
            }
          })
          const token = randomUUID(),
            seal = 'c'.repeat(64)
          const archive = await tx.archiveImport.create({
            data: {
              systemJobId: job.id,
              phase: 'PUBLISH',
              providerKey: ref.providerKey,
              externalId: ref.externalId,
              externalRefId: ref.id,
              submittedUrl: ref.canonicalUrl,
              canonicalUrl: ref.canonicalUrl,
              locator: {},
              normalizedMetadata: {},
              rawMetadata: {},
              metadataHash: 'd'.repeat(64),
              creatorBucket: 'fixture',
              stagingPath: `${prefix}/${token}`,
              status: 'COMPLETED',
              publishedArtworkId: target,
              generationToken: token,
              sealedManifestSha256: seal,
              totalItems: 2,
              completedItems: 2
            }
          })
          await tx.archiveStagingGeneration.create({
            data: {
              token,
              archiveImportId: archive.id,
              jobId: job.id,
              path: archive.stagingPath,
              manifestSha256: seal,
              sealedAt: new Date(),
              drainedAt: new Date()
            }
          })
          const revision = await tx.archiveRevision.create({
            data: {
              artworkId: target,
              externalRefId: ref.id,
              archiveImportId: archive.id,
              archivePath: prefix,
              manifestPath: `${prefix}/manifest.json`,
              mediaSnapshot: [],
              metadataHash: archive.metadataHash,
              isCurrent: true
            }
          })
          for (const artworkId of f.members[0]!) {
            await tx.image.create({ data: { artworkId, path: `${prefix}/${artworkId}-second.jpg`, size: 10n } })
            const snap = await captureArtworkContentSnapshot(tx, { artworkId })
            if (snap.status !== 'READY') throw new Error(snap.status)
            await tx.artworkContentFingerprint.create({
              data: {
                artworkId,
                algorithmVersion: 1,
                sourceRevision: snap.value.revision,
                mediaEpoch: snap.value.mediaEpoch,
                fileCount: 2n,
                membersSignature: 'b'.repeat(64),
                contentSha256: 'a'.repeat(64),
                completedAt: new Date()
              }
            })
            await tx.artworkDedupItem.update({
              where: { runId_artworkId: { runId: f.run.id, artworkId } },
              data: { snapshotRevision: snap.value.revision, mediaEpoch: snap.value.mediaEpoch, memberCount: 2n }
            })
          }
          await tx.artworkDedupGroup.update({ where: { id: f.groupIds[0]! }, data: { fileCount: 2n } })
          const images = await tx.image.findMany({ where: { artworkId: target }, orderBy: { id: 'asc' } })
          const items = []
          for (let n = 0; n < images.length; n++) {
            const image = images[n]!
            items.push(
              await tx.archiveImportItem.create({
                data: {
                  archiveImportId: archive.id,
                  pageIndex: 1 - n,
                  sourcePageUrl: 'https://example.invalid/page',
                  locator: {},
                  expectedFilename: `${image.id}.jpg`,
                  status: 'COMPLETED',
                  stagedPath: image.path.slice(prefix.length + 1),
                  byteCount: 10n,
                  sha256: 'a'.repeat(64)
                }
              })
            )
            await tx.artworkDedupMedia.create({
              data: {
                runId: f.run.id,
                artworkId: target,
                imageId: image.id,
                sourcePath: image.path,
                sourceRevision: 1n,
                logicalRoot: 'archive-media:v1',
                rootIdentity: 'archive-fixture',
                relativeDirectory: prefix,
                directoryId: randomUUID(),
                directoryGeneration: 1n,
                canonicalPath: image.path,
                size: 10n,
                sha256: 'a'.repeat(64)
              }
            })
          }
          const execution = await prepared(tx, f)
          const input = { execution, artworkId: target }
          expect(await readArtworkDedupArchiveManifestEvidence(tx, input)).toEqual({
            revisionId: revision.id,
            providerKey: ref.providerKey,
            externalId: ref.externalId,
            sealedManifestSha256: seal,
            memberCount: 2n
          })
          const page = await readArtworkDedupInventoryPage(tx, { ...input, limit: 1 })
          expect(page.images).toHaveLength(1)
          expect(page.images[0]?.archiveItem).toMatchObject({
            pageIndex: 1,
            stagedPath: items[0]!.stagedPath,
            sha256: 'a'.repeat(64),
            byteCount: 10n
          })
          await tx.archiveStagingGeneration.update({ where: { token }, data: { drainedAt: null } })
          await expect(readArtworkDedupArchiveManifestEvidence(tx, input)).rejects.toMatchObject({
            code: 'ARCHIVE_MANIFEST_UNVERIFIED'
          })
          await tx.archiveStagingGeneration.update({
            where: { token },
            data: { drainedAt: new Date(), manifestSha256: 'f'.repeat(64) }
          })
          await expect(readArtworkDedupArchiveManifestEvidence(tx, input)).rejects.toMatchObject({
            code: 'ARCHIVE_MANIFEST_UNVERIFIED'
          })
          await tx.archiveStagingGeneration.update({ where: { token }, data: { manifestSha256: seal } })
          await tx.archiveImportItem.update({ where: { id: items[0]!.id }, data: { sha256: 'f'.repeat(64) } })
          await expect(readArtworkDedupArchiveManifestEvidence(tx, input)).rejects.toMatchObject({
            code: 'ARCHIVE_MANIFEST_UNVERIFIED'
          })
          await tx.archiveImportItem.update({
            where: { id: items[0]!.id },
            data: { sha256: 'a'.repeat(64), stagedPath: items[1]!.stagedPath }
          })
          await expect(readArtworkDedupArchiveManifestEvidence(tx, input)).rejects.toMatchObject({
            code: 'ARCHIVE_MANIFEST_UNVERIFIED'
          })
          await tx.archiveImportItem.update({ where: { id: items[0]!.id }, data: { stagedPath: items[0]!.stagedPath } })
          await tx.image.update({ where: { id: images[0]!.id }, data: { size: 11n } })
          await expect(readArtworkDedupArchiveManifestEvidence(tx, input)).rejects.toMatchObject({
            code: 'ARCHIVE_MANIFEST_UNVERIFIED'
          })
          throw rollback
        },
        { timeout: 15000 }
      )
    } catch (error) {
      if (error !== rollback) throw error
    }
  })
})
