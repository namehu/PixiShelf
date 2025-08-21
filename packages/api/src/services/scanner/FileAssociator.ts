import { promises as fs } from 'fs'
import path from 'path'
import { MediaFile, IFileAssociator, FileAssociationError } from '@pixishelf/shared'

/**
 * 文件关联器实现
 * 负责关联元数据文件和媒体文件
 */
export class FileAssociator implements IFileAssociator {
  private readonly supportedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg']

  /**
   * 查找与元数据文件关联的媒体文件
   * @param metadataPath 元数据文件路径
   * @param artworkId 作品ID
   * @returns 媒体文件列表
   */
  async findMediaFiles(metadataPath: string, artworkId: string): Promise<MediaFile[]> {
    const directory = path.dirname(metadataPath)

    try {
      const files = await fs.readdir(directory)
      const mediaFiles: MediaFile[] = []

      for (const file of files) {
        const filePath = path.join(directory, file)

        try {
          const stat = await fs.stat(filePath)

          if (stat.isFile() && this.isMediaFile(file) && this.isAssociatedFile(file, artworkId)) {
            const mediaFile = await this.createMediaFile(filePath, artworkId)
            mediaFiles.push(mediaFile)
          }
        } catch (error) {
          // 忽略无法访问的文件
          continue
        }
      }

      // 按页码排序
      return mediaFiles.sort((a, b) => (a.pageNumber || 0) - (b.pageNumber || 0))
    } catch (error) {
      throw new FileAssociationError(metadataPath, artworkId)
    }
  }

  /**
   * 验证文件关联关系
   * @param metadataFile 元数据文件路径
   * @param mediaFiles 媒体文件列表
   * @returns 是否关联有效
   */
  validateAssociation(metadataFile: string, mediaFiles: MediaFile[]): boolean {
    // 至少要有一个关联的媒体文件
    if (mediaFiles.length === 0) {
      return false
    }

    // 检查所有媒体文件是否在同一目录
    const metadataDir = path.dirname(metadataFile)
    for (const mediaFile of mediaFiles) {
      const mediaDir = path.dirname(mediaFile.path)
      if (path.resolve(mediaDir) !== path.resolve(metadataDir)) {
        return false
      }
    }

    // 检查页码是否连续（允许有间隔，但不能重复）
    const pageNumbers = mediaFiles.map((file) => file.pageNumber).filter((num) => num !== undefined) as number[]

    if (pageNumbers.length > 0) {
      const uniquePages = new Set(pageNumbers)
      if (uniquePages.size !== pageNumbers.length) {
        return false // 有重复页码
      }
    }

    return true
  }

  /**
   * 判断文件是否为媒体文件
   * @param filename 文件名
   * @returns 是否为媒体文件
   */
  private isMediaFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase()
    return this.supportedExtensions.includes(ext)
  }

  /**
   * 判断文件是否与指定作品ID关联
   * @param filename 文件名
   * @param artworkId 作品ID
   * @returns 是否关联
   */
  private isAssociatedFile(filename: string, artworkId: string): boolean {
    // 标准格式: {artworkId}_p{pageNumber}.{ext}
    const standardPattern = new RegExp(`^${this.escapeRegExp(artworkId)}_p\\d+\\.\\w+$`)
    if (standardPattern.test(filename)) {
      return true
    }

    // 简单格式: {artworkId}.{ext}
    const simplePattern = new RegExp(`^${this.escapeRegExp(artworkId)}\\.\\w+$`)
    if (simplePattern.test(filename)) {
      return true
    }

    // 带序号格式: {artworkId}_{number}.{ext}
    const numberedPattern = new RegExp(`^${this.escapeRegExp(artworkId)}_\\d+\\.\\w+$`)
    if (numberedPattern.test(filename)) {
      return true
    }

    return false
  }

  /**
   * 创建媒体文件对象
   * @param filePath 文件路径
   * @param artworkId 作品ID
   * @returns 媒体文件对象
   */
  private async createMediaFile(filePath: string, artworkId: string): Promise<MediaFile> {
    const filename = path.basename(filePath)
    const stat = await fs.stat(filePath)

    return {
      path: filePath,
      name: filename,
      extension: path.extname(filename),
      size: stat.size,
      artworkId,
      pageNumber: this.extractPageNumber(filename, artworkId)
    }
  }

  /**
   * 从文件名提取页码
   * @param filename 文件名
   * @param artworkId 作品ID
   * @returns 页码或undefined
   */
  private extractPageNumber(filename: string, artworkId: string): number | undefined {
    // 尝试标准格式: {artworkId}_p{pageNumber}.{ext}
    const standardMatch = filename.match(new RegExp(`^${this.escapeRegExp(artworkId)}_p(\\d+)\\.\\w+$`))
    if (standardMatch) {
      return parseInt(standardMatch[1], 10)
    }

    // 尝试带序号格式: {artworkId}_{number}.{ext}
    const numberedMatch = filename.match(new RegExp(`^${this.escapeRegExp(artworkId)}_(\\d+)\\.\\w+$`))
    if (numberedMatch) {
      return parseInt(numberedMatch[1], 10)
    }

    // 简单格式默认为页码0
    const simpleMatch = filename.match(new RegExp(`^${this.escapeRegExp(artworkId)}\\.\\w+$`))
    if (simpleMatch) {
      return 0
    }

    return undefined
  }

  /**
   * 转义正则表达式特殊字符
   * @param string 要转义的字符串
   * @returns 转义后的字符串
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /**
   * 获取支持的文件扩展名
   * @returns 支持的扩展名数组
   */
  getSupportedExtensions(): string[] {
    return [...this.supportedExtensions]
  }

  /**
   * 添加支持的文件扩展名
   * @param extensions 要添加的扩展名数组
   */
  addSupportedExtensions(extensions: string[]): void {
    for (const ext of extensions) {
      const normalizedExt = ext.toLowerCase()
      if (!this.supportedExtensions.includes(normalizedExt)) {
        this.supportedExtensions.push(normalizedExt)
      }
    }
  }

  /**
   * 检查目录中是否存在元数据文件
   * @param directory 目录路径
   * @returns 元数据文件路径数组
   */
  async findMetadataFiles(directory: string): Promise<string[]> {
    try {
      const files = await fs.readdir(directory)
      const metadataFiles: string[] = []

      for (const file of files) {
        if (this.isMetadataFile(file)) {
          metadataFiles.push(path.join(directory, file))
        }
      }

      return metadataFiles
    } catch {
      return []
    }
  }

  /**
   * 判断文件是否为元数据文件
   * @param filename 文件名
   * @returns 是否为元数据文件
   */
  private isMetadataFile(filename: string): boolean {
    // 匹配 {artworkId}-meta.txt 格式
    return /^\d+-meta\.txt$/i.test(filename)
  }

  /**
   * 从元数据文件名提取作品ID
   * @param metadataFilename 元数据文件名
   * @returns 作品ID或undefined
   */
  extractArtworkIdFromMetadata(metadataFilename: string): string | undefined {
    const match = metadataFilename.match(/^(\d+)-meta\.txt$/i)
    return match ? match[1] : undefined
  }
}
