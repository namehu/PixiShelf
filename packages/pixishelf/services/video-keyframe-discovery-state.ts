import * as fs from 'node:fs/promises'
import { resolveDerivedMediaStoragePath, VIDEO_KEYFRAME_STORAGE_ROOT } from '@/services/derived-media-storage-paths'

export interface VideoKeyframeBatchAccumulator {
  discovered: number
  matched: number
  enqueued: number
  reused: number
  filtered: number
  current: number
  inaccessible: number
  failedSamples: Array<{ imageId: number; path: string; error: string }>
}

export function toVideoKeyframeBatchAccumulator(
  result: VideoKeyframeBatchAccumulator
): VideoKeyframeBatchAccumulator {
  return {
    discovered: result.discovered,
    matched: result.matched,
    enqueued: result.enqueued,
    reused: result.reused,
    filtered: result.filtered,
    current: result.current,
    inaccessible: result.inaccessible,
    failedSamples: result.failedSamples
  }
}

export function normalizeVideoKeyframeBatchAccumulator(value: unknown): VideoKeyframeBatchAccumulator | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const numberValue = (key: string) => {
    const candidate = record[key]
    return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0 ? candidate : 0
  }
  const failedSamples = Array.isArray(record.failedSamples)
    ? record.failedSamples.flatMap((sample) => {
        if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return []
        const item = sample as Record<string, unknown>
        if (!Number.isInteger(item.imageId) || typeof item.path !== 'string' || typeof item.error !== 'string') {
          return []
        }
        return [{ imageId: Number(item.imageId), path: item.path, error: item.error }]
      })
    : []
  return {
    discovered: numberValue('discovered'),
    matched: numberValue('matched'),
    enqueued: numberValue('enqueued'),
    reused: numberValue('reused'),
    filtered: numberValue('filtered'),
    current: numberValue('current'),
    inaccessible: numberValue('inaccessible'),
    failedSamples: failedSamples.slice(0, 20)
  }
}

export async function publishedVideoKeyframeFilesExist(input: {
  publishedCount: number
  frames: Array<{ path: string | null }>
}) {
  if (input.publishedCount <= 0 || input.frames.length !== input.publishedCount) return false
  const checks = await Promise.all(
    input.frames.map((frame) =>
      frame.path
        ? fs
            .stat(resolveDerivedMediaStoragePath(VIDEO_KEYFRAME_STORAGE_ROOT, frame.path))
            .then((stat) => stat.isFile())
            .catch(() => false)
        : Promise.resolve(false)
    )
  )
  return checks.every(Boolean)
}
