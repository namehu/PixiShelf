import { prisma } from '@/lib/prisma'

export const WEBP_TAG_NAME = 'webp'
const WEBP_TAG_SYNC_BATCH_SIZE = 1000

type WebpTagTx = {
  tag: {
    upsert(args: any): Promise<{ id: number }>
  }
  image: {
    findMany(args: any): Promise<Array<{ artworkId: number | null }>>
  }
  artworkTag: {
    createMany(args: any): Promise<unknown>
    deleteMany(args: any): Promise<unknown>
  }
}

async function getOrCreateWebpTagId(tx: WebpTagTx): Promise<number> {
  const tag = await tx.tag.upsert({
    where: { name: WEBP_TAG_NAME },
    update: {},
    create: { name: WEBP_TAG_NAME },
    select: { id: true }
  })

  return tag.id
}

export async function syncWebpTagForArtwork(tx: WebpTagTx, artworkId: number) {
  await syncWebpTagsForArtworks(tx, [artworkId])
}

export async function syncWebpTagsForArtworks(tx: WebpTagTx, artworkIds: number[]) {
  const uniqueArtworkIds = Array.from(new Set(artworkIds.filter((id) => Number.isFinite(id))))
  if (uniqueArtworkIds.length === 0) return

  const webpTagId = await getOrCreateWebpTagId(tx)
  const webpImages = await tx.image.findMany({
    where: {
      artworkId: { in: uniqueArtworkIds },
      path: { endsWith: '.webp', mode: 'insensitive' }
    },
    select: { artworkId: true },
    distinct: ['artworkId']
  })

  const webpArtworkIds = new Set(
    webpImages.map((image) => image.artworkId).filter((id): id is number => typeof id === 'number')
  )
  const idsWithWebp = uniqueArtworkIds.filter((id) => webpArtworkIds.has(id))
  const idsWithoutWebp = uniqueArtworkIds.filter((id) => !webpArtworkIds.has(id))

  if (idsWithWebp.length > 0) {
    await tx.artworkTag.createMany({
      data: idsWithWebp.map((artworkId) => ({
        artworkId,
        tagId: webpTagId
      })),
      skipDuplicates: true
    })
  }

  if (idsWithoutWebp.length > 0) {
    await tx.artworkTag.deleteMany({
      where: {
        tagId: webpTagId,
        artworkId: { in: idsWithoutWebp }
      }
    })
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

export interface SyncAllWebpTagsProgress {
  percentage: number
  message: string
}

export interface SyncAllWebpTagsResult {
  expectedWebpArtworks: number
  existingRelationsBeforeSync: number
  addedRelations: number
  removedStaleRelations: number
  finalWebpTagRelations: number
}

export async function syncAllWebpTags(options: {
  onProgress?: (progress: SyncAllWebpTagsProgress) => Promise<void> | void
} = {}): Promise<SyncAllWebpTagsResult> {
  const reportProgress = async (percentage: number, message: string) => {
    await options.onProgress?.({ percentage, message })
  }

  await reportProgress(5, '准备 WebP 标签...')

  const webpTag = await prisma.tag.upsert({
    where: { name: WEBP_TAG_NAME },
    update: {},
    create: { name: WEBP_TAG_NAME },
    select: { id: true }
  })

  await reportProgress(20, '统计 WebP 作品...')

  const webpImages = await prisma.image.findMany({
    where: {
      artworkId: { not: null },
      path: { endsWith: '.webp', mode: 'insensitive' }
    },
    select: { artworkId: true },
    distinct: ['artworkId']
  })

  const expectedArtworkIds = Array.from(
    new Set(webpImages.map((image) => image.artworkId).filter((id): id is number => typeof id === 'number'))
  )

  const currentRelations = await prisma.artworkTag.findMany({
    where: { tagId: webpTag.id },
    select: { artworkId: true }
  })

  const currentArtworkIds = new Set(currentRelations.map((relation) => relation.artworkId))
  const expectedArtworkIdSet = new Set(expectedArtworkIds)
  const idsToAdd = expectedArtworkIds.filter((id) => !currentArtworkIds.has(id))
  const idsToRemove = Array.from(currentArtworkIds).filter((id) => !expectedArtworkIdSet.has(id))

  let added = 0
  let removed = 0
  const addBatches = chunk(idsToAdd, WEBP_TAG_SYNC_BATCH_SIZE)
  const removeBatches = chunk(idsToRemove, WEBP_TAG_SYNC_BATCH_SIZE)
  const totalBatches = addBatches.length + removeBatches.length
  let completedBatches = 0

  const reportBatchProgress = async () => {
    const batchProgress = totalBatches === 0 ? 1 : completedBatches / totalBatches
    const percentage = Math.min(95, Math.round(30 + batchProgress * 65))
    await reportProgress(percentage, `已新增 ${added} 个关联，已移除 ${removed} 个过期关联`)
  }

  await reportProgress(30, `待新增 ${idsToAdd.length} 个关联，待移除 ${idsToRemove.length} 个过期关联`)

  for (const batch of addBatches) {
    const result = await prisma.artworkTag.createMany({
      data: batch.map((artworkId) => ({
        artworkId,
        tagId: webpTag.id
      })),
      skipDuplicates: true
    })
    added += result.count
    completedBatches++
    await reportBatchProgress()
  }

  for (const batch of removeBatches) {
    const result = await prisma.artworkTag.deleteMany({
      where: {
        tagId: webpTag.id,
        artworkId: { in: batch }
      }
    })
    removed += result.count
    completedBatches++
    await reportBatchProgress()
  }

  const actualCount = await prisma.artworkTag.count({
    where: { tagId: webpTag.id }
  })

  await reportProgress(100, 'WebP 标签同步完成')

  return {
    expectedWebpArtworks: expectedArtworkIds.length,
    existingRelationsBeforeSync: currentRelations.length,
    addedRelations: added,
    removedStaleRelations: removed,
    finalWebpTagRelations: actualCount
  }
}
