import path from 'node:path'
import { Prisma } from '@prisma/client'
import {
  ArtworkDedupOperationError,
  readArtworkDedupInventorySnapshot,
  readArtworkDedupArchiveManifestSnapshot
} from './artwork-dedup-operation'
import { validateArtworkDedupOperationSnapshot } from './artwork-dedup-review'
import { artworkDedupBoundRoots, refreshArtworkDedupFileOwnership } from './artwork-dedup-ownership'
import { freezeArtworkDedupOperationSources } from './artwork-dedup-claims'
import { artworkDedupDirectDeleteScopeDigest } from './artwork-dedup-direct-delete'

function canonical(value: string) {
  const result = value.replace(/\\/g, '/').replace(/^\/+/, '')
  if (
    !result ||
    result.includes('\0') ||
    /^[A-Za-z]:/.test(result) ||
    result.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw new ArtworkDedupOperationError('UNSAFE_PATH')
  return result
}
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v))) as Prisma.InputJsonValue

/** Freeze registered scope from completed scan evidence. No filesystem work and no durable claim before consent. */
export async function prepareArtworkDedupQuickConfirmation(tx: Prisma.TransactionClient, operationId: string) {
  const op = await tx.artworkDedupOperation.findUniqueOrThrow({ where: { id: operationId } })
  if (op.mode !== 'PREPARE' || op.status !== 'BUILDING' || op.preparePurpose !== 'DIRECT_DELETE' || op.jobId)
    throw new ArtworkDedupOperationError('INVALID_STATE')
  if (!(await validateArtworkDedupOperationSnapshot(tx, op.id)))
    throw new ArtworkDedupOperationError('SNAPSHOT_CHANGED')
  const roots = artworkDedupBoundRoots(op.rootBindings)
  let count = 0n,
    logicalBytes = 0n,
    unknownBytes = false,
    preparedArtworks = 0,
    afterArtworkId = 0
  for (;;) {
    const items = await tx.artworkDedupOperationArtwork.findMany({
      where: { operationId, artworkId: { gt: afterArtworkId } },
      orderBy: { artworkId: 'asc' },
      take: 500
    })
    if (!items.length) break
    for (const item of items) {
      let afterImageId = 0,
        mediaCount = 0n,
        fileCount = 0n
      let page: Awaited<ReturnType<typeof readArtworkDedupInventorySnapshot>>
      const address = (stored: string, archive: boolean) => {
        const root = archive ? roots.archive : roots.source
        const canonicalPath = canonical(
          `${archive && roots.archiveRelativePrefix ? `${roots.archiveRelativePrefix}/` : ''}${canonical(stored)}`
        )
        return {
          ...root,
          canonicalPath,
          relativeDirectory: path.posix.dirname(canonicalPath) === '.' ? '' : path.posix.dirname(canonicalPath)
        }
      }
      const save = async (entries: Prisma.ArtworkDedupOperationFileCreateManyInput[]) => {
        for (let start = 0; start < entries.length; start += 100) {
          const batch = entries.slice(start, start + 100)
          await tx.artworkDedupOperationFile.createMany({ data: batch })
          await refreshArtworkDedupFileOwnership(tx, {
            operationId,
            rootBindings: op.rootBindings,
            referenceKeys: batch.map((f) => f.referenceKey)
          })
        }
        count += BigInt(entries.length)
        fileCount += BigInt(entries.length)
      }
      do {
        page = await readArtworkDedupInventorySnapshot(tx, {
          operationId,
          artworkId: item.artworkId,
          afterImageId,
          limit: 500
        })
        if (page.blockReasons.length) throw new ArtworkDedupOperationError(page.blockReasons[0]!)
        const entries: Prisma.ArtworkDedupOperationFileCreateManyInput[] = []
        for (const image of page.images) {
          const d = image.evidence,
            location = address(image.path, item.isUrl)
          if (
            !d?.sha256 ||
            d.sourcePath !== image.path ||
            d.canonicalPath !== location.canonicalPath ||
            d.rootIdentity !== location.rootIdentity ||
            d.logicalRoot !== location.logicalRoot ||
            [d.mtimeNs, d.ctimeNs, d.deviceId, d.inode].some((v) => v === null)
          )
            throw new ArtworkDedupOperationError('INCOMPLETE_EVIDENCE')
          const expected = {
            size: d.size,
            mtimeNs: d.mtimeNs,
            ctimeNs: d.ctimeNs,
            deviceId: d.deviceId,
            inode: d.inode
          }
          entries.push({
            operationId,
            artworkId: item.artworkId,
            referenceKey: `media:${image.id}`,
            role: 'MEDIA',
            imageId: image.id,
            ...location,
            ...expected,
            sha256: d.sha256,
            sourceRevision: d.sourceRevision,
            directoryId: d.directoryId,
            directoryGeneration: d.directoryGeneration,
            verificationSpec: json({ version: 1, kind: 'MEDIA', sha256: d.sha256, state: expected }),
            inspectionStatus: 'PENDING',
            status: 'PENDING'
          })
          mediaCount++
          if (item.role === 'COPY') logicalBytes += d.size
          if (image.chaptersPath) {
            if (!image.chaptersHash || !/^[a-f0-9]{64}$/.test(image.chaptersHash))
              throw new ArtworkDedupOperationError('CHAPTER_IDENTITY_MISMATCH')
            entries.push({
              operationId,
              artworkId: item.artworkId,
              referenceKey: `chapter:${image.id}`,
              role: 'CHAPTER',
              imageId: image.id,
              ...address(image.chaptersPath, item.isUrl),
              verificationSpec: json({
                version: 1,
                kind: 'SOURCE',
                expectedIdentity: { kind: 'CHAPTER', chaptersHash: image.chaptersHash }
              }),
              inspectionStatus: 'PENDING',
              status: 'PENDING'
            })
            if (item.role === 'COPY') unknownBytes = true
          }
        }
        await save(entries)
        afterImageId = page.nextImageId ?? afterImageId
      } while (page.nextImageId !== null)
      if (mediaCount !== item.memberCount) throw new ArtworkDedupOperationError('INCOMPLETE_INVENTORY')
      const entries: Prisma.ArtworkDedupOperationFileCreateManyInput[] = []
      for (const reference of page.sourceReferences) {
        const seal =
          reference.expectedIdentity.kind === 'ARCHIVE_MANIFEST'
            ? await readArtworkDedupArchiveManifestSnapshot(tx, {
                operationId,
                artworkId: item.artworkId,
                allowLegacyManifestMapping: true
              })
            : undefined
        entries.push({
          operationId,
          artworkId: item.artworkId,
          referenceKey: reference.referenceKey,
          role: 'SOURCE_FILE',
          revisionId: reference.revisionId,
          ...address(reference.path, reference.rootKind === 'ARCHIVE'),
          verificationSpec: json({ version: 1, kind: 'SOURCE', expectedIdentity: reference.expectedIdentity, seal }),
          inspectionStatus: 'PENDING',
          status: 'PENDING'
        })
        if (item.role === 'COPY') unknownBytes = true
      }
      await save(entries)
      await tx.artworkDedupOperationArtwork.update({
        where: { operationId_artworkId: { operationId, artworkId: item.artworkId } },
        data: { inventoryComplete: true, fileCount }
      })
    }
    preparedArtworks += items.length
    afterArtworkId = items.at(-1)!.artworkId
  }
  if (
    await tx.artworkDedupOperationFile.count({
      where: { operationId, OR: [{ ownershipStatus: { not: 'VERIFIED' } }, { blockReason: { not: null } }] }
    })
  )
    throw new ArtworkDedupOperationError('OWNERSHIP_CHANGED')
  await freezeArtworkDedupOperationSources(tx, operationId)
  await tx.artworkDedupOperation.update({
    where: { id: operationId },
    data: {
      preparationVersion: 2,
      status: 'READY',
      stage: 'CONFIRM',
      preparedArtworks,
      preparedFiles: count,
      logicalBytes: unknownBytes ? null : logicalBytes,
      validatedAt: new Date(),
      version: { increment: 1 }
    }
  })
  return tx.artworkDedupOperation.update({
    where: { id: operationId },
    data: { scopeDigest: await artworkDedupDirectDeleteScopeDigest(tx, operationId) }
  })
}
