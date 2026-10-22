import { beginSummaryImageWrite, lockArtworkForReading, Prisma } from '@pixishelf/db'
import { prisma } from '@/lib/prisma'
import { groupLogicalMedia } from './logical-media'

export async function beginSummaryPathWrite(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '')
  return prisma.$transaction(async (tx) => {
    const where = { path: { in: [normalized, `/${normalized}`] } }
    const candidates = await tx.image.findMany({ where, select: { artworkId: true } })
    const artworkIds = [...new Set(candidates.flatMap((image) => image.artworkId === null ? [] : [image.artworkId]))].sort((a, b) => a - b)
    for (const artworkId of artworkIds) await lockArtworkForReading(tx, artworkId)
    const images = await tx.image.findMany({ where: { ...where, artworkId: { in: artworkIds } }, select: { id: true, artworkId: true } })
    const tokens: { imageId: number; sourceRevision: number }[] = []
    for (const image of images) {
      if (!image.artworkId) continue
      const feature = await beginSummaryImageWrite(tx as unknown as Prisma.TransactionClient, image.id, image.artworkId)
      tokens.push({ imageId: image.id, sourceRevision: feature.sourceRevision })
    }
    return tokens
  })
}

export async function finishSummaryPathWrite(tokens: { imageId: number; sourceRevision: number }[]) {
  if (tokens.length === 0) return
  await prisma.$transaction(async (tx) => {
    const candidates = await tx.image.findMany({ where: { id: { in: tokens.map((token) => token.imageId) } }, select: { artworkId: true } })
    const artworkIds = [...new Set(candidates.flatMap((image) => image.artworkId === null ? [] : [image.artworkId]))].sort((a, b) => a - b)
    for (const artworkId of artworkIds) await lockArtworkForReading(tx, artworkId)
    const writtenIds = new Set<number>()
    for (const token of tokens) {
      const result = await tx.artworkSummaryFeature.updateMany({
        where: { imageId: token.imageId, sourceRevision: token.sourceRevision, writeInProgress: true },
        data: { writeInProgress: false }
      })
      if (result.count > 0) writtenIds.add(token.imageId)
    }
    // Only a successful, revision-fenced overwrite retires marks. Replace rollback uses finishSummaryReplace.
    const images = await tx.image.findMany({ where: { artworkId: { in: artworkIds } }, select: { id: true, artworkId: true, path: true, mediaType: true } })
    const affectedIds = artworkIds.flatMap((artworkId) => groupLogicalMedia(images.filter((image) => image.artworkId === artworkId))
      .filter((group) => group.members.some((member) => writtenIds.has(member.id)))
      .flatMap((group) => group.members.map((member) => member.id)))
    if (affectedIds.length > 0) await tx.mediaMark.updateMany({ where: { mediaId: { in: affectedIds } }, data: { mediaId: null } })
  })
}

export async function beginSummaryReplace(artworkId: number) {
  await prisma.$transaction(async (tx) => {
    await lockArtworkForReading(tx, artworkId)
    await tx.artworkSummary.upsert({ where: { artworkId },
      create: { artworkId, replaceInProgress: true, sourceRevision: 1 },
      update: { replaceInProgress: true, sourceRevision: { increment: 1 } } })
  })
}

/** Called under the existing directory write lock, only after commit or a verified rollback. */
export async function finishSummaryReplace(artworkId: number) {
  await prisma.$transaction(async (tx) => {
    await lockArtworkForReading(tx, artworkId)
    await tx.artworkSummaryFeature.updateMany({ where: { image: { artworkId } }, data: { writeInProgress: false, sourceKey: null } })
    await tx.artworkSummary.updateMany({ where: { artworkId }, data: { replaceInProgress: false, sourceRevision: { increment: 1 } } })
  })
}
