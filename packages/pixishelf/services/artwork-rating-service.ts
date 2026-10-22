import 'server-only'
import { TRPCError } from '@trpc/server'
import { lockArtworkForReading } from '@pixishelf/db'
import { prisma } from '@/lib/prisma'
import {
  ArtworkRatingLevelSchema,
  isArtworkLiked,
  type ArtworkRatingLevel,
  type ArtworkRatingState
} from '@/schemas/artwork-rating.dto'

const ratingSelect = { level: true, updatedAt: true } as const

function toState(artworkId: number, rating: { level: number; updatedAt: Date } | null): ArtworkRatingState {
  const level = ArtworkRatingLevelSchema.parse(rating?.level ?? null)
  return { artworkId, level, isLike: isArtworkLiked(level), updatedAt: rating?.updatedAt.toISOString() ?? null }
}

export async function getArtworkRating(userId: string, artworkId: number): Promise<ArtworkRatingState> {
  const artwork = await prisma.artwork.findUnique({
    where: { id: artworkId, deletedAt: null, archiveLifecycleState: 'ACTIVE' },
    select: { likes: { where: { userId }, select: ratingSelect } }
  })
  if (!artwork) throw new TRPCError({ code: 'NOT_FOUND', message: 'Artwork not found' })
  return toState(artworkId, artwork.likes[0] ?? null)
}

/** Absolute writes are idempotent; all personal rating writers share the artwork lock. */
export async function setArtworkRating(
  userId: string,
  artworkId: number,
  level: ArtworkRatingLevel
): Promise<ArtworkRatingState> {
  ArtworkRatingLevelSchema.parse(level)
  return prisma.$transaction(async (tx) => {
    const locked = await lockArtworkForReading(tx, artworkId)
    if (!locked) throw new TRPCError({ code: 'NOT_FOUND', message: 'Artwork not found' })
    const artwork = await tx.artwork.findUnique({
      where: { id: artworkId },
      select: { deletedAt: true, archiveLifecycleState: true }
    })
    if (!artwork || artwork.deletedAt !== null || artwork.archiveLifecycleState !== 'ACTIVE') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Artwork not found' })
    }
    const where = { userId_artworkId: { userId, artworkId } }
    const existing = await tx.artworkLike.findUnique({ where, select: ratingSelect })
    if ((existing?.level ?? null) === level) return toState(artworkId, existing)
    if (level === null) {
      await tx.artworkLike.deleteMany({ where: { userId, artworkId } })
      return toState(artworkId, null)
    }
    const rating = await tx.artworkLike.upsert({
      where,
      create: { userId, artworkId, level },
      update: { level },
      select: ratingSelect
    })
    return toState(artworkId, rating)
  })
}

/** Bounded feed hydration returns the rating; the boolean like state is always derived. */
export async function getUserArtworkRatingLevels(
  userId: string,
  artworkIds: number[]
): Promise<Record<number, ArtworkRatingLevel>> {
  if (!userId || artworkIds.length === 0) return {}
  const ratings = await prisma.artworkLike.findMany({
    where: { userId, artworkId: { in: artworkIds } },
    select: { artworkId: true, level: true }
  })
  return Object.fromEntries(ratings.map((rating) => [rating.artworkId, ArtworkRatingLevelSchema.parse(rating.level)]))
}
