import { Prisma } from '@pixishelf/db'
import { ScanExecutorError } from './errors.js'
import type { DiscoveredMediaFile } from './discovery.js'
import type { ScanMetadata } from './metadata.js'
import type { ScanTransaction } from './types.js'

export type ExistingArtworkPolicy = 'SKIP' | 'REFRESH'

export interface PixivPublishInput {
  transaction: ScanTransaction
  runId: string
  checkpointOrdinal: number
  checkpointKey: string
  metadataRelativePath: string
  metadata: ScanMetadata
  media: readonly DiscoveredMediaFile[]
  existingPolicy: ExistingArtworkPolicy
  now: Date
}

export async function publishPixivArtwork(input: PixivPublishInput) {
  const { transaction, metadata } = input
  const existingItem = await transaction.scanRunItem.findUnique({
    where: { scanRunId_checkpointKey: { scanRunId: input.runId, checkpointKey: input.checkpointKey } }
  })
  if (existingItem?.status === 'SUCCESS' || existingItem?.status === 'SKIPPED') {
    return {
      status: existingItem.status,
      newImages: existingItem.newImageCount,
      artworkId: null as number | null
    }
  }

  const sourceRef = await transaction.artworkExternalRef.findUnique({
    where: { providerKey_externalId: { providerKey: 'pixiv', externalId: metadata.id } },
    include: { artwork: { select: { id: true } } }
  })
  if (sourceRef && input.existingPolicy === 'SKIP') {
    await transaction.artworkExternalRef.update({
      where: { id: sourceRef.id },
      data: { lastSeenScanRunId: input.runId }
    })
    await writeItem(input, {
      artworkId: sourceRef.artwork.id,
      status: 'SKIPPED',
      action: 'SKIP_EXISTING',
      newImageCount: 0
    })
    return { status: 'SKIPPED' as const, newImages: 0, artworkId: sourceRef.artwork.id }
  }

  let artworkId = sourceRef?.artwork.id ?? null
  if (!artworkId) {
    const legacy = await transaction.artwork.findUnique({ where: { externalId: metadata.id }, select: { id: true } })
    if (legacy) {
      throw new ScanExecutorError(
        'STATE_CONFLICT',
        'A legacy artwork has the same external id but no verified pixiv provider reference'
      )
    }
  }

  const artist = await transaction.artist.upsert({
    where: { unique_username_userid: { username: metadata.user, userId: metadata.userId } },
    create: { name: metadata.user, username: metadata.user, userId: metadata.userId },
    update: { name: metadata.user },
    select: { id: true }
  })
  const artworkData = {
    title: metadata.title,
    description: metadata.description,
    descriptionLength: metadata.description?.length ?? 0,
    artistId: artist.id,
    bookmarkCount: metadata.bookmarkCount,
    externalId: metadata.id,
    isAiGenerated: metadata.isAiGenerated,
    originalUrl: metadata.original,
    size: metadata.size,
    sourceDate: metadata.sourceDate,
    sourceUrl: metadata.url,
    thumbnailUrl: metadata.thumbnail,
    xRestrict: metadata.xRestrict,
    metaSource: input.metadataRelativePath,
    metadataFormat: metadata.metadataFormat,
    pixivAiType: metadata.pixivAiType,
    pixivType: metadata.pixivType,
    sanityLevel: metadata.sanityLevel,
    source: 'PIXIV_IMPORTED' as const,
    createdVia: 'PIXIV_SCAN' as const
  }
  if (artworkId) {
    await transaction.artwork.update({ where: { id: artworkId }, data: artworkData })
  } else {
    const artwork = await transaction.artwork.create({ data: artworkData, select: { id: true } })
    artworkId = artwork.id
  }

  const ref = await transaction.artworkExternalRef.upsert({
    where: { providerKey_externalId: { providerKey: 'pixiv', externalId: metadata.id } },
    create: {
      artworkId,
      providerKey: 'pixiv',
      externalId: metadata.id,
      canonicalUrl: metadata.url ?? `https://www.pixiv.net/artworks/${metadata.id}`,
      locator: { artworkId: metadata.id },
      lastSeenScanRunId: input.runId,
      fetchedAt: input.now
    },
    update: {
      canonicalUrl: metadata.url ?? `https://www.pixiv.net/artworks/${metadata.id}`,
      locator: { artworkId: metadata.id },
      lastSeenScanRunId: input.runId,
      fetchedAt: input.now
    }
  })
  if (metadata.rawMetadataJson !== null) {
    const raw = toInputJson(metadata.rawMetadataJson)
    await transaction.artworkRawMetadata.upsert({
      where: { artworkId },
      create: { artworkId, rawMetadataJson: raw },
      update: { rawMetadataJson: raw }
    })
  }
  await replaceSourceTags(transaction, artworkId, ref.id, metadata.tags)
  const existingPaths = await transaction.image.findMany({
    where: { artworkId, path: { in: input.media.map((item) => item.relativePath) } },
    select: { path: true }
  })
  const existingPathSet = new Set(existingPaths.map((item) => item.path))
  for (const item of input.media) {
    await transaction.image.upsert({
      where: { unique_artwork_path: { artworkId, path: item.relativePath } },
      create: {
        artworkId,
        path: item.relativePath,
        size: item.size,
        sortOrder: item.sortOrder,
        mediaType: item.mediaType,
        webpAnimationStatus: item.webpAnimationStatus
      },
      update: {
        size: item.size,
        sortOrder: item.sortOrder,
        mediaType: item.mediaType,
        webpAnimationStatus: item.webpAnimationStatus
      }
    })
  }
  await writeItem(input, {
    artworkId,
    status: 'SUCCESS',
    action: sourceRef ? 'UPDATE' : 'CREATE',
    newImageCount: input.media.filter((item) => !existingPathSet.has(item.relativePath)).length
  })
  return {
    status: 'SUCCESS' as const,
    newImages: input.media.filter((item) => !existingPathSet.has(item.relativePath)).length,
    artworkId
  }
}

async function replaceSourceTags(
  transaction: ScanTransaction,
  artworkId: number,
  sourceRefId: string,
  names: string[]
) {
  await transaction.artworkTag.deleteMany({ where: { artworkId, provenance: 'SOURCE', sourceRefId } })
  for (const name of names) {
    const tag = await transaction.tag.upsert({
      where: { namespace_name: { namespace: 'general', name } },
      create: { namespace: 'general', name },
      update: {},
      select: { id: true }
    })
    await transaction.artworkTag.create({
      data: { artworkId, tagId: tag.id, provenance: 'SOURCE', sourceRefId }
    })
  }
}

async function writeItem(
  input: PixivPublishInput,
  result: {
    artworkId: number
    status: 'SUCCESS' | 'SKIPPED'
    action: 'CREATE' | 'UPDATE' | 'SKIP_EXISTING'
    newImageCount: number
  }
) {
  await input.transaction.scanRunItem.upsert({
    where: { scanRunId_checkpointKey: { scanRunId: input.runId, checkpointKey: input.checkpointKey } },
    create: {
      scanRunId: input.runId,
      checkpointKey: input.checkpointKey,
      externalId: input.metadata.id,
      title: input.metadata.title,
      artistName: input.metadata.user,
      metadataRelativePath: input.metadataRelativePath,
      status: result.status,
      action: result.action,
      attempt: 1,
      mediaCount: input.media.length,
      newImageCount: result.newImageCount,
      finishedAt: input.now
    },
    update: {
      externalId: input.metadata.id,
      title: input.metadata.title,
      artistName: input.metadata.user,
      metadataRelativePath: input.metadataRelativePath,
      status: result.status,
      action: result.action,
      attempt: { increment: 1 },
      mediaCount: input.media.length,
      newImageCount: result.newImageCount,
      errorMessage: null,
      finishedAt: input.now
    }
  })
  await input.transaction.scanRun.updateMany({
    where: { id: input.runId, checkpointOrdinal: { lt: input.checkpointOrdinal + 1 } },
    data: { checkpointStage: 'PROCESSING', checkpointOrdinal: input.checkpointOrdinal + 1 }
  })
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}
