import { Prisma } from '@prisma/client'
import { groupLogicalMedia, inferMediaTypeFromPath } from '@pixishelf/job-contracts'

export interface LockedArtworkReading {
  id: number
  mediaRevision: number
  logicalMediaCount: number
  readingLayoutVersion: number
}
export interface ArtworkReadingLockTransaction {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>
}
export interface ArtworkReadingInvalidationTransaction extends ArtworkReadingLockTransaction {
  artwork: {
    update(args: {
      where: { id: number }
      data: {
        mediaRevision: { increment: number }
        readingLayoutVersion: { increment: number }
        logicalMediaCount: number
      }
      select: { mediaRevision: true }
    }): Promise<{ mediaRevision: number }>
  }
  artworkReadingProgress: { deleteMany(args: { where: { artworkId: number } }): Promise<{ count: number }> }
}
interface ArtworkReadingLayoutTransaction {
  image: {
    findMany(args: {
      where: { artworkId: number }
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
      select: { id: true; path: true; mediaType: true }
    }): Promise<Array<{ id: number; path: string; mediaType: string }>>
  }
}
interface ArtworkReadingLayoutRefreshTransaction extends ArtworkReadingLayoutTransaction {
  artwork: {
    update(args: {
      where: { id: number }
      data: { logicalMediaCount: number; readingLayoutVersion?: { increment: number } }
    }): Promise<unknown>
  }
  artworkReadingProgress: {
    findMany(args: {
      where: { artworkId: number }
    }): Promise<
      Array<{
        userId: string
        completed: boolean
        furthestMediaId: number | null
        furthestMediaIndex: number | null
        lastMediaId: number | null
        lastMediaIndex: number | null
      }>
    >
    update(args: {
      where: { userId_artworkId: { userId: string; artworkId: number } }
      data: {
        furthestMediaId: number | null
        furthestMediaIndex: number | null
        lastMediaId: number | null
        lastMediaIndex: number | null
        completed: boolean
        stateVersion: { increment: number }
      }
    }): Promise<unknown>
  }
}

/** Reading reports and media writers acquire this lock before inspecting or changing media. */
export async function lockArtworkForReading(
  tx: ArtworkReadingLockTransaction,
  artworkId: number
): Promise<LockedArtworkReading | null> {
  const rows = await tx.$queryRaw<LockedArtworkReading[]>(Prisma.sql`
    SELECT "id", "mediaRevision", "logicalMediaCount", "readingLayoutVersion"
    FROM "Artwork" WHERE "id" = ${artworkId} FOR UPDATE
  `)
  return rows[0] ?? null
}
export interface ArtworkReadingLayoutItem {
  mediaId: number
  memberMediaIds: number[]
  isVideo: boolean
}

/** Read once before a publication, under the artwork lock; never once per Image write. */
export async function readArtworkReadingLayout(
  tx: ArtworkReadingLayoutTransaction,
  artworkId: number
): Promise<ArtworkReadingLayoutItem[]> {
  const images = await tx.image.findMany({
    where: { artworkId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, path: true, mediaType: true }
  })
  return groupLogicalMedia(images).map(({ item, members }) => ({
    mediaId: item.id,
    memberMediaIds: members.map((member) => member.id),
    isVideo: item.mediaType === 'VIDEO' || inferMediaTypeFromPath(item.path) === 'VIDEO'
  }))
}

/** Reconcile anchors and the cached count once, in the same transaction as the media publication. */
export async function refreshArtworkReadingLayout(
  tx: ArtworkReadingLayoutRefreshTransaction,
  artworkId: number,
  previous: ArtworkReadingLayoutItem[],
  incrementVersion = true
): Promise<void> {
  const next = await readArtworkReadingLayout(tx, artworkId)
  if (JSON.stringify(previous) === JSON.stringify(next)) return
  await tx.artwork.update({
    where: { id: artworkId },
    data: {
      logicalMediaCount: next.length,
      ...(incrementVersion ? { readingLayoutVersion: { increment: 1 } } : {})
    }
  })
  const positions = new Map(
    next.flatMap((item, index) => item.memberMediaIds.map((id) => [id, { mediaId: item.mediaId, index }] as const))
  )
  const relocated = previous.map((item) =>
    item.memberMediaIds.map((id) => positions.get(id)).find((item) => item !== undefined)
  )
  const locate = (id: number | null, index: number | null, last: boolean) => {
    if (id === null) return null
    const surviving = positions.get(id)
    if (surviving) return surviving
    const oldIndex = previous.findIndex((item) => item.memberMediaIds.includes(id))
    for (let i = oldIndex >= 0 ? oldIndex : (index ?? -1); i >= 0; i--) {
      if (relocated[i]) return relocated[i]!
    }
    return last && next[0] ? { mediaId: next[0].mediaId, index: 0 } : null
  }
  const rows = await tx.artworkReadingProgress.findMany({ where: { artworkId } })
  for (const row of rows) {
    const furthest = locate(row.furthestMediaId, row.furthestMediaIndex, false)
    const last = locate(row.lastMediaId, row.lastMediaIndex, true)
    await tx.artworkReadingProgress.update({
      where: { userId_artworkId: { userId: row.userId, artworkId } },
      data: {
        furthestMediaId: furthest?.mediaId ?? null,
        furthestMediaIndex: furthest?.index ?? null,
        lastMediaId: last?.mediaId ?? null,
        lastMediaIndex: last?.index ?? null,
        completed: row.completed || (next.length > 0 && furthest?.index === next.length - 1),
        stateVersion: { increment: 1 }
      }
    })
  }
}

/** Full replacement retires every account's progress and advances both independent versions. */
export async function invalidateArtworkReadingForRebuild(
  tx: ArtworkReadingInvalidationTransaction,
  artworkId: number
): Promise<number> {
  if (!(await lockArtworkForReading(tx, artworkId))) throw new Error(`Artwork ${artworkId} does not exist`)
  const updated = await tx.artwork.update({
    where: { id: artworkId },
    data: {
      mediaRevision: { increment: 1 },
      readingLayoutVersion: { increment: 1 },
      logicalMediaCount: 0
    },
    select: { mediaRevision: true }
  })
  await tx.artworkReadingProgress.deleteMany({ where: { artworkId } })
  return updated.mediaRevision
}
