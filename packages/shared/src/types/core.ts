// ============================================================================
// 核心数据模型类型
// ============================================================================

/**
 * 艺术家信息
 */
export interface Artist {
  id: number
  name: string
  username?: string | null
  userId?: string | null
  bio?: string | null
  createdAt: string
  updatedAt: string
}

/**
 * 作品信息
 */
export interface Artwork {
  id: number
  title: string
  description?: string | null
  directoryCreatedAt?: string | null // 目录创建时间（文件系统时间）
  imageCount: number // 图片总数
  descriptionLength: number // 描述长度
  artistId?: number | null
  artist?: Artist | null
  tags: string[]
  images: Image[]
  createdAt: string
  updatedAt: string
}

/**
 * 图片信息
 */
export interface Image {
  id: number
  path: string
  width?: number | null
  height?: number | null
  size?: number | null
  artworkId?: number | null
  createdAt: string
  updatedAt: string
}

/**
 * 标签信息
 */
export interface Tag {
  id: number
  name: string
  createdAt: string
  updatedAt: string
}

/**
 * 用户信息
 */
export interface User {
  id: number
  username: string
  createdAt: string
  updatedAt?: string
}
