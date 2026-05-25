import { prisma } from '@/lib/prisma'
import { VIDEO_EXTENSIONS } from '@/lib/constant'
import { isVideoFile, isWebpFile } from '@/lib/media'

export const MEDIA_DERIVED_TAGS = {
  webp: { systemKey: 'media:webp', name: 'webp' },
  video: { systemKey: 'media:video', name: 'video' },
  image: { systemKey: 'media:image', name: 'image' }
} as const

const MEDIA_TAG_SYNC_BATCH_SIZE = 1000

type MediaDerivedTagKey = keyof typeof MEDIA_DERIVED_TAGS

type MediaDerivedTagTx = {
  tag: {
    findFirst(args: any): Promise<{ id: number } | null>
    create(args: any): Promise<{ id: number }>
    update(args: any): Promise<{ id: number }>
  }
  image: {
    findMany(args: any): Promise<Array<{ artworkId: number | null; path?: string }>>
  }
  artworkTag: {
    createMany(args: any): Promise<{ count: number } | unknown>
    deleteMany(args: any): Promise<{ count: number } | unknown>
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

async function getOrCreateMediaDerivedTags(tx: MediaDerivedTagTx): Promise<Record<MediaDerivedTagKey, number>> {
  const tagIds = {} as Record<MediaDerivedTagKey, number>

  for (const key of Object.keys(MEDIA_DERIVED_TAGS) as MediaDerivedTagKey[]) {
    const tagDef = MEDIA_DERIVED_TAGS[key]
    const existing = await tx.tag.findFirst({
      where: {
        OR: [{ systemKey: tagDef.systemKey }, { name: tagDef.name }]
      },
      select: { id: true }
    })

    if (existing) {
      const tag = await tx.tag.update({
        where: { id: existing.id },
        data: {
          name: tagDef.name,
          isSystem: true,
          systemKey: tagDef.systemKey
        },
        select: { id: true }
      })
      tagIds[key] = tag.id
      continue
    }

    const tag = await tx.tag.create({
      data: {
        name: tagDef.name,
        isSystem: true,
        systemKey: tagDef.systemKey
      },
      select: { id: true }
    })
    tagIds[key] = tag.id
  }

  return tagIds
}

function buildExpectedTagArtworkIds(artworkIds: number[], images: Array<{ artworkId: number | null; path?: string }>) {
  const idsWithVideo = new Set<number>()
  const idsWithWebp = new Set<number>()

  for (const image of images) {
    if (typeof image.artworkId !== 'number' || !image.path) continue

    if (isVideoFile(image.path)) {
      idsWithVideo.add(image.artworkId)
    }

    if (isWebpFile(image.path)) {
      idsWithWebp.add(image.artworkId)
    }
  }

  return {
    webp: artworkIds.filter((id) => idsWithWebp.has(id)),
    video: artworkIds.filter((id) => idsWithVideo.has(id)),
    image: artworkIds.filter((id) => !idsWithVideo.has(id))
  } satisfies Record<MediaDerivedTagKey, number[]>
}

export async function syncMediaDerivedTagForArtwork(tx: MediaDerivedTagTx, artworkId: number) {
  await syncMediaDerivedTagsForArtworks(tx, [artworkId])
}

export async function syncMediaDerivedTagsForArtworks(tx: MediaDerivedTagTx, artworkIds: number[]) {
  const uniqueArtworkIds = Array.from(new Set(artworkIds.filter((id) => Number.isFinite(id))))
  if (uniqueArtworkIds.length === 0) return

  const tagIds = await getOrCreateMediaDerivedTags(tx)
  const images = await tx.image.findMany({
    where: { artworkId: { in: uniqueArtworkIds } },
    select: { artworkId: true, path: true }
  })
  const expected = buildExpectedTagArtworkIds(uniqueArtworkIds, images)

  const createData = (Object.keys(expected) as MediaDerivedTagKey[]).flatMap((key) =>
    expected[key].map((artworkId) => ({
      artworkId,
      tagId: tagIds[key]
    }))
  )

  if (createData.length > 0) {
    await tx.artworkTag.createMany({
      data: createData,
      skipDuplicates: true
    })
  }

  for (const key of Object.keys(expected) as MediaDerivedTagKey[]) {
    const expectedSet = new Set(expected[key])
    const staleArtworkIds = uniqueArtworkIds.filter((id) => !expectedSet.has(id))
    if (staleArtworkIds.length === 0) continue

    await tx.artworkTag.deleteMany({
      where: {
        tagId: tagIds[key],
        artworkId: { in: staleArtworkIds }
      }
    })
  }
}

export interface SyncAllMediaDerivedTagsProgress {
  percentage: number
  message: string
}

export interface MediaDerivedTagSyncStats {
  expectedArtworks: number
  existingRelationsBeforeSync: number
  addedRelations: number
  removedStaleRelations: number
  finalRelations: number
}

export type SyncAllMediaDerivedTagsResult = Record<MediaDerivedTagKey, MediaDerivedTagSyncStats>

async function syncTagRelations(
  tagId: number,
  expectedArtworkIds: number[],
  options: {
    currentRelations: Array<{ artworkId: number; tagId: number }>
    onBatch?: (added: number, removed: number) => Promise<void>
  }
): Promise<MediaDerivedTagSyncStats> {
  const currentArtworkIds = new Set(
    options.currentRelations.filter((relation) => relation.tagId === tagId).map((relation) => relation.artworkId)
  )
  const expectedArtworkIdSet = new Set(expectedArtworkIds)
  const idsToAdd = expectedArtworkIds.filter((id) => !currentArtworkIds.has(id))
  const idsToRemove = Array.from(currentArtworkIds).filter((id) => !expectedArtworkIdSet.has(id))

  let added = 0
  let removed = 0

  for (const batch of chunk(idsToAdd, MEDIA_TAG_SYNC_BATCH_SIZE)) {
    const result = await prisma.artworkTag.createMany({
      data: batch.map((artworkId) => ({ artworkId, tagId })),
      skipDuplicates: true
    })
    added += result.count
    await options.onBatch?.(added, removed)
  }

  for (const batch of chunk(idsToRemove, MEDIA_TAG_SYNC_BATCH_SIZE)) {
    const result = await prisma.artworkTag.deleteMany({
      where: {
        tagId,
        artworkId: { in: batch }
      }
    })
    removed += result.count
    await options.onBatch?.(added, removed)
  }

  const finalRelations = await prisma.artworkTag.count({ where: { tagId } })

  return {
    expectedArtworks: expectedArtworkIds.length,
    existingRelationsBeforeSync: currentArtworkIds.size,
    addedRelations: added,
    removedStaleRelations: removed,
    finalRelations
  }
}

export async function syncAllMediaDerivedTags(options: {
  onProgress?: (progress: SyncAllMediaDerivedTagsProgress) => Promise<void> | void
} = {}): Promise<SyncAllMediaDerivedTagsResult> {
  const reportProgress = async (percentage: number, message: string) => {
    await options.onProgress?.({ percentage, message })
  }

  await reportProgress(5, '准备媒体系统标签...')
  const tagIds = await getOrCreateMediaDerivedTags(prisma as unknown as MediaDerivedTagTx)

  await reportProgress(15, '统计作品和媒体文件...')
  const [artworks, webpImages, videoImages, currentRelations] = await Promise.all([
    prisma.artwork.findMany({ select: { id: true } }),
    prisma.image.findMany({
      where: {
        artworkId: { not: null },
        path: { endsWith: '.webp', mode: 'insensitive' }
      },
      select: { artworkId: true },
      distinct: ['artworkId']
    }),
    prisma.image.findMany({
      where: {
        artworkId: { not: null },
        OR: VIDEO_EXTENSIONS.map((ext) => ({ path: { endsWith: ext, mode: 'insensitive' as const } }))
      },
      select: { artworkId: true },
      distinct: ['artworkId']
    }),
    prisma.artworkTag.findMany({
      where: { tagId: { in: Object.values(tagIds) } },
      select: { artworkId: true, tagId: true }
    })
  ])

  const allArtworkIds = artworks.map((artwork) => artwork.id)
  const webpArtworkIds = Array.from(
    new Set(webpImages.map((image) => image.artworkId).filter((id): id is number => typeof id === 'number'))
  )
  const videoArtworkIdSet = new Set(
    videoImages.map((image) => image.artworkId).filter((id): id is number => typeof id === 'number')
  )
  const videoArtworkIds = allArtworkIds.filter((id) => videoArtworkIdSet.has(id))
  const imageArtworkIds = allArtworkIds.filter((id) => !videoArtworkIdSet.has(id))

  const expected = {
    webp: webpArtworkIds,
    video: videoArtworkIds,
    image: imageArtworkIds
  } satisfies Record<MediaDerivedTagKey, number[]>

  let completedTags = 0
  let totalAdded = 0
  let totalRemoved = 0
  const result = {} as SyncAllMediaDerivedTagsResult

  for (const key of Object.keys(expected) as MediaDerivedTagKey[]) {
    await reportProgress(20 + completedTags * 25, `同步 ${MEDIA_DERIVED_TAGS[key].name} 标签...`)
    const beforeAdded = totalAdded
    const beforeRemoved = totalRemoved
    result[key] = await syncTagRelations(tagIds[key], expected[key], {
      currentRelations,
      onBatch: async (added, removed) => {
        totalAdded = beforeAdded + added
        totalRemoved = beforeRemoved + removed
        await reportProgress(
          Math.min(95, 20 + completedTags * 25),
          `已新增 ${totalAdded} 个关联，已移除 ${totalRemoved} 个过期关联`
        )
      }
    })
    totalAdded += result[key].addedRelations - (totalAdded - beforeAdded)
    totalRemoved += result[key].removedStaleRelations - (totalRemoved - beforeRemoved)
    completedTags++
  }

  await reportProgress(100, '媒体标签同步完成')
  return result
}
