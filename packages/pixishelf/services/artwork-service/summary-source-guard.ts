import { beginSummaryImageWrite, Prisma } from '@pixishelf/db'
import { prisma } from '@/lib/prisma'

export async function beginSummaryPathWrite(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '')
  return prisma.$transaction(async (tx) => {
    const images = await tx.image.findMany({ where: { path: { in: [normalized, `/${normalized}`] } }, select: { id: true, artworkId: true } })
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
  await prisma.$transaction(async (tx) => {
    for (const token of tokens) {await tx.artworkSummaryFeature.updateMany({
      where: { imageId: token.imageId, sourceRevision: token.sourceRevision }, data: { writeInProgress: false }
    })}
  })
}

export async function beginSummaryReplace(artworkId: number) {
  await prisma.artworkSummary.upsert({ where: { artworkId },
    create: { artworkId, replaceInProgress: true, sourceRevision: 1 },
    update: { replaceInProgress: true, sourceRevision: { increment: 1 } } })
}

/** Called under the existing directory write lock, only after commit or a verified rollback. */
export async function finishSummaryReplace(artworkId: number) {
  await prisma.$transaction(async (tx) => {
    await tx.artworkSummaryFeature.updateMany({ where: { image: { artworkId } }, data: { writeInProgress: false, sourceKey: null } })
    await tx.artworkSummary.updateMany({ where: { artworkId }, data: { replaceInProgress: false, sourceRevision: { increment: 1 } } })
  })
}
