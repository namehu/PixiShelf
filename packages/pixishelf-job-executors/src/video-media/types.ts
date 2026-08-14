import type { Prisma, PrismaClient } from '@pixishelf/db'

export type VideoMediaDatabase = Pick<
  PrismaClient,
  'image' | 'mediaVideoMetadata' | 'mediaChapterPreview' | 'derivedMediaGcEntry'
>

export type VideoMediaTransaction = Prisma.TransactionClient

export interface VideoMediaRuntimeConfig {
  scanRoot: string
  posterStorageRoot: string
  chapterPreviewStorageRoot: string
  ffprobePath?: string
  ffmpegPath?: string
  probeTimeoutMs?: number
  posterTimeoutMs?: number
  gcBatchSize?: number
  reconciliationLimit?: number
}

export interface VideoProbeMetadata {
  hasAudio: boolean
  audioCodec: string | null
  audioChannels: number | null
  videoCodec: string | null
  duration: number | null
  fps: number | null
}

export class VideoMediaPermanentError extends Error {
  constructor(
    readonly code: 'SOURCE_NOT_FOUND' | 'NOT_A_VIDEO' | 'PATH_OUTSIDE_ALLOWED_ROOT' | 'PRECONDITION_FAILED',
    message: string
  ) {
    super(message)
    this.name = 'VideoMediaPermanentError'
  }
}

export class VideoMediaProcessError extends Error {
  constructor(
    readonly code: 'EXTERNAL_PROCESS_FAILED' | 'EXTERNAL_PROCESS_TIMEOUT',
    message: string
  ) {
    super(message)
    this.name = 'VideoMediaProcessError'
  }
}
