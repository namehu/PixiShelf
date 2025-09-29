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
    name: string
    username?: string
  } | null
  createdAt: string
  tags: {
    id: number
    name: string
  }[]
}
