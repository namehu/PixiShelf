import { lockCreatorCatalog } from './creators'
import { Prisma } from '@prisma/client'
import { ArtworkDedupOperationError } from './artwork-dedup-operation'

/** User FK locks stop new private rows; NOWAIT resolves the normal Artwork -> User writer order by rolling back deletion. */
export async function deleteUserWithArtworkDedupProtection(tx: Prisma.TransactionClient, userId: string) {
  await lockCreatorCatalog(tx)
  const users = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "UserBA" ORDER BY id FOR UPDATE NOWAIT`)
  if (!users.some((user) => user.id === userId)) throw new ArtworkDedupOperationError('NOT_FOUND')
  if (users.length <= 1) throw new ArtworkDedupOperationError('LAST_USER')
  await tx.$queryRaw(
    Prisma.sql`SELECT "runId" FROM "ArtworkDedupReviewState" WHERE "userId"=${userId} ORDER BY "runId" FOR UPDATE NOWAIT`
  )
  await tx.$queryRaw(Prisma.sql`SELECT count(*) FROM(SELECT a.id FROM "Artwork" a WHERE a.id IN(
    SELECT "artworkId" FROM "ArtworkLike" WHERE "userId"=${userId} UNION SELECT "artworkId" FROM "MediaMark" WHERE "userId"=${userId} UNION SELECT "artworkId" FROM artwork_reading_summaries WHERE "userId"=${userId}
  ) ORDER BY a.id FOR UPDATE NOWAIT)locked`)
  // Claims also preserve private protection facts until maintenance has released the artwork.
  const claimed = await tx.$queryRaw<{ id: number }[]>(
    Prisma.sql`SELECT c."artworkId" id FROM "ArtworkDedupClaim" c WHERE EXISTS(SELECT 1 FROM "ArtworkLike" l WHERE l."artworkId"=c."artworkId" AND l."userId"=${userId}) OR EXISTS(SELECT 1 FROM "MediaMark" m WHERE m."artworkId"=c."artworkId" AND m."userId"=${userId}) LIMIT 1`
  )
  if (claimed.length) throw new ArtworkDedupOperationError('ARTWORK_MAINTENANCE_ACTIVE')
  await tx.artworkDedupReviewState.deleteMany({ where: { userId } })
  await tx.userBA.delete({ where: { id: userId } })
}
