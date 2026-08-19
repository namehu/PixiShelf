import { Prisma } from '@pixishelf/db'
import { ScanExecutorError } from './errors.ts'
import type { DiscoveredMediaFile } from './discovery.ts'
import type { ScanMetadata } from './metadata.ts'
import type { ScanTransaction } from './types.ts'

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

  // 已完成项是按 checkpoint 幂等重放的：命中过往 SUCCESS/SKIPPED 的结果时直接返回，避免在重试/重放场景重复写入 side effect。
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

  // existingPolicy=SKIP 代表“仅跟踪发现”，用于扫描作业希望不改历史数据的场景；一旦发现已有 ref，仅更新 lastSeenScanRunId。
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

  // Artwork 级 externalId/source/createdVia 只在新建时写入；刷新仅更新来源派生数据，不迁移本地身份和 ownership。
  const sourceArtworkData = {
    bookmarkCount: metadata.bookmarkCount,
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
    sanityLevel: metadata.sanityLevel
  }
  if (artworkId) {
    await transaction.artwork.update({ where: { id: artworkId }, data: sourceArtworkData })
    // override 必须在写语句的条件中当地检查，避免用户在来源查询后提交的编辑被过期快照覆盖。
    await transaction.artwork.updateMany({
      where: { id: artworkId, titleOverridden: false },
      data: { title: metadata.title }
    })
    await transaction.artwork.updateMany({
      where: { id: artworkId, descriptionOverridden: false },
      data: {
        description: metadata.description,
        descriptionLength: metadata.description?.length ?? 0
      }
    })
  } else {
    const artist = await transaction.artist.upsert({
      where: { unique_username_userid: { username: metadata.user, userId: metadata.userId } },
      create: { name: metadata.user, username: metadata.user, userId: metadata.userId },
      update: { name: metadata.user },
      select: { id: true }
    })
    const artwork = await transaction.artwork.create({
      data: {
        ...sourceArtworkData,
        externalId: metadata.id,
        title: metadata.title,
        description: metadata.description,
        descriptionLength: metadata.description?.length ?? 0,
        artistId: artist.id,
        source: 'PIXIV_IMPORTED',
        createdVia: 'PIXIV_SCAN'
      },
      select: { id: true }
    })
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
  const incomingIdentities = new Set<string>()
  for (const item of input.media) {
    const identity = normalizeMediaIdentity(item.relativePath)
    if (incomingIdentities.has(identity)) {
      throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Pixiv media paths collide after safe normalization')
    }
    incomingIdentities.add(identity)
  }
  const existingImages = await transaction.image.findMany({
    where: { artworkId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, path: true, sortOrder: true }
  })
  const existingByIdentity = new Map<string, (typeof existingImages)[number]>()
  for (const image of existingImages) {
    const identity = normalizeMediaIdentity(image.path)
    if (existingByIdentity.has(identity)) {
      throw new ScanExecutorError('STATE_CONFLICT', 'Artwork database contains normalized Pixiv media path conflicts')
    }
    existingByIdentity.set(identity, image)
  }
  let newImageCount = 0

  // 新增图片要接在当前最大 sortOrder 之后；复用路径则只更新元数据，不触发删除、重排或插队，保证本地手工追加/本地文件更新不会被扫描改乱顺序。
  let nextSortOrder = existingImages.reduce((maximum, image) => Math.max(maximum, image.sortOrder), -1) + 1
  for (const item of input.media) {
    const sourceMediaData = {
      size: item.size,
      mediaType: item.mediaType,
      webpAnimationStatus: item.webpAnimationStatus,
      chaptersPath: item.chaptersPath,
      chaptersCount: item.chaptersCount,
      chaptersDuration: item.chaptersDuration,
      chaptersUpdatedAt: item.chaptersPath ? input.now : null,
      chaptersHash: item.chaptersHash
    }
    const existing = existingByIdentity.get(normalizeMediaIdentity(item.relativePath))
    if (existing) {
      await transaction.image.update({ where: { id: existing.id }, data: sourceMediaData })
    } else {
      await transaction.image.create({
        data: {
          artworkId,
          path: item.relativePath,
          sortOrder: nextSortOrder,
          ...sourceMediaData
        }
      })
      nextSortOrder += 1
      newImageCount += 1
    }
  }
  await writeItem(input, {
    artworkId,
    status: 'SUCCESS',
    action: sourceRef ? 'UPDATE' : 'CREATE',
    newImageCount
  })
  return {
    status: 'SUCCESS' as const,
    newImages: newImageCount,
    artworkId
  }
}

function normalizeMediaIdentity(value: string) {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '').normalize('NFC').toLocaleLowerCase('und')
}

async function replaceSourceTags(
  transaction: ScanTransaction,
  artworkId: number,
  sourceRefId: string,
  names: string[]
) {
  const tagIds: number[] = []
  for (const name of new Set(names)) {
    const tag = await transaction.tag.upsert({
      where: { namespace_name: { namespace: 'general', name } },
      create: { namespace: 'general', name },
      update: {},
      select: { id: true }
    })
    tagIds.push(tag.id)
  }

  // ArtworkTag 使用 (artworkId, tagId) 唯一约束，且一条关系有 provenance/sourceRefId 两个维度。
  // 刷新时仅清理当前 provider/sourceRef 标记的 SOURCE 标签，避免误删 MANUAL/DERIVED/LEGACY（以及其他来源）归属。
  await transaction.artworkTag.deleteMany({
    where: {
      artworkId,
      provenance: 'SOURCE',
      sourceRefId,
      ...(tagIds.length > 0 ? { tagId: { notIn: tagIds } } : {})
    }
  })
  for (const tagId of tagIds) {
    await transaction.artworkTag.upsert({
      where: { artworkId_tagId: { artworkId, tagId } },
      create: { artworkId, tagId, provenance: 'SOURCE', sourceRefId },
      update: {}
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
