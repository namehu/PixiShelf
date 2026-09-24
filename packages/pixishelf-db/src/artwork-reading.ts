import { Prisma } from '@prisma/client'

export interface LockedArtworkReading {
  id: number
  mediaRevision: number
}

export interface ArtworkReadingLockTransaction {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>
}

export interface ArtworkReadingInvalidationTransaction extends ArtworkReadingLockTransaction {
  artwork: {
    update(args: {
      where: { id: number }
      data: { mediaRevision: { increment: number } }
      select: { mediaRevision: true }
    }): Promise<{ mediaRevision: number }>
  }
  artworkReadMedia: {
    deleteMany(args: { where: { artworkId: number } }): Promise<{ count: number }>
  }
  artworkReadingSummary: {
    deleteMany(args: { where: { artworkId: number } }): Promise<{ count: number }>
  }
}

/**
 * The common first database lock for reading initialization, reports and complete
 * media rebuilds. Call before reading or changing the artwork's media rows.
 */
export async function lockArtworkForReading(
  tx: ArtworkReadingLockTransaction,
  artworkId: number
): Promise<LockedArtworkReading | null> {
  const rows = await tx.$queryRaw<LockedArtworkReading[]>(Prisma.sql`
    SELECT "id", "mediaRevision"
    FROM "Artwork"
    WHERE "id" = ${artworkId}
    FOR UPDATE
  `)
  return rows[0] ?? null
}

/**
 * Invalidate every account's reading state as part of an existing media publish
 * transaction. The caller must invoke this before its media writes so all reading
 * and rebuild paths acquire the Artwork row lock in the same order.
 */
export async function invalidateArtworkReadingForRebuild(
  tx: ArtworkReadingInvalidationTransaction,
  artworkId: number
): Promise<number> {
  const artwork = await lockArtworkForReading(tx, artworkId)
  if (!artwork) throw new Error(`Artwork ${artworkId} does not exist`)

  const updated = await tx.artwork.update({
    where: { id: artworkId },
    data: { mediaRevision: { increment: 1 } },
    select: { mediaRevision: true }
  })
  await tx.artworkReadMedia.deleteMany({ where: { artworkId } })
  await tx.artworkReadingSummary.deleteMany({ where: { artworkId } })
  return updated.mediaRevision
}
