import type { Prisma, PrismaClient } from '@pixishelf/db'

export type VideoProcessingDatabase = Pick<PrismaClient, 'image' | 'mediaChapterPreview' | 'derivedMediaGcEntry'>

export type VideoProcessingTransaction = Prisma.TransactionClient

export interface VideoProcessingRuntimeConfig {
  scanRoot: string
  chapterPreviewRoot: string
  ffmpegPath?: string
  ffprobePath?: string
  ffmpegThreads: number
  chapterPageSize?: number
  chapterProcessTimeoutMs?: number
  streamingProcessTimeoutMs?: number
  probeTimeoutMs?: number
}

export interface ProcessRunRequest {
  command: string
  args: readonly string[]
  timeoutMs: number
  signal: AbortSignal
  onStdout?: (chunk: string) => void
}

export interface ProcessRunResult {
  stdout: string
  stderr: string
}

export type VideoProcessRunner = (request: ProcessRunRequest) => Promise<ProcessRunResult>

export interface VideoProcessingProgress {
  percentage: number
  stage: string
  message: string
  data?: Record<string, unknown>
}

export type RunFencedVideoMutation = <T>(
  operation: (transaction: VideoProcessingTransaction) => Promise<T>
) => Promise<T>

export class VideoProcessingPermanentError extends Error {
  constructor(
    readonly code:
      | 'IMAGE_NOT_FOUND'
      | 'NOT_A_VIDEO'
      | 'UNSUPPORTED_CONTAINER'
      | 'PATH_OUTSIDE_ALLOWED_ROOT'
      | 'INVALID_CHAPTER_MANIFEST'
      | 'SOURCE_CHANGED'
      | 'READ_ONLY_SOURCE',
    message: string
  ) {
    super(message)
    this.name = 'VideoProcessingPermanentError'
  }
}

export class VideoProcessingProcessError extends Error {
  constructor(
    readonly code: 'EXTERNAL_PROCESS_FAILED' | 'EXTERNAL_PROCESS_TIMEOUT',
    message: string
  ) {
    super(message)
    this.name = 'VideoProcessingProcessError'
  }
}

export class VideoProcessingRecoveryError extends Error {
  constructor(
    message: string,
    readonly publicationError: unknown,
    readonly recoveryError: unknown
  ) {
    super(message, { cause: recoveryError })
    this.name = 'VideoProcessingRecoveryError'
  }
}
