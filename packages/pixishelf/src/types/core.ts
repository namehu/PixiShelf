// ============================================================================
// 核心数据模型类型
// ============================================================================

/**
 * 用户信息
 */
export interface User {
  id: number
  username: string
  createdAt: string
  updatedAt?: string
}

/**
 * Prisma用户类型（数据库模型）
 */
export interface PrismaUser {
  /** 用户ID */
  id: number
  /** 用户名 */
  username: string
  /** 密码哈希 */
  password: string
  /** 创建时间 */
  createdAt: Date
  /** 更新时间 */
  updatedAt: Date
}

/**
 * 艺术家信息
 */
export interface Artist {
  id: number
  name: string
  username?: string | null
  userId?: string | null
  bio?: string | null
  artworksCount: number
  createdAt: string
  updatedAt: string
}

/**
 * 媒体文件信息（图片和视频）
 */
export interface MediaFile {
  id: number
  path: string
  mediaType: 'image' | 'video'
  width?: number | null
  height?: number | null
  size?: number | null
  duration?: number | null // 视频时长（秒）
  frameRate?: number | null // 视频帧率
  bitrate?: number | null // 视频比特率
  codec?: string | null // 视频编码格式
  artworkId?: number | null
  sortOrder?: number | null // 排序顺序
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
  images: MediaFile[]
  createdAt: string
  updatedAt: string
}

/**
 * 图片信息（向后兼容）
 * @deprecated 请使用 MediaFile 接口
 */
export interface Image extends MediaFile {
  mediaType: 'image'
}

/**
 * 标签信息
 */
export interface Tag {
  id: number
  name: string
  description?: string | null
  artworkCount: number
  createdAt: string
  updatedAt: string
}