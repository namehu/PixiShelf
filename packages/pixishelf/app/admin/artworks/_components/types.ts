export interface ImageListItem {
  id: number
  path: string
  sortOrder: number
  width: number | null
  height: number | null
  size: number | null
  mediaType?: 'image' | 'video'
  chaptersPath?: string | null
  chaptersUrl?: string | null
  chaptersCount?: number
  chaptersDuration?: number | null
  hasChapters?: boolean
  probeStatus?: 'PENDING' | 'PROBING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' | null
  probeUpdatedAt?: string | null
  probeError?: string | null
  hasAudio?: boolean | null
  audioCodec?: string | null
  audioChannels?: number | null
  videoCodec?: string | null
  duration?: number | null
  fps?: number | null
}
