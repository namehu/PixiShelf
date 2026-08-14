import 'server-only'

import * as fs from 'node:fs/promises'
import { prisma } from '@/lib/prisma'
import { buildDerivedMediaPublicUrl } from '@/lib/derived-media'
import { isVideoFile } from '@/lib/media'
import { resolveExistingPathWithinRoot } from '@/lib/safe-path'
import { getScanPath } from '@/services/setting.service'
import { publishedVideoKeyframeFilesExist } from '@/services/video-keyframe-discovery-state'
import { sourceFingerprintFromStat } from '@/services/video-keyframe-service'

export interface PublishedVideoKeyframeManifest {
  version: 1
  imageId: number
  publishedAt: string
  count: number
  frames: Array<{
    id: string
    captureTime: number
    selectedOrder: number
    url: string
  }>
}

/**
 * 仅返回仍属于当前源视频且已发布的关键帧集合。
 * 策略版本漂移被有意忽略：在生成新质量策略的过程中，旧关键帧仍有效。
 */
export async function getPlayableVideoKeyframesByImageId(
  imageId: number
): Promise<PublishedVideoKeyframeManifest | null> {
  const image = await prisma.image.findUnique({
    where: { id: imageId },
    select: {
      id: true,
      path: true,
      mediaType: true,
      keyframeSets: {
        where: { status: 'PUBLISHED' },
        orderBy: { publishedAt: 'desc' },
        take: 1,
        select: {
          id: true,
          sourceSize: true,
          sourceMtimeMs: true,
          publishedCount: true,
          publishedAt: true,
          updatedAt: true,
          frames: {
            where: { selectedOrder: { not: null }, status: 'COMPLETED', path: { not: null } },
            orderBy: { selectedOrder: 'asc' },
            take: 30,
            select: {
              id: true,
              captureTime: true,
              selectedOrder: true,
              path: true,
              updatedAt: true
            }
          }
        }
      }
    }
  })

  if (!image) throw new Error('Image not found')
  if (String(image.mediaType).toUpperCase() !== 'VIDEO' && !isVideoFile(image.path)) {
    throw new Error('Image is not a video')
  }

  const published = image.keyframeSets[0]
  if (!published || published.publishedCount <= 0) return null

  const scanPath = await getScanPath()
  if (!scanPath) throw new Error('Scan path not configured')

  let sourceStat: Awaited<ReturnType<typeof fs.stat>>
  try {
    const sourcePath = await resolveExistingPathWithinRoot(scanPath, image.path.replace(/^[/\\]+/, ''))
    sourceStat = await fs.stat(sourcePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  if (!sourceStat.isFile()) return null
  const fingerprint = sourceFingerprintFromStat(sourceStat)
  // 只有源视频文件大小与 mtime 与已发布 keyframe 集一致时，才认为当前文件仍可直接使用旧帧集。
  if (published.sourceSize !== fingerprint.size || published.sourceMtimeMs !== fingerprint.mtimeMs) return null
  if (!(await publishedVideoKeyframeFilesExist(published))) return null

  const frames = published.frames.flatMap((frame) =>
    frame.path && frame.selectedOrder !== null
      ? [
          {
            id: frame.id,
            captureTime: frame.captureTime,
            selectedOrder: frame.selectedOrder,
            url: buildDerivedMediaPublicUrl('VIDEO_KEYFRAME', frame.path, frame.updatedAt)
          }
        ]
      : []
  )

  if (frames.length === 0) return null

  return {
    version: 1,
    imageId: image.id,
    publishedAt: (published.publishedAt ?? published.updatedAt).toISOString(),
    count: frames.length,
    frames
  }
}
