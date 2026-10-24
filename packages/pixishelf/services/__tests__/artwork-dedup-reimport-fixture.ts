import * as fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { captureArtworkDedupSources, lockCreatorCatalog } from '@pixishelf/db'
import { serializeArtworkDedupSourceSnapshot, type ScanPayload } from '@pixishelf/job-contracts'
import { executeLocalArtworkRescan } from '../../../pixishelf-job-executors/src/scan/local-rescan'
import { publishLocalMediaWork } from '../../../pixishelf-job-executors/src/scan/local-publisher'
import { resolveSafeScanRoot } from '../../../pixishelf-job-executors/src/scan/paths'
import { localWorkInputDigest } from '../../../pixishelf-job-executors/src/scan/digests'
import { DEFAULT_SCAN_LIMITS } from '../../../pixishelf-job-executors/src/scan/types'
import { collectLocalMedia } from '../../../pixishelf-job-executors/src/scan/discovery'
import {
  db,
  root,
  clock,
  repository,
  executionContext,
  fence,
  trackMaintenanceJob
} from '../../../pixishelf-job-executors/src/artwork-dedup/__tests__/maintenance-executor-fixture'
import { expect } from 'vitest'

export async function freezeOldReimportIntent(operationId: string) {
  const op = await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: operationId } })
  const copy = await db!.artworkDedupOperationArtwork.findFirstOrThrow({
    where: { operationId, role: 'COPY' },
    orderBy: { artworkId: 'asc' }
  })
  const binding = await db!.artworkDedupOperationSource.findFirstOrThrow({
    where: { operationId, artworkId: copy.artworkId, source: { kind: 'DIRECTORY' } },
    include: { source: true }
  })
  const identity = {
    kind: 'DIRECTORY' as const,
    logicalRoot: 'source-media:v1' as const,
    rootIdentity: binding.source.rootIdentity!,
    canonicalPath: binding.source.canonicalPath!
  }
  const snapshot = serializeArtworkDedupSourceSnapshot(
    await db!.$transaction((tx) => captureArtworkDedupSources(tx, { identities: [identity] }))
  )
  const frozen = await scanIntent(snapshot)
  async function scanIntent(proof: typeof snapshot) {
    const job = await db!.systemJob.create({
      data: {
        type: 'SCAN',
        triggerSource: 'SYSTEM',
        queuePriority: 900,
        effectivePriority: 900,
        availableAt: clock.now(),
        payload: { mode: 'ARTWORK_RESCAN', artworkId: copy.artworkId }
      }
    })
    trackMaintenanceJob(job.id)
    const work = {
      ordinal: 0,
      kind: 'MEDIA_DIRECTORY' as const,
      relativePath: copy.storagePath!,
      fingerprint: 'a'.repeat(64),
      dedupSourceSnapshot: proof
    }
    const run = await db!.scanRun.create({
      data: {
        systemJobId: job.id,
        type: 'LOCAL_IMPORT',
        mode: 'LOCAL_RESCAN',
        status: 'RUNNING',
        inputCount: 1,
        inputDigest: localWorkInputDigest([work]),
        inputFrozenAt: new Date(),
        localWorkInputs: { create: work }
      }
    })
    const row = await db!.scanRunLocalWorkInput.findFirstOrThrow({ where: { scanRunId: run.id } })
    return { job, run, row }
  }
  const publication = async (intent: typeof frozen, tagId = 1) =>
    db!.$transaction(async (tx) => {
      await lockCreatorCatalog(tx)
      return publishLocalMediaWork({
        transaction: tx as never,
        runId: intent.run.id,
        work: intent.row,
        title: 'explicit reimport fixture',
        now: new Date(),
        artistId: op.artistId,
        media: await collectLocalMedia(
          await resolveSafeScanRoot(root),
          copy.storagePath!,
          { maxEntries: 100, maxMediaPerArtwork: 100 },
          new AbortController().signal
        ),
        mediaDerivedTagIds: { image: tagId, webp: tagId, video: tagId },
        defaultTagIds: []
      })
    })
  return {
    async assertTombstone() {
      await expect(
        db!.$transaction((tx) => captureArtworkDedupSources(tx, { identities: [identity] }))
      ).rejects.toMatchObject({ code: 'SOURCE_HELD' })
      const job = await repository!.claim('dedup-b2-old-rescan', [
        { jobType: 'SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
      ])
      expect(job?.id).toBe(frozen.job.id)
      await expect(
        executeLocalArtworkRescan({
          context: executionContext<ScanPayload>(job!),
          dependencies: { database: db! as never, config: { scanRoot: root } },
          root: await resolveSafeScanRoot(root),
          run: frozen.run,
          limits: DEFAULT_SCAN_LIMITS,
          now: new Date()
        })
      ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
      await repository!.fail({ ...fence(job!), errorCode: 'STATE_CONFLICT', error: 'synthetic tombstone rejection' })
      await expect(publication(frozen)).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
      expect(await db!.artwork.findUnique({ where: { id: copy.artworkId } })).toBeNull()
    },
    async assertNewIntentOnly() {
      // Explicit new input supplies a new file; allowing reimport never restores the deleted originals.
      await fs.writeFile(
        path.join(root, copy.storagePath!, 'new-explicit.png'),
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=',
          'base64'
        )
      )
      await expect(publication(frozen)).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
      const current = serializeArtworkDedupSourceSnapshot(
        await db!.$transaction((tx) => captureArtworkDedupSources(tx, { identities: [identity] }))
      )
      expect(current.sources[0]!.generation).not.toBe(snapshot.sources[0]!.generation)
      const fresh = await scanIntent(current)
      const tag = await db!.tag.create({ data: { name: `dedup-b2-reimport-${randomUUID()}` } })
      let artworkId: number | undefined
      try {
        const result = await publication(fresh, tag.id)
        artworkId = result.artworkId ?? undefined
        expect(result).toMatchObject({ status: 'SUCCESS', newImages: 1 })
        expect(artworkId).not.toBe(copy.artworkId)
      } finally {
        if (artworkId) {
          await db!.image.deleteMany({ where: { artworkId } })
          await db!.artwork.delete({ where: { id: artworkId } })
        }
        await db!.tag.delete({ where: { id: tag.id } })
      }
    }
  }
}
