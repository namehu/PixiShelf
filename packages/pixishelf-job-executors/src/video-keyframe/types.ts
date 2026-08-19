import type { Prisma, PrismaClient } from '@pixishelf/db'
import type { VideoKeyframeFilter } from './policy.ts'

export type VideoKeyframeDatabase = Pick<
  PrismaClient,
  'image' | 'systemJob' | 'mediaVideoKeyframe' | 'mediaVideoKeyframeSet'
>

export type VideoKeyframeTransaction = Prisma.TransactionClient

export interface VideoKeyframeRuntimeConfig {
  scanRoot: string
  keyframeStorageRoot: string
  ffmpegPath?: string
  ffprobePath?: string
  ffmpegThreads: number
  frameTimeoutMs?: number
  probeTimeoutMs?: number
}

export interface VideoKeyframeProgress {
  percentage: number
  stage: string
  message: string
  data?: Record<string, unknown>
}

export interface VideoKeyframeGenerationResult {
  imageId: number
  setId: string
  path: string
  duration: number
  targetCount: number
  publishedCount: number
  warning: string | null
  deferredCleanup: true
  posterRegeneration: 'NOT_REQUESTED'
}

export interface VideoKeyframeDiscoveryBaseResult {
  discovered: number
  matched: number
  enqueued: number
  reused: number
  filtered: number
  current: number
  inaccessible: number
  failedSamples: Array<{ imageId: number; path: string; error: string }>
}

export interface VideoKeyframePreviewCandidate {
  imageId: number
  path: string
  duration: number | null
  status: 'MISSING' | 'STALE' | 'FAILED' | 'CURRENT'
  publishedCount: number
}

export type VideoKeyframeDiscoveryResult =
  | VideoKeyframeDiscoveryBaseResult
  | (VideoKeyframeDiscoveryBaseResult & {
      previewOnly: true
      previewTruncated: boolean
      candidates: VideoKeyframePreviewCandidate[]
      force: boolean
      filter: VideoKeyframeFilter
    })

export type RunFencedMutation = <T>(operation: (transaction: VideoKeyframeTransaction) => Promise<T>) => Promise<T>

export class VideoKeyframePermanentError extends Error {
  constructor(
    readonly code:
      | 'IMAGE_NOT_FOUND'
      | 'NOT_A_VIDEO'
      | 'INVALID_DURATION'
      | 'NO_CANDIDATES'
      | 'INSUFFICIENT_DISTINCT_FRAMES'
      | 'PATH_OUTSIDE_ALLOWED_ROOT',
    message: string
  ) {
    super(message)
    this.name = 'VideoKeyframePermanentError'
  }
}

export class VideoKeyframeProcessError extends Error {
  constructor(
    readonly code: 'EXTERNAL_PROCESS_FAILED' | 'EXTERNAL_PROCESS_TIMEOUT',
    message: string
  ) {
    super(message)
    this.name = 'VideoKeyframeProcessError'
  }
}
