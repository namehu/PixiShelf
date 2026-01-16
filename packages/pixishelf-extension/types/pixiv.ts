
// Pixiv 标签翻译相关类型定义

export interface PixivTagData {
  originalTag: string
  translation: string | null
  englishTranslation: string | null
  abstract: string | null
  imageUrl: string | null
}

export interface TaskProgress {
  status: 'fulfilled' | 'rejected'
  data: PixivTagData | string // 成功时为PixivTagData，失败时为错误消息
}

export interface ProgressStorage {
  [tagName: string]: TaskProgress
}

export interface TaskConfig {
  CONCURRENT_REQUESTS: number
  MIN_DELAY_MS: number
  MAX_DELAY_MS: number
  RATE_LIMIT_WAIT_MS: number
  STORAGE_KEY: string
  IDS_STORAGE_KEY: string
  SQL_FILENAME: string
  TAG_IMAGES_ZIP_FILENAME: string
}

export interface TaskStats {
  total: number
  completed: number
  successful: number
  failed: number
  pending: number
}

export interface PixivApiResponse {
  error: boolean
  message?: string
  body?: {
    tagTranslation?: {
      [tagName: string]: {
        zh?: string
        en?: string
      }
    }
    pixpedia?: {
      abstract?: string
      image?: string
    }
  }
}

// Pixiv 用户信息相关类型定义

export interface PixivUserData {
  userId: string
  name: string
  avatarUrl: string | null
  backgroundUrl: string | null
}

export interface UserProgress {
  status: 'fulfilled' | 'rejected'
  data: PixivUserData | string // 成功时为PixivUserData，失败时为错误消息
}

export interface UserProgressStorage {
  [userId: string]: UserProgress
}

export interface UserStats {
  total: number
  completed: number
  successful: number
  failed: number
  pending: number
}

export interface PixivUserApiResponse {
  userId: string
  name: string
  avatarUrl?: string
  backgroundUrl?: string
}

// Pixiv 作品信息相关类型定义

export interface PixivArtworkData {
  id: string
  title: string
  description: string
  createDate: string
  uploadDate: string
  authorId: string
  authorName: string
  pageCount: number
  width: number
  height: number
  tags: string[]
  series: {
    id: string
    title: string
    order: number
  } | null
  // Metrics
  bookmarkCount: number
  likeCount: number
  viewCount: number
  
  // Metadata
  downloadCount?: number // 预留
  fileSize?: number // 预留
  resolution?: string // width x height
  
  // URLs
  url: string // original url
  thumbnailUrl: string
}

export interface ArtworkProgress {
    status: 'fulfilled' | 'rejected';
    data: PixivArtworkData | string;
}

export interface ArtworkProgressStorage {
    [artworkId: string]: ArtworkProgress;
}

export interface ArtworkStats {
  total: number
  completed: number
  successful: number
  failed: number
  pending: number
}
