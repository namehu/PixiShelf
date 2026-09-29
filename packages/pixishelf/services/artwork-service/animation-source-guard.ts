import {
  Prisma,
  beginAnimationDurationSourceWrite,
  finishAnimationDurationSourceWrite
} from '@pixishelf/db'
import { prisma } from '@/lib/prisma'

type WriteToken = { imageId: number; sourceRevision: number }

function storedPathVariants(storedPath: string) {
  const normalized = storedPath.replace(/\\/g, '/').replace(/^\/+/, '')
  return [normalized, `/${normalized}`]
}

/** Register a path write before unlink/truncate; the returned revisions fence its completion. */
export async function beginAnimationSourcePathWrite(storedPath: string): Promise<WriteToken[]> {
  if (!/\.webp$/i.test(storedPath)) return []
  return prisma.$transaction(async (tx) => {
    const images = await tx.image.findMany({
      where: { path: { in: storedPathVariants(storedPath) } },
      select: { id: true, path: true }
    })
    const tokens: WriteToken[] = []
    for (const image of images) {
      const sourceRevision = await beginAnimationDurationSourceWrite(tx as unknown as Prisma.TransactionClient, {
        imageId: image.id,
        sourcePath: image.path
      })
      if (sourceRevision !== false) tokens.push({ imageId: image.id, sourceRevision })
    }
    return tokens
  })
}

export async function finishAnimationSourcePathWrite(tokens: readonly WriteToken[]) {
  if (tokens.length === 0) return
  await prisma.$transaction(async (tx) => {
    for (const token of tokens) {
      await finishAnimationDurationSourceWrite(tx as unknown as Prisma.TransactionClient, {
        imageId: token.imageId,
        expectedRevision: token.sourceRevision
      })
    }
  })
}

/** The replace session keeps old Image IDs alive until commit, so gate all of them before backup. */
export async function beginAnimationReplaceSessionWrite(artworkId: number) {
  await prisma.$transaction(async (tx) => {
    const images = await tx.image.findMany({
      where: { artworkId, path: { endsWith: '.webp', mode: 'insensitive' } },
      select: { id: true, path: true }
    })
    for (const image of images) {
      await beginAnimationDurationSourceWrite(tx as unknown as Prisma.TransactionClient, { imageId: image.id, sourcePath: image.path })
    }
  })
}

/** Capture the rollback's revisions before touching files; completion compares those exact revisions. */
export async function captureAnimationReplaceRollbackWriteTokens(artworkId: number): Promise<WriteToken[]> {
  const images = await prisma.image.findMany({
    where: { artworkId, path: { endsWith: '.webp', mode: 'insensitive' } },
    select: { id: true, animationMetadata: { select: { sourceRevision: true, writeInProgress: true } } }
  })
  return images.flatMap((image) =>
    image.animationMetadata?.writeInProgress
      ? [{ imageId: image.id, sourceRevision: image.animationMetadata.sourceRevision }]
      : []
  )
}
