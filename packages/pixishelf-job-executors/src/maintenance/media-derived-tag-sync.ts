import { VIDEO_FILE_EXTENSIONS } from '@pixishelf/job-contracts'
import type { MaintenanceOperationInput, MaintenanceTransaction } from './types.js'
import { throwIfMaintenanceAborted } from './types.js'

export const MEDIA_DERIVED_TAG_SYNC_BATCH_SIZE = 500
export const MEDIA_DERIVED_TAG_IMAGE_BATCH_SIZE = 1_000

export const MEDIA_DERIVED_TAGS = {
  webp: { systemKey: 'media:webp', name: 'webp' },
  video: { systemKey: 'media:video', name: 'video' },
  image: { systemKey: 'media:image', name: 'image' }
} as const

type MediaDerivedTagKey = keyof typeof MEDIA_DERIVED_TAGS

export interface MediaDerivedTagSyncStats {
  expectedArtworks: number
  existingRelationsBeforeSync: number
  addedRelations: number
  removedStaleRelations: number
  finalRelations: number
}

export type MediaDerivedTagSyncResult = Record<MediaDerivedTagKey, MediaDerivedTagSyncStats>

export async function syncAllMediaDerivedTags(input: MaintenanceOperationInput): Promise<MediaDerivedTagSyncResult> {
  throwIfMaintenanceAborted(input.signal)
  const tagIds = await input.mutate((transaction) => getOrCreateMediaDerivedTags(transaction))
  const totalArtworks = await input.database.artwork.count()
  const existingCounts = await Promise.all(
    keys().map((key) => input.database.artworkTag.count({ where: { tagId: tagIds[key] } }))
  )
  const stats = Object.fromEntries(
    keys().map((key, index) => [
      key,
      {
        expectedArtworks: 0,
        existingRelationsBeforeSync: existingCounts[index] ?? 0,
        addedRelations: 0,
        removedStaleRelations: 0,
        finalRelations: 0
      }
    ])
  ) as MediaDerivedTagSyncResult
  let cursor = 0
  let processed = 0

  await input.progress({
    percentage: totalArtworks === 0 ? 100 : 5,
    stage: 'DISCOVERING',
    message: totalArtworks === 0 ? '没有需要同步媒体标签的作品' : `准备同步 ${totalArtworks} 个作品的媒体标签`,
    data: { total: totalArtworks }
  })

  while (true) {
    throwIfMaintenanceAborted(input.signal)
    const artworks = await input.database.artwork.findMany({
      where: { id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: MEDIA_DERIVED_TAG_SYNC_BATCH_SIZE,
      select: { id: true }
    })
    if (artworks.length === 0) break
    cursor = artworks.at(-1)!.id
    const artworkIds = artworks.map(({ id }) => id)
    const expected = await loadExpectedRelations(input, artworkIds)
    for (const key of keys()) stats[key].expectedArtworks += expected[key].length

    const changes = await input.mutate(async (transaction) => {
      const result = {} as Record<MediaDerivedTagKey, { added: number; removed: number }>
      for (const key of keys()) {
        const expectedIds = expected[key]
        const expectedSet = new Set(expectedIds)
        const staleIds = artworkIds.filter((id) => !expectedSet.has(id))
        const added =
          expectedIds.length === 0
            ? 0
            : (
                await transaction.artworkTag.createMany({
                  data: expectedIds.map((artworkId) => ({ artworkId, tagId: tagIds[key], provenance: 'DERIVED' })),
                  skipDuplicates: true
                })
              ).count
        const removed =
          staleIds.length === 0
            ? 0
            : (
                await transaction.artworkTag.deleteMany({
                  where: { tagId: tagIds[key], artworkId: { in: staleIds } }
                })
              ).count
        result[key] = { added, removed }
      }
      return result
    })
    for (const key of keys()) {
      stats[key].addedRelations += changes[key].added
      stats[key].removedStaleRelations += changes[key].removed
    }

    processed += artworks.length
    await input.progress({
      percentage: Math.min(99, 5 + Math.floor((processed / Math.max(1, totalArtworks)) * 94)),
      stage: 'SYNCING',
      message: `已同步 ${processed}/${totalArtworks} 个作品的媒体标签`,
      data: {
        total: totalArtworks,
        processed,
        added: keys().reduce((sum, key) => sum + stats[key].addedRelations, 0),
        removed: keys().reduce((sum, key) => sum + stats[key].removedStaleRelations, 0)
      }
    })
  }

  throwIfMaintenanceAborted(input.signal)
  const finalCounts = await Promise.all(
    keys().map((key) => input.database.artworkTag.count({ where: { tagId: tagIds[key] } }))
  )
  keys().forEach((key, index) => (stats[key].finalRelations = finalCounts[index] ?? 0))
  await input.progress({ percentage: 100, stage: 'COMPLETED', message: '媒体派生标签同步完成' })
  return stats
}

async function getOrCreateMediaDerivedTags(
  transaction: MaintenanceTransaction
): Promise<Record<MediaDerivedTagKey, number>> {
  const ids = {} as Record<MediaDerivedTagKey, number>
  for (const key of keys()) {
    const definition = MEDIA_DERIVED_TAGS[key]
    const existing = await transaction.tag.findFirst({
      where: { OR: [{ systemKey: definition.systemKey }, { namespace: 'general', name: definition.name }] },
      select: { id: true }
    })
    const tag = existing
      ? await transaction.tag.update({
          where: { id: existing.id },
          data: {
            name: definition.name,
            namespace: 'general',
            isSystem: true,
            systemKey: definition.systemKey
          },
          select: { id: true }
        })
      : await transaction.tag.create({
          data: {
            name: definition.name,
            namespace: 'general',
            isSystem: true,
            systemKey: definition.systemKey
          },
          select: { id: true }
        })
    ids[key] = tag.id
  }
  return ids
}

async function loadExpectedRelations(
  input: MaintenanceOperationInput,
  artworkIds: number[]
): Promise<Record<MediaDerivedTagKey, number[]>> {
  const webp = new Set<number>()
  const video = new Set<number>()
  let imageCursor = 0
  while (true) {
    throwIfMaintenanceAborted(input.signal)
    const images = await input.database.image.findMany({
      where: {
        artworkId: { in: artworkIds },
        id: { gt: imageCursor },
        OR: [
          { path: { endsWith: '.webp', mode: 'insensitive' } },
          ...VIDEO_FILE_EXTENSIONS.map((extension) => ({
            path: { endsWith: extension, mode: 'insensitive' as const }
          }))
        ]
      },
      orderBy: { id: 'asc' },
      take: MEDIA_DERIVED_TAG_IMAGE_BATCH_SIZE,
      select: { id: true, artworkId: true, path: true }
    })
    if (images.length === 0) break
    imageCursor = images.at(-1)!.id
    for (const image of images) {
      if (image.artworkId === null) continue
      const lower = image.path.toLowerCase()
      if (lower.endsWith('.webp')) webp.add(image.artworkId)
      if (VIDEO_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension))) video.add(image.artworkId)
    }
    if (images.length < MEDIA_DERIVED_TAG_IMAGE_BATCH_SIZE) break
  }
  return {
    webp: artworkIds.filter((id) => webp.has(id)),
    video: artworkIds.filter((id) => video.has(id)),
    image: artworkIds.filter((id) => !video.has(id))
  }
}

function keys(): MediaDerivedTagKey[] {
  return ['webp', 'video', 'image']
}
