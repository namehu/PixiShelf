import { prisma } from '@/lib/prisma'
import { isVideoFile, isWebpFile } from '@/lib/media'
import { VIDEO_FILE_EXTENSIONS } from '@pixishelf/job-contracts'

export const MEDIA_DERIVED_TAGS = {
  webp: { systemKey: 'media:webp', name: 'webp' },
  video: { systemKey: 'media:video', name: 'video' },
  image: { systemKey: 'media:image', name: 'image' }
} as const

const MEDIA_TAG_SYNC_BATCH_SIZE = 1000
const MEDIA_TAG_ARTWORK_PAGE_SIZE = 500
export const MEDIA_TAG_IMAGE_PAGE_SIZE = 1000
const MEDIA_TAG_IMAGE_PATH_FILTERS = [
  { path: { endsWith: '.webp', mode: 'insensitive' as const } },
  ...VIDEO_FILE_EXTENSIONS.map((extension) => ({
    path: { endsWith: extension, mode: 'insensitive' as const }
  }))
]

type MediaDerivedTagKey = keyof typeof MEDIA_DERIVED_TAGS

type MediaDerivedTagTx = {
  tag: {
    findFirst(args: any): Promise<{ id: number } | null>
    create(args: any): Promise<{ id: number }>
    update(args: any): Promise<{ id: number }>
  }
  image: {
    findMany(args: any): Promise<Array<{ id: number; artworkId: number | null; path: string }>>
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
        OR: [{ systemKey: tagDef.systemKey }, { namespace: 'general', name: tagDef.name }]
      },
      select: { id: true }
    })

    if (existing) {
      const tag = await tx.tag.update({
        where: { id: existing.id },
        data: {
          name: tagDef.name,
          namespace: 'general',
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
        namespace: 'general',
        isSystem: true,
        systemKey: tagDef.systemKey
      },
      select: { id: true }
    })
    tagIds[key] = tag.id
  }

  return tagIds
}

function buildExpectedTagArtworkIds(
  artworkIds: number[],
  idsWithVideo: ReadonlySet<number>,
  idsWithWebp: ReadonlySet<number>
) {
  return {
    webp: artworkIds.filter((id) => idsWithWebp.has(id)),
    video: artworkIds.filter((id) => idsWithVideo.has(id)),
    image: artworkIds.filter((id) => !idsWithVideo.has(id))
  } satisfies Record<MediaDerivedTagKey, number[]>
}

async function loadExpectedTagArtworkIds(tx: MediaDerivedTagTx, artworkIds: number[]) {
  const idsWithVideo = new Set<number>()
  const idsWithWebp = new Set<number>()
  let cursor = 0

  while (true) {
    const page = await tx.image.findMany({
      where: {
        artworkId: { in: artworkIds },
        id: { gt: cursor },
        OR: MEDIA_TAG_IMAGE_PATH_FILTERS
      },
      orderBy: { id: 'asc' },
      take: MEDIA_TAG_IMAGE_PAGE_SIZE,
      select: { id: true, artworkId: true, path: true }
    })
    if (page.length === 0) break
    cursor = page.at(-1)!.id
    for (const image of page) {
      if (typeof image.artworkId !== 'number') continue
      if (isVideoFile(image.path)) idsWithVideo.add(image.artworkId)
      if (isWebpFile(image.path)) idsWithWebp.add(image.artworkId)
    }
    if (page.length < MEDIA_TAG_IMAGE_PAGE_SIZE) break
  }

  return buildExpectedTagArtworkIds(artworkIds, idsWithVideo, idsWithWebp)
}

export async function syncMediaDerivedTagForArtwork(tx: MediaDerivedTagTx, artworkId: number) {
  await syncMediaDerivedTagsForArtworks(tx, [artworkId])
}

export async function syncMediaDerivedTagsForArtworks(tx: MediaDerivedTagTx, artworkIds: number[]) {
  const uniqueArtworkIds = Array.from(new Set(artworkIds.filter((id) => Number.isFinite(id))))
  if (uniqueArtworkIds.length === 0) return

  const tagIds = await getOrCreateMediaDerivedTags(tx)
  const expected = await loadExpectedTagArtworkIds(tx, uniqueArtworkIds)

  const createData = (Object.keys(expected) as MediaDerivedTagKey[]).flatMap((key) =>
    expected[key].map((artworkId) => ({
      artworkId,
      tagId: tagIds[key],
      provenance: 'DERIVED'
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
): Promise<{ expected: number; existing: number; added: number; removed: number }> {
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
      data: batch.map((artworkId) => ({ artworkId, tagId, provenance: 'DERIVED' })),
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

  return {
    expected: expectedArtworkIds.length,
    existing: currentArtworkIds.size,
    added,
    removed
  }
}

export async function syncAllMediaDerivedTags(
  options: {
    onProgress?: (progress: SyncAllMediaDerivedTagsProgress) => Promise<void> | void
    checkCancelled?: () => Promise<boolean> | boolean
  } = {}
): Promise<SyncAllMediaDerivedTagsResult> {
  const reportProgress = async (percentage: number, message: string) => {
    await options.onProgress?.({ percentage, message })
  }

  await reportProgress(5, '准备媒体系统标签...')
  const tagIds = await getOrCreateMediaDerivedTags(prisma as unknown as MediaDerivedTagTx)

  await reportProgress(15, '统计作品和媒体文件...')
  const totalArtworks = await prisma.artwork.count()
  const existingCounts = await Promise.all(
    (Object.keys(tagIds) as MediaDerivedTagKey[]).map((key) =>
      prisma.artworkTag.count({ where: { tagId: tagIds[key] } })
    )
  )
  const result = Object.fromEntries(
    (Object.keys(tagIds) as MediaDerivedTagKey[]).map((key, index) => [
      key,
      {
        expectedArtworks: 0,
        existingRelationsBeforeSync: existingCounts[index] ?? 0,
        addedRelations: 0,
        removedStaleRelations: 0,
        finalRelations: 0
      }
    ])
  ) as SyncAllMediaDerivedTagsResult
  let lastSeenId = 0
  let processed = 0

  while (true) {
    if (await options.checkCancelled?.()) throw new Error('Task cancelled')
    const artworks = await prisma.artwork.findMany({
      where: { id: { gt: lastSeenId } },
      orderBy: { id: 'asc' },
      take: MEDIA_TAG_ARTWORK_PAGE_SIZE,
      select: { id: true }
    })
    if (artworks.length === 0) break
    lastSeenId = artworks.at(-1)!.id
    const artworkIds = artworks.map(({ id }) => id)
    const [expected, currentRelations] = await Promise.all([
      loadExpectedTagArtworkIds(prisma as unknown as MediaDerivedTagTx, artworkIds),
      prisma.artworkTag.findMany({
        where: { tagId: { in: Object.values(tagIds) }, artworkId: { in: artworkIds } },
        select: { artworkId: true, tagId: true }
      })
    ])
    for (const key of Object.keys(expected) as MediaDerivedTagKey[]) {
      const changes = await syncTagRelations(tagIds[key], expected[key], { currentRelations })
      result[key].expectedArtworks += changes.expected
      result[key].addedRelations += changes.added
      result[key].removedStaleRelations += changes.removed
    }
    processed += artworks.length
    const totalAdded = Object.values(result).reduce((sum, item) => sum + item.addedRelations, 0)
    const totalRemoved = Object.values(result).reduce((sum, item) => sum + item.removedStaleRelations, 0)
    await reportProgress(
      Math.min(95, 15 + Math.floor((processed / Math.max(1, totalArtworks)) * 80)),
      `已同步 ${processed}/${totalArtworks} 个作品，新增 ${totalAdded} 个关联，移除 ${totalRemoved} 个`
    )
  }

  const finalCounts = await Promise.all(
    (Object.keys(tagIds) as MediaDerivedTagKey[]).map((key) =>
      prisma.artworkTag.count({ where: { tagId: tagIds[key] } })
    )
  )
  ;(Object.keys(tagIds) as MediaDerivedTagKey[]).forEach((key, index) => {
    result[key].finalRelations = finalCounts[index] ?? 0
  })

  await reportProgress(100, '媒体标签同步完成')
  return result
}
