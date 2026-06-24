import type { ScanProgress, ScanResult } from '@/types'
import type { Artist } from '@prisma/client'
import type { MetadataInfo } from './metadata-parser'
import type { MediaFileInfo } from './media-collector'
import type { MetadataCandidateFile, MetadataFormat } from './metadata-candidates'

/**
 * 扫描选项接口
 */
export interface ScanOptions {
  scanPath: string
  forceUpdate?: boolean
  onProgress?: (progress: ScanProgress) => void
  /**
   * 检查取消状态的回调函数
   * 如果返回 true，则扫描过程应立即终止并抛出取消异常
   */
  checkCancelled?: () => Promise<boolean>
  /**
   * 客户端传入的元数据相对路径列表（相对 scanPath）
   * 如果提供，则不进行本地/远程文件扫描，而是直接基于该列表构建元数据文件集合
   */
  metadataRelativePaths?: string[]
}

/**
 * 作品数据接口
 */
export interface ArtworkData {
  metadata: MetadataInfo
  mediaFiles: MediaFileInfo[]
  directoryPath: string
  metadataFilePath: string
  directoryCreatedAt: Date
}

export interface GlobMetadataFile extends MetadataCandidateFile {
  name: string
  artworkId: string
  path: string
  createdAt: Date
  metadataFormat: MetadataFormat
}

export type ArtistCacheEntry = Pick<Artist, 'id' | 'name' | 'username' | 'userId' | 'bio'>

/**
 * 扫描上下文接口
 */
export interface ScanContext {
  tagCache: Map<string, number>
  artistCache: Map<string, ArtistCacheEntry>
  scanResult: ScanResult
  options: ScanOptions
}
