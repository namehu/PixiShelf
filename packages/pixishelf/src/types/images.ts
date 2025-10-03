import { Tag } from './core'
import { MediaType } from './media'

export interface RandomImagesResponse {
  items: RandomImageItem[]
  total: number
  page: number
  pageSize: number
  nextPage: number | null
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
  images: {
    key: string
    url: string
  }[]
  author: {
    id: number
    userId: string
    name: string
    username?: string
    avatar?: string
  } | null
  createdAt: string
  tags: Tag[]
}
