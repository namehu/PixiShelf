import type { ApiErrorResponse, ApiSuccessResponse } from '@/lib/api-response'
import type { ImageReplaceSessionResult } from '@/services/artwork-service/image-replace-session'
import type { ImageMeta } from '@/services/artwork-service/image-manager'
import type { MediaChapterUploadMeta } from '@/services/artwork-service/media-chapter-upload'
import type { MediaUploadStatus } from '@/services/artwork-service/media-upload'

export type ArtworkMediaApiErrorResponse<TDetails = unknown> = ApiErrorResponse<TDetails>

export type MediaUploadStatusResponse = MediaUploadStatus

export type MediaUploadChunkResponse = ApiSuccessResponse | ApiSuccessResponse<{ meta: ImageMeta[] }>

export type MediaChapterUploadResponse = ApiSuccessResponse<{ meta: MediaChapterUploadMeta }>

export type ImageReplaceInitResponse = Extract<ImageReplaceSessionResult, { message: 'Initialized & Backed up' }>

export type ImageReplaceCommitResponse = Extract<ImageReplaceSessionResult, { success: true; message?: never }>

export type ImageReplaceRollbackResponse = Extract<ImageReplaceSessionResult, { message: 'Rolled back successfully' }>
