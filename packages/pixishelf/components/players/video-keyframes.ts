'use client'

import { z } from 'zod'
import { formatTime } from '@/lib/utils'

const VideoKeyframeSchema = z.object({
  id: z.string().min(1),
  captureTime: z.number().nonnegative(),
  selectedOrder: z.number().int().nonnegative(),
  url: z.string().min(1)
})

const VideoKeyframeManifestSchema = z.object({
  version: z.literal(1),
  imageId: z.number().int().positive(),
  publishedAt: z.string().min(1),
  count: z.number().int().positive(),
  frames: z.array(VideoKeyframeSchema)
})

export type NormalizedVideoKeyframe = z.infer<typeof VideoKeyframeSchema>

export function normalizeVideoKeyframeManifest(input: unknown): {
  imageId: number
  publishedAt: string
  frames: NormalizedVideoKeyframe[]
} {
  const manifest = VideoKeyframeManifestSchema.parse(input)
  const frames = [...manifest.frames].sort(
    (left, right) => left.selectedOrder - right.selectedOrder || left.captureTime - right.captureTime
  )

  if (frames.length !== manifest.count) {
    throw new Error('Representative-frame manifest count does not match its frame list')
  }

  return {
    imageId: manifest.imageId,
    publishedAt: manifest.publishedAt,
    frames
  }
}

export function getNearestVideoKeyframe(
  keyframes: NormalizedVideoKeyframe[],
  currentTime: number
): NormalizedVideoKeyframe | undefined {
  if (keyframes.length === 0) return undefined
  const safeTime = Number.isFinite(currentTime) ? Math.max(currentTime, 0) : 0

  return keyframes.reduce((nearest, candidate) => {
    const nearestDistance = Math.abs(nearest.captureTime - safeTime)
    const candidateDistance = Math.abs(candidate.captureTime - safeTime)
    if (candidateDistance < nearestDistance) return candidate
    if (candidateDistance === nearestDistance && candidate.captureTime < nearest.captureTime) return candidate
    return nearest
  })
}

export function formatVideoKeyframeTime(seconds: number): string {
  return formatTime(Math.max(Math.floor(seconds), 0))
}
