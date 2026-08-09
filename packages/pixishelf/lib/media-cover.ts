import { isVideoFile } from '@/lib/media'
import { buildDerivedMediaPublicUrl } from '@/lib/derived-media'

export const VIDEO_POSTER_METADATA_SELECT = {
  posterStatus: true,
  posterPath: true,
  posterUpdatedAt: true
} as const

export interface VideoPosterMetadataLike {
  posterStatus?: string | null
  posterPath?: string | null
  posterUpdatedAt?: Date | string | number | null
}

export interface MediaCoverSource {
  path?: string | null
  mediaType?: string | null
  posterUrl?: string | null
}

export function buildVideoPosterUrl(metadata?: VideoPosterMetadataLike | null): string | null {
  if (metadata?.posterStatus !== 'COMPLETED' || !metadata.posterPath) {
    return null
  }

  return buildDerivedMediaPublicUrl('VIDEO_POSTER', metadata.posterPath, metadata.posterUpdatedAt)
}

export function isVideoCoverSource(media?: MediaCoverSource | null): boolean {
  const mediaType = String(media?.mediaType ?? '').toUpperCase()
  return mediaType === 'VIDEO' || isVideoFile(media?.path ?? '')
}

export function resolveMediaCoverUrl(media?: MediaCoverSource | null): string | null {
  if (!media?.path) {
    return null
  }

  if (isVideoCoverSource(media)) {
    return media.posterUrl || null
  }

  return media.path
}
