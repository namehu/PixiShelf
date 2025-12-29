import { promises as fs } from 'fs'
import path from 'path'
import { MEDIA_EXTENSIONS } from '../../../../lib/constant'
import logger from '@/lib/logger'

/**
 * 媒体文件信息接口
 */
export interface MediaFileInfo {
  path: string // 文件完整路径
  filename: string // 文件名
  extension: string // 文件扩展名
  size: number // 文件大小（字节）
  artworkId: string // 关联的作品ID
  pageIndex: number // 页面索引（从0开始）
  sortOrder: number // 排序顺序
}

/**
 * 收集结果接口
 */
export interface CollectionResult {
  success: boolean
  mediaFiles: MediaFileInfo[]
  error?: string
}

/**
 * 新的媒体文件收集器
 * 适配Next.js环境
 */
export class MediaCollector {
  /** 支持的文件扩展名集合 */
  private readonly supportedExtensions = new Set(MEDIA_EXTENSIONS)

  constructor() {
    // Next.js环境下不需要logger参数
  }

  /**
   * 收集指定作品ID的所有媒体文件
   * @param directoryPath 目录路径
   * @param artworkId 作品ID
   * @returns 收集结果
   */
  async collectMediaFiles(directoryPath: string, artworkId: string): Promise<CollectionResult> {
    try {
      // 读取目录内容
      const files = await fs.readdir(directoryPath)

      // 过滤和解析媒体文件
      const mediaFiles: MediaFileInfo[] = []

      for (const entry of files) {
        const filename = entry
        const filePath = path.join(directoryPath, filename)

        // 检查文件扩展名
        const extension = path.extname(filename).toLowerCase()
        if (!this.supportedExtensions.has(extension)) continue

        // 检查是否是目标作品的媒体文件
        const mediaInfo = this.parseMediaFilename(filename, artworkId, extension)
        if (!mediaInfo) continue

        try {
          const fileStats = await fs.stat(filePath)
          if (!fileStats.isFile()) continue
          const fileSize = fileStats.size

          mediaFiles.push({
            path: filePath,
            filename,
            extension,
            size: fileSize,
            artworkId,
            pageIndex: mediaInfo.pageIndex,
            sortOrder: mediaInfo.pageIndex
          })
        } catch (error) {
          logger.warn('Failed to get file stats:', { error, filePath })
          continue
        }
      }

      // 按页面索引排序
      mediaFiles.sort((a, b) => a.pageIndex - b.pageIndex)

      return {
        success: true,
        mediaFiles
      }
    } catch (error) {
      logger.error('Failed to collect media files:', { error, directoryPath, artworkId })
      return {
        success: false,
        mediaFiles: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * 解析媒体文件名
   * @param filename 文件名
   * @param expectedArtworkId 期望的作品ID
   * @param extension 文件扩展名
   * @returns 解析结果或null
   */
  private parseMediaFilename(
    filename: string,
    expectedArtworkId: string,
    extension: string
  ): { pageIndex: number } | null {
    // 匹配 {artworkID}.{ext}
    if (filename === `${expectedArtworkId}${extension}`) {
      return { pageIndex: 0 }
    }

    // 匹配格式: {artworkID}_p{index}.{ext}
    const match = filename.match(/^(\d+)_p(\d+)\./i)
    if (!match) return null

    const [, artworkId, pageIndexStr] = match

    // 验证作品ID是否匹配
    if (artworkId !== expectedArtworkId) return null

    if (!pageIndexStr) return null
    const pageIndex = parseInt(pageIndexStr, 10)
    if (Number.isNaN(pageIndex) || pageIndex < 0) return null

    return { pageIndex }
  }
}
