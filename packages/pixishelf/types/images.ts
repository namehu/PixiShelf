import type { TRandomTagDto } from '@/schemas/tag.dto'
import { MediaType } from './media'

export interface RandomImagesResponse {
  items: RandomImageItem[]
  total: number
  page: number
  pageSize: number
  nextPage: number | null
}

export interface ViewerMediaItem {
  key: string
  url: string
  mediaType: MediaType
  chaptersUrl?: string | null
  hasAudio?: boolean | null
  duration?: number | null
}

/**
 * 随机图片类型
 */
export interface RandomImageItem {
  /** 作品id */
  id: number
  key: string
  title: string
  description?: string
  imageUrl: string
  mediaType: MediaType
  images: ViewerMediaItem[]
  author: {
    id: number
    userId: string
    name: string
    username?: string
    avatar?: string
  } | null
  createdAt: string
  tags: TRandomTagDto[]
  /** 当前用户是否点赞了该作品 */
  isLike: boolean
}
