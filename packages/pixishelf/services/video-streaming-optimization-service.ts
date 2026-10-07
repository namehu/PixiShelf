import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveExistingPathWithinRoot } from '@/lib/safe-path'
import { type VideoStreamingOptimizationResult } from '@pixishelf/job-executors'
import path from 'node:path'

export interface VideoStreamingOptimizationTarget {
  id: number
  path: string
  sourcePath: string
}

export type { VideoStreamingOptimizationResult }
export interface VideoStreamingOptimizationProgress {
  percentage: number
  message: string
}

/**
 * Request-time validation shared by legacy callers. FFmpeg execution deliberately
 * does not live in Next anymore; the central executor repeats these checks under a
 * fenced worker lease before touching the source file.
 */
export async function resolveVideoStreamingOptimizationTarget(
  imageId: number,
  scanPath: string
): Promise<VideoStreamingOptimizationTarget> {
  const image = await prisma.image.findUnique({
    where: { id: imageId },
    select: { id: true, path: true, mediaType: true }
  })
  if (!image) throw new Error('Image not found')
  if (String(image.mediaType).toUpperCase() !== 'VIDEO' && !isVideoPath(image.path)) {
    throw new Error('Image is not a video')
  }
  if (path.extname(image.path).toLowerCase() !== '.mp4') throw new Error('Only MP4 videos can be optimized')
  const sourcePath = await resolveExistingPathWithinRoot(scanPath, image.path.replace(/^[/\\]+/, ''))
  return { id: image.id, path: image.path, sourcePath }
}

function isVideoPath(relativePath: string) {
  return /\.(?:mp4|webm|mkv|mov|avi|m4v|wmv|flv)$/i.test(relativePath)
}
