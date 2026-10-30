import { Prisma } from '@prisma/client'
import { assertArtworkDedupExecution, type ArtworkDedupExecution, type ArtworkDedupMediaEntry } from './artwork-dedup'
import { activeCreatorMembership, lockCreatorCatalog, visibleCreatorArtwork } from './creators'
import { directorySnapshot, lockContentArtworks, lockContentImages } from './media-content-common'
import { assertArtworkDedupVisualDirectories } from './artwork-dedup-visual'
import type { MediaContentMember } from './media-content-types'

/** These ordinary reads are metadata only. They never grant write authority. */
export async function readArtworkDedupHotInventoryPage(
  db: Prisma.TransactionClient,
  runId: string,
  afterArtworkId = 0
) {
  const items = await db.artworkDedupItem.findMany({
    where: { runId, artworkId: { gt: afterArtworkId }, status: { in: ['PENDING', 'STATTING'] } },
    orderBy: { artworkId: 'asc' },
    take: 500
  })
  const artworks = items.length
    ? await db.artwork.findMany({
        where: { id: { in: items.map((i) => i.artworkId) } },
        select: { id: true, source: true, contentSource: true, contentFingerprint: true }
      })
    : []
  const byId = new Map(artworks.map((a) => [a.id, a]))
  return items.map((item) => ({ item, artwork: byId.get(item.artworkId) }))
}
export type ArtworkDedupHotInventory = Awaited<ReturnType<typeof readArtworkDedupHotInventoryPage>>[number]
export async function readArtworkDedupHotMembersPage(
  db: Prisma.TransactionClient,
  artworkIds: number[],
  afterImageId = 0
): Promise<MediaContentMember[]> {
  if (!artworkIds.length || artworkIds.length > 500) throw new RangeError('Hot inventory page')
  const rows = await db.image.findMany({
    where: { artworkId: { in: artworkIds }, id: { gt: afterImageId } },
    orderBy: { id: 'asc' },
    take: 500,
    select: {
      id: true,
      artworkId: true,
      path: true,
      contentSource: { include: { directory: true } },
      contentFingerprint: true
    }
  })
  return rows.map((row) => ({
    imageId: row.id,
    artworkId: row.artworkId!,
    sourcePath: row.path,
    sourceRevision: row.contentSource?.revision ?? 0n,
    writeToken: row.contentSource?.writeToken ?? null,
    directory: row.contentSource?.directory ? directorySnapshot(row.contentSource.directory) : null,
    fingerprint: row.contentFingerprint
  }))
}
export interface ArtworkDedupHotCommit {
  inventory: ArtworkDedupHotInventory
  entries: ArtworkDedupMediaEntry[]
  complete: boolean
}

/** v9 only: one batch fence, then media, completed fingerprints, cursors and counters commit together. */
export async function saveArtworkDedupHotRunBatch(
  tx: Prisma.TransactionClient,
  execution: ArtworkDedupExecution,
  batches: ArtworkDedupHotCommit[]
) {
  const entries = batches.flatMap((b) =>
    b.entries.map((entry) => ({ ...entry, artworkId: b.inventory.item.artworkId }))
  )
  if (!batches.length || batches.length > 50 || !entries.length || entries.length > 500)
    throw new RangeError('Hot commit budget')
  const run = await assertArtworkDedupExecution(tx, execution)
  await lockCreatorCatalog(tx)
  const directories = [
    ...new Map(
      batches
        .flatMap((b) => b.entries)
        .map((e) => [
          e.directoryId,
          {
            logicalRoot: e.logicalRoot as 'source-media:v1' | 'archive-media:v1',
            rootIdentity: e.rootIdentity,
            relativeDirectory: e.relativeDirectory,
            directoryId: e.directoryId,
            generation: BigInt(e.directoryGeneration)
          }
        ])
    ).values()
  ]
  if (!(await assertArtworkDedupVisualDirectories(tx, directories))) return false
  const ids = batches.map((b) => b.inventory.item.artworkId)
  await lockContentArtworks(tx, ids)
  const [items, artworks] = await Promise.all([
    tx.artworkDedupItem.findMany({ where: { runId: run.id, artworkId: { in: ids } } }),
    tx.artwork.findMany({
      where: {
        id: { in: ids },
        ...visibleCreatorArtwork,
        creators: { some: { artistId: run.artistId, ...activeCreatorMembership, artist: { mergedIntoId: null } } }
      },
      select: {
        id: true,
        mediaRevision: true,
        contentSource: true,
        contentFingerprint: true,
        _count: { select: { images: true } }
      }
    })
  ])
  const itemMap = new Map(items.map((i) => [i.artworkId, i])),
    artworkMap = new Map(artworks.map((a) => [a.id, a]))
  for (const batch of batches) {
    const expected = batch.inventory,
      item = itemMap.get(expected.item.artworkId),
      art = artworkMap.get(expected.item.artworkId)
    const cached = expected.artwork?.contentFingerprint,
      current = art?.contentFingerprint,
      source = art?.contentSource
    if (
      !item ||
      !art ||
      !cached ||
      !current ||
      !source ||
      source.writeToken ||
      item.status !== expected.item.status ||
      item.afterImageId !== expected.item.afterImageId ||
      art.mediaRevision !== item.frozenMediaRevision ||
      source.revision !== cached.sourceRevision ||
      source.mediaEpoch !== cached.mediaEpoch ||
      current.algorithmVersion !== run.algorithmVersion ||
      current.sourceRevision !== cached.sourceRevision ||
      current.mediaEpoch !== cached.mediaEpoch ||
      current.contentSha256 !== cached.contentSha256 ||
      current.membersSignature !== cached.membersSignature ||
      current.fileCount !== cached.fileCount ||
      BigInt(art._count.images) !== cached.fileCount ||
      (item.status !== 'PENDING' &&
        (item.snapshotRevision !== cached.sourceRevision ||
          item.mediaEpoch !== cached.mediaEpoch ||
          item.memberCount !== cached.fileCount))
    )
      return false
  }
  await lockContentImages(
    tx,
    entries.map((e) => e.imageId)
  )
  const members = await tx.image.findMany({
    where: { id: { in: entries.map((e) => e.imageId) } },
    select: { id: true, artworkId: true, path: true, contentSource: true, contentFingerprint: true }
  })
  const memberMap = new Map(members.map((m) => [m.id, m]))
  for (const entry of entries) {
    const member = memberMap.get(entry.imageId),
      cached = member?.contentFingerprint,
      source = member?.contentSource
    if (
      !member ||
      !cached ||
      !source ||
      source.writeToken ||
      member.artworkId !== entry.artworkId ||
      member.path !== entry.sourcePath ||
      source.revision !== BigInt(entry.sourceRevision) ||
      source.directoryStateId !== entry.directoryId ||
      cached.algorithmVersion !== run.algorithmVersion ||
      cached.sourceRevision !== source.revision ||
      cached.artworkMediaEpoch !== artworkMap.get(entry.artworkId)!.contentSource!.mediaEpoch ||
      cached.sourcePath !== entry.sourcePath ||
      cached.rootIdentity !== entry.rootIdentity ||
      cached.canonicalPath !== entry.canonicalPath ||
      cached.sha256 !== entry.sha256 ||
      cached.size !== BigInt(entry.size) ||
      cached.mtimeNs !== entry.mtimeNs ||
      cached.ctimeNs !== entry.ctimeNs ||
      cached.deviceId !== entry.deviceId ||
      cached.inode !== entry.inode
    )
      return false
  }
  const completed = batches.filter((b) => b.complete)
  if (completed.length) {
    const counts = await tx.artworkDedupMedia.groupBy({
      by: ['artworkId'],
      where: {
        runId: run.id,
        artworkId: { in: completed.map((b) => b.inventory.item.artworkId) },
        sha256: { not: null }
      },
      _count: true
    })
    const previousCounts = new Map(counts.map((c) => [c.artworkId, c._count]))
    if (
      completed.some(
        (b) =>
          BigInt((previousCounts.get(b.inventory.item.artworkId) ?? 0) + b.entries.length) !==
          b.inventory.artwork!.contentFingerprint!.fileCount
      )
    )
      return false
  }
  await tx.artworkDedupMedia.createMany({ data: entries.map((e) => ({ ...e, runId: run.id })) })
  await tx.$executeRaw(Prisma.sql`
    UPDATE "ArtworkDedupItem" i SET status=v.status,"snapshotRevision"=v.revision,"mediaEpoch"=v.epoch,"memberCount"=v.count,
      "afterImageId"=v.cursor,"contentSha256"=v.sha,"membersSignature"=v.signature,"updatedAt"=CURRENT_TIMESTAMP
    FROM (VALUES ${Prisma.join(
      batches.map((b) => {
        const f = b.inventory.artwork!.contentFingerprint!
        return Prisma.sql`
      (${b.inventory.item.artworkId}::integer,${b.complete ? 'COMPLETE' : 'STATTING'}::text,${f.sourceRevision}::bigint,${f.mediaEpoch}::bigint,${f.fileCount}::bigint,
       ${b.entries.at(-1)!.imageId}::integer,${b.complete ? f.contentSha256 : null}::text,${b.complete ? f.membersSignature : null}::text)`
      })
    )})
      v(id,status,revision,epoch,count,cursor,sha,signature) WHERE i."runId"=${run.id} AND i."artworkId"=v.id`)
  await tx.artworkDedupRun.update({
    where: { id: run.id },
    data: {
      statMedia: { increment: entries.length },
      cacheHitMedia: {
        increment: completed.reduce((n, b) => n + Number(b.inventory.artwork!.contentFingerprint!.fileCount), 0)
      },
      processedArtworks: { increment: completed.length },
      completeArtworks: { increment: completed.length }
    }
  })
  return true
}
