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
}
