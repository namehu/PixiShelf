import { ArtistResponseDto } from '@/schemas/artist.dto'
import 'server-only'

import path from 'path'
import { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { TImageModel } from '@/schemas/models'
import { isVideoFile } from '@/lib/media'
import { normalizeImageSizeField } from '@/utils/image-size'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import { buildVideoPosterUrl } from '@/lib/media-cover'
import { EMediaAnimationStatus } from '@/enums/e-media-animation-status'
import { ANIMATION_DURATION_TIMING_POLICY_VERSION } from '@pixishelf/db'
import type { AnimationMetadataDto } from '@/schemas/artwork.dto'
import { groupLogicalMedia } from './logical-media'

dayjs.extend(utc)

/**
 * 转换单个作品数据为 DTO 格式
 */
export function transformSingleArtwork(artwork: any) {
  const _count = artwork._count?.images || artwork.imageCount || 0
  const { images, totalMediaSize, imageCount, hasVideo, mediaCount } = transformImages(artwork.images, _count)

  // 构建响应对象
  const pixivRefs = (artwork.externalRefs ?? []).filter(
    (source: { providerKey?: string }) => source.providerKey === 'pixiv'
  )
  const pixiv = pixivRefs.length === 1 && /^[1-9][0-9]*$/.test(pixivRefs[0]?.externalId ?? '') ? pixivRefs[0] : null
  const creators = (artwork.creators ?? [])
    .map((row: any) => ArtistResponseDto.parse(row.artist))
    .sort(
      (a: any, b: any) =>
        Number(a.kind === 'GROUP') - Number(b.kind === 'GROUP') || a.name.localeCompare(b.name) || a.id - b.id
    )
  const result = {
    ...artwork,
    creators,
    sourceDate: artwork.sourceDate ? dayjs(artwork.sourceDate).utc().format('YYYY-MM-DD HH:mm:ss') : null,
    images: images,
    tags:
      artwork.artworkTags?.map((at: any) => ({
        id: at.tag.id,
        name: at.tag.name,
        name_zh: at.tag.name_zh
      })) || [],
    imageCount,
    mediaCount,
    isVideo: hasVideo,
    totalMediaSize,
    pixivEligible: pixiv !== null,
    pixivArtworkId: pixiv?.externalId ?? null,
    pixivSync: pixiv
      ? {
          status: pixiv.status ?? null,
          lastAttemptAt: pixiv.lastAttemptAt?.toISOString?.() ?? pixiv.lastAttemptAt ?? null,
          lastSuccessAt: pixiv.lastSuccessAt?.toISOString?.() ?? pixiv.lastSuccessAt ?? null,
          lastErrorCode: pixiv.lastErrorCode ?? null,
          lastError: pixiv.lastError ?? null,
          lastSystemJobId: pixiv.lastSystemJobId ?? null,
          onlineSnapshotHash: pixiv.onlineSnapshotHash ?? null,
          onlineSnapshotPath: pixiv.onlineSnapshotPath ?? null
        }
      : null,
    descriptionLength: artwork.descriptionLength || artwork.description?.length || 0,
    artist: creators[0] ?? null
  }

  // 清理不需要输出到前端的临时字段 (虽然 JS 中 delete 性能一般，但在这里为了通过类型检查或减少 payload 可行)
  delete result.artworkTags
  delete result._count
  delete result.externalRefs

  return result
}

/**
 * 转换图片模型为 DTO 格式
 * @param images 图片模型数组
 * @param dbImageCount 数据库中记录的图片总数（可选）
 * @returns 转换后的图片 DTO 数组
 */
export function transformImages(
  images: Array<TImageModel & { animationMetadata?: StoredAnimationMetadata | null }>,
  dbImageCount?: number
) {
  // 1. 直接转 DTO，保留数据库排序
  const allItems = images.map((image) => {
    const normalizedImage = normalizeImageSizeField(image)
    const storedMediaType = String((image as any).mediaType ?? '').toUpperCase()
    const mediaType =
      storedMediaType === 'VIDEO' || storedMediaType === 'video' || isVideoFile(normalizedImage.path)
        ? 'video'
        : 'image'
    const isAnimated =
      storedMediaType === 'ANIMATION' || normalizedImage.webpAnimationStatus === EMediaAnimationStatus.animated
    const hasChapters =
      mediaType === 'video' && Boolean(normalizedImage.chaptersPath && (normalizedImage.chaptersCount ?? 0) > 0)
    const publishedKeyframeSet = Array.isArray((normalizedImage as any).keyframeSets)
      ? (normalizedImage as any).keyframeSets[0]
      : null
    const keyframeCount =
      mediaType === 'video' && Number.isInteger(publishedKeyframeSet?.publishedCount)
        ? Math.max(0, publishedKeyframeSet.publishedCount)
        : 0
    const hasKeyframes = keyframeCount > 0
    const videoMetadata = normalizedImage.videoMetadata
    const animationMetadata = toAnimationMetadataDto(normalizedImage)
    const metadataFields = videoMetadata
      ? {
          probeStatus: videoMetadata.probeStatus,
          probeUpdatedAt: videoMetadata.probeUpdatedAt,
          probeError: videoMetadata.probeError,
          hasAudio: videoMetadata.hasAudio,
          audioCodec: videoMetadata.audioCodec,
          audioChannels: videoMetadata.audioChannels,
          videoCodec: videoMetadata.videoCodec,
          duration: videoMetadata.duration,
          fps: videoMetadata.fps,
          posterStatus: videoMetadata.posterStatus,
          posterUpdatedAt: videoMetadata.posterUpdatedAt,
          posterError: videoMetadata.posterError,
          posterUrl: buildVideoPosterUrl(videoMetadata)
        }
      : getFlatVideoMetadataFields(image as any)

    return ArtworkImageResponseDto.parse({
      ...normalizedImage,
      mediaType,
      isAnimated,
      animationMetadata,
      hasChapters,
      chaptersUrl: hasChapters ? `/api/v1/media/${normalizedImage.id}/chapters` : null,
      hasKeyframes,
      keyframeCount,
      keyframesUrl: hasKeyframes ? `/api/v1/media/${normalizedImage.id}/keyframes` : null,
      ...metadataFields
    })
  })

  // 2. Complete logical sequence and member mapping are shared with reading progress.
  const groups = groupLogicalMedia(allItems)
  for (const group of groups) {
    for (const member of group.members.slice(1)) Object.assign(group.item, { raw: member })
  }
  const finalItems = groups.map((group) => group.item)

  // 3. 统计逻辑（基于合并后的 finalItems）
  const hasVideo = finalItems.some((img) => img.mediaType === 'video')
  // 计算总大小
  const totalMediaSize = finalItems.reduce((sum, img) => sum + (img.size || 0), 0)

  return {
    images: finalItems,
    hasVideo,
    imageCount: hasVideo ? 0 : (dbImageCount ?? finalItems.length),
    mediaCount: hasVideo ? finalItems.length : (dbImageCount ?? finalItems.length),
    totalMediaSize
  }
}

interface StoredAnimationMetadata {
  format: 'GIF' | 'APNG' | 'WEBP' | null
  durationMs: bigint | null
  frameCount: number | null
  loopCount: number | null
  status: string
  timingPolicyVersion: number | null
  sourcePath: string | null
  writeInProgress: boolean
}

function toAnimationMetadataDto(image: { path: string; animationMetadata?: StoredAnimationMetadata | null }): AnimationMetadataDto | null {
  const metadata = image.animationMetadata
  if (
    !metadata ||
    metadata.status !== 'READY' ||
    metadata.writeInProgress ||
    metadata.timingPolicyVersion !== ANIMATION_DURATION_TIMING_POLICY_VERSION ||
    metadata.sourcePath !== image.path ||
    !metadata.format ||
    metadata.durationMs === null ||
    metadata.durationMs < 0n ||
    metadata.durationMs > BigInt(Number.MAX_SAFE_INTEGER) ||
    !Number.isSafeInteger(metadata.frameCount) ||
    (metadata.frameCount ?? 0) < 1 ||
    !Number.isSafeInteger(metadata.loopCount) ||
    (metadata.loopCount ?? -1) < 0
  ) {
    return null
  }
  return {
    format: metadata.format,
    durationMs: Number(metadata.durationMs),
    frameCount: metadata.frameCount!,
    loopCount: metadata.loopCount!,
    timingPolicyVersion: metadata.timingPolicyVersion
  }
}

/*
 * 这是一个原地(in-place)打乱数组的优秀算法，比 sort + Math.random() 更随机、更高效。
 * @param array 需要打乱的数组
 */
export function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = array[i]!
    array[i] = array[j]!
    array[j] = temp // 使用临时变量交换元素，避免解构赋值可能引发的类型错误
  }
  return array
}

// 辅助：获取不带后缀的文件名
export const getStem = (p: string) => {
  const name = path.basename(p)
  const ext = path.extname(name)
  return name.slice(0, name.length - ext.length)
}

function getFlatVideoMetadataFields(image: Record<string, unknown>) {
  const fields: Record<string, unknown> = {}
  for (const key of [
    'probeStatus',
    'probeUpdatedAt',
    'probeError',
    'hasAudio',
    'audioCodec',
    'audioChannels',
    'videoCodec',
    'duration',
    'fps',
    'posterStatus',
    'posterUpdatedAt',
    'posterError',
    'posterUrl'
  ]) {
    if (image[key] !== undefined) {
      fields[key] = image[key]
    }
  }
  return fields
}

export const generateLocalStorageKey = (artworkId: number) => {
  const randomSuffix = Math.floor(1000000 + Math.random() * 9000000).toString()
  return `e_${artworkId}_${randomSuffix}`
}

/** @deprecated 使用 generateLocalStorageKey。仅为兼容性发布保留。 */
export const generateLocalExternalId = generateLocalStorageKey

/**
 * 确定作品的相对存储路径
 * 逻辑：
 * 1. 如果已有图片，取第一张图片的目录
 * 2. 如果没有图片，根据 Artist ID + Artwork External ID 拼接
 */
export function determineArtworkRelDir(artwork: {
  storagePath?: string | null
  storageKey?: string | null
  images?: { path: string }[]
  artist?: { userId: string | null } | null
  externalId: string | null
}): string | null {
  let targetRelDir = ''
  if (artwork.storagePath) {
    targetRelDir = artwork.storagePath
  } else if (artwork.images && artwork.images.length > 0 && artwork.images[0]?.path) {
    targetRelDir = path.dirname(artwork.images[0].path)
  } else if (artwork.artist?.userId && (artwork.storageKey || artwork.externalId)) {
    targetRelDir = `/${artwork.artist.userId}/${artwork.storageKey || artwork.externalId}`
  } else {
    return null
  }

  // 统一路径分隔符为 /
  return targetRelDir.replace(/\\/g, '/')
}
