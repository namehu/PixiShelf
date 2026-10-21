import { Prisma } from '@prisma/client'

type Transaction = Prisma.TransactionClient

export async function invalidateArtworkSummary(tx: Transaction, artworkId: number) {
  await tx.artworkSummary.updateMany({ where: { artworkId }, data: { sourceRevision: { increment: 1 } } })
}

export function summarySourceKey(path: string, state: {
  size: bigint; mtimeMs: bigint; ctimeMs: bigint | null; deviceId: bigint | null; inode: bigint | null
}) {
  return JSON.stringify([path, state.size, state.mtimeMs, state.ctimeMs, state.deviceId, state.inode].map(String))
}

/** Scanners already stat files. Reuse their evidence without issuing extra NFS reads. */
export async function checkArtworkSummarySource(tx: Transaction, imageId: number, path: string,
  state?: { size: bigint; mtimeMs: bigint; ctimeMs: bigint | null; deviceId: bigint | null; inode: bigint | null }) {
  if (!state) return
  const row = await tx.artworkSummaryFeature.findUnique({ where: { imageId }, include: { image: { select: { artworkId: true } } } })
  if (!row || row.writeInProgress || row.sourceKey === summarySourceKey(path, state)) return
  await tx.artworkSummaryFeature.update({ where: { imageId }, data: { sourceKey: null, feature: Prisma.DbNull, generationId: null } })
  if (row.image.artworkId) await invalidateArtworkSummary(tx, row.image.artworkId)
}

export async function beginSummaryImageWrite(tx: Transaction, imageId: number, artworkId: number) {
  await tx.artworkSummary.upsert({ where: { artworkId }, create: { artworkId, sourceRevision: 1 },
    update: { sourceRevision: { increment: 1 } } })
  return tx.artworkSummaryFeature.upsert({ where: { imageId },
    create: { imageId, writeInProgress: true, sourceRevision: 1 },
    update: { writeInProgress: true, sourceRevision: { increment: 1 }, sourceKey: null, feature: Prisma.DbNull, generationId: null } })
}
