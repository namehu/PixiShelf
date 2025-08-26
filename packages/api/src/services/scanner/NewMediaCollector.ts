import { promises as fs } from 'fs'
import path from 'path'
import { FastifyInstance } from 'fastify'

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
 * 专门收集 {artworkID}_p{index}.{ext} 格式的媒体文件
 */
export class NewMediaCollector {
  private logger: FastifyInstance['log']
  private readonly supportedExtensions = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.webp',
    '.bmp',
    '.tiff',
    '.tif',
    '.mp4',
    '.avi',
    '.mov',
    '.wmv',
    '.flv',
    '.mkv',
    '.webm'
  ])

  constructor(logger: FastifyInstance['log']) {
    this.logger = logger
  }

  /**
   * 收集指定作品ID的所有媒体文件
   * @param directoryPath 目录路径
   * @param artworkId 作品ID
   * @returns 收集结果
   */
  async collectMediaFiles(directoryPath: string, artworkId: string): Promise<CollectionResult> {
    try {
      // 验证目录是否存在
      const stats = await fs.stat(directoryPath)
      if (!stats.isDirectory()) {
        return {
          success: false,
          mediaFiles: [],
          error: `Path is not a directory: ${directoryPath}`
        }
      }

      // 读取目录内容
      const files = await fs.readdir(directoryPath)

      return this.collectMediaFilesFromEntries(directoryPath, artworkId, files)
    } catch (error) {
      this.logger.error({ error, directoryPath, artworkId }, 'Failed to collect media files')
      return {
        success: false,
        mediaFiles: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * 从已读取的目录条目中收集指定作品ID的所有媒体文件
   * 这个方法避免了重复的目录读取操作，提升性能
   * @param directoryPath 目录路径
   * @param artworkId 作品ID
   * @param entries 已读取的目录条目（文件名数组或Dirent数组）
   * @returns 收集结果
   */
  async collectMediaFilesFromEntries(
    directoryPath: string,
    artworkId: string,
    entries: string[] | import('fs').Dirent[]
  ): Promise<CollectionResult> {
    try {
      // 过滤和解析媒体文件
      const mediaFiles: MediaFileInfo[] = []

      for (const entry of entries) {
        const filename = typeof entry === 'string' ? entry : entry.name
        const filePath = path.join(directoryPath, filename)

        // 如果是Dirent对象，检查是否为文件
        if (typeof entry !== 'string' && !entry.isFile()) continue

        // 检查是否是目标作品的媒体文件
        const mediaInfo = this.parseMediaFilename(filename, artworkId)
        if (!mediaInfo) continue

        try {
          // 如果是字符串数组，需要获取文件信息
          let fileSize: number
          if (typeof entry === 'string') {
            const fileStats = await fs.stat(filePath)
            if (!fileStats.isFile()) continue
            fileSize = fileStats.size
          } else {
            // 对于Dirent对象，仍需要获取文件大小
            const fileStats = await fs.stat(filePath)
            fileSize = fileStats.size
          }

          // 检查文件扩展名
          const extension = path.extname(filename).toLowerCase()
          if (!this.supportedExtensions.has(extension)) continue

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
          this.logger.warn({ error, filePath }, 'Failed to get file stats')
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
      this.logger.error({ error, directoryPath, artworkId }, 'Failed to collect media files from entries')
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
   * @returns 解析结果或null
   */
  private parseMediaFilename(filename: string, expectedArtworkId: string): { pageIndex: number } | null {
    // 匹配格式: {artworkID}_p{index}.{ext}
    const match = filename.match(/^(\d+)_p(\d+)\./i)
    if (!match) return null

    const [, artworkId, pageIndexStr] = match

    // 验证作品ID是否匹配
    if (artworkId !== expectedArtworkId) return null

    const pageIndex = parseInt(pageIndexStr, 10)
    if (isNaN(pageIndex) || pageIndex < 0) return null

    return { pageIndex }
  }

  /**
   * 验证媒体文件与元数据的关联
   * @param metadataPath 元数据文件路径
   * @param mediaFiles 媒体文件列表
   * @returns 是否关联有效
   */
  validateAssociation(metadataPath: string, mediaFiles: MediaFileInfo[]): boolean {
    if (mediaFiles.length === 0) return false

    const metadataFilename = path.basename(metadataPath)
    const artworkIdFromMetadata = this.extractArtworkIdFromMetadata(metadataFilename)

    if (!artworkIdFromMetadata) return false

    // 检查所有媒体文件的作品ID是否与元数据一致
    return mediaFiles.every((file) => file.artworkId === artworkIdFromMetadata)
  }

  /**
   * 检查文件是否是元数据文件
   * @param filename 文件名
   * @returns 是否是元数据文件
   */
  private isMetadataFile(filename: string): boolean {
    return /^\d+-meta\.txt$/i.test(filename)
  }

  /**
   * 从元数据文件名提取作品ID
   * @param metadataFilename 元数据文件名
   * @returns 作品ID或null
   */
  private extractArtworkIdFromMetadata(metadataFilename: string): string | null {
    const match = metadataFilename.match(/^(\d+)-meta\.txt$/i)
    return match ? match[1] : null
  }

  /**
   * 检查文件是否是媒体文件
   * @param filename 文件名
   * @returns 是否是媒体文件
   */
  static isMediaFile(filename: string): boolean {
    return /^\d+_p\d+\./i.test(filename)
  }

  /**
   * 从媒体文件名提取作品ID
   * @param filename 文件名
   * @returns 作品ID或null
   */
  static extractArtworkIdFromMedia(filename: string): string | null {
    const match = filename.match(/^(\d+)_p\d+\./i)
    return match ? match[1] : null
  }

  /**
   * 从媒体文件名提取页面索引
   * @param filename 文件名
   * @returns 页面索引或null
   */
  static extractPageIndexFromMedia(filename: string): number | null {
    const match = filename.match(/^\d+_p(\d+)\./i)
    if (!match) return null

    const pageIndex = parseInt(match[1], 10)
    return isNaN(pageIndex) ? null : pageIndex
  }

  /**
   * 获取支持的文件扩展名列表
   * @returns 支持的扩展名数组
   */
  getSupportedExtensions(): string[] {
    return Array.from(this.supportedExtensions)
  }
}
