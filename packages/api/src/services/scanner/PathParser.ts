import path from 'path'
import { ArtistInfo, ArtworkInfo, IPathParser } from '@pixishelf/shared'

/**
 * 路径解析器实现
 * 负责从目录路径中提取艺术家和作品信息
 */
export class PathParser implements IPathParser {
  /**
   * 从目录路径解析艺术家信息
   * @param dirPath 目录路径
   * @returns 艺术家信息
   */
  parseArtistInfo(dirPath: string): ArtistInfo {
    const normalizedPath = path.normalize(dirPath)
    const pathParts = normalizedPath.split(path.sep).filter((part) => part.length > 0)

    // 查找包含艺术家信息的目录部分
    // 格式可能是: "ArtistName-ArtistID" 或 "ArtistName"
    let artistPart = ''

    // 从路径中查找可能的艺术家目录
    for (let i = pathParts.length - 1; i >= 0; i--) {
      const part = pathParts[i]

      // 跳过明显是作品标题的部分（通常在最后一级）
      if (i === pathParts.length - 1 && !this.looksLikeArtistDirectory(part)) {
        continue
      }

      if (this.looksLikeArtistDirectory(part)) {
        artistPart = part
        break
      }
    }

    // 如果没找到明显的艺术家目录，使用倒数第二个目录
    if (!artistPart && pathParts.length >= 2) {
      artistPart = pathParts[pathParts.length - 2]
    }

    // 如果还是没找到，使用最后一个目录
    if (!artistPart && pathParts.length >= 1) {
      artistPart = pathParts[pathParts.length - 1]
    }

    return this.parseArtistString(artistPart)
  }

  /**
   * 解析作品路径信息（用于统一扫描）
   * @param metadataFilePath 元数据文件路径
   * @returns 路径信息
   */
  parseArtworkPath(metadataFilePath: string): {
    artistDir: string
    artworkDir: string
    fullPath: string
    relativePath: string
  } {
    const dirPath = path.dirname(metadataFilePath)
    const normalizedPath = path.normalize(dirPath)
    const pathParts = normalizedPath.split(path.sep).filter((part) => part.length > 0)
    
    return {
      artistDir: pathParts.length >= 2 ? pathParts[pathParts.length - 2] : '',
      artworkDir: pathParts.length >= 1 ? pathParts[pathParts.length - 1] : '',
      fullPath: dirPath,
      relativePath: path.relative(process.cwd(), dirPath)
    }
  }

  /**
   * 从目录路径解析作品信息
   * @param dirPath 目录路径
   * @returns 作品信息
   */
  parseArtworkInfo(dirPath: string): ArtworkInfo {
    const normalizedPath = path.normalize(dirPath)
    const pathParts = normalizedPath.split(path.sep).filter((part) => part.length > 0)

    // 通常作品标题在最后一级目录
    const lastPart = pathParts[pathParts.length - 1] || ''

    return {
      title: this.extractArtworkTitle(lastPart),
      relativePath: this.getRelativePath(dirPath, '')
    }
  }

  /**
   * 计算相对路径
   * @param fullPath 完整路径
   * @param basePath 基础路径
   * @returns 相对路径
   */
  getRelativePath(fullPath: string, basePath: string): string {
    if (!basePath) {
      return fullPath
    }

    try {
      return path.relative(basePath, fullPath)
    } catch {
      return fullPath
    }
  }

  /**
   * 判断目录名是否看起来像艺术家目录
   * @param dirName 目录名
   * @returns 是否像艺术家目录
   */
  private looksLikeArtistDirectory(dirName: string): boolean {
    // 包含连字符和数字的格式："ArtistName-123456"
    if (/-\d+$/.test(dirName)) {
      return true
    }

    // 包含用户ID模式的格式
    if (/user[_-]?\d+/i.test(dirName)) {
      return true
    }

    // 包含常见艺术家标识的格式
    if (/artist|author|creator/i.test(dirName)) {
      return true
    }

    return false
  }

  /**
   * 解析艺术家字符串
   * @param artistString 艺术家字符串
   * @returns 艺术家信息
   */
  private parseArtistString(artistString: string): ArtistInfo {
    if (!artistString) {
      return {
        name: 'Unknown Artist'
      }
    }

    // 尝试解析 "ArtistName-ArtistID" 格式
    const dashMatch = artistString.match(/^(.+?)[-_](\d+)$/)
    if (dashMatch) {
      const [, name, id] = dashMatch
      return {
        name: this.cleanArtistName(name),
        username: this.cleanArtistName(name),
        userId: id
      }
    }

    // 尝试解析 "ArtistName (ArtistID)" 格式
    const parenMatch = artistString.match(/^(.+?)\s*\((\d+)\)$/)
    if (parenMatch) {
      const [, name, id] = parenMatch
      return {
        name: this.cleanArtistName(name),
        username: this.cleanArtistName(name),
        userId: id
      }
    }

    // 尝试解析 "user_123456" 或 "user-123456" 格式
    const userMatch = artistString.match(/^user[_-]?(\d+)$/i)
    if (userMatch) {
      const [, id] = userMatch
      return {
        name: `User ${id}`,
        username: `user_${id}`,
        userId: id
      }
    }

    // 如果都不匹配，直接使用原字符串作为名称
    return {
      name: this.cleanArtistName(artistString)
    }
  }

  /**
   * 清理艺术家名称
   * @param name 原始名称
   * @returns 清理后的名称
   */
  private cleanArtistName(name: string): string {
    return name
      .trim()
      .replace(/[_-]+/g, ' ') // 将下划线和连字符替换为空格
      .replace(/\s+/g, ' ') // 合并多个空格
      .trim()
  }

  /**
   * 提取作品标题
   * @param dirName 目录名
   * @returns 作品标题
   */
  private extractArtworkTitle(dirName: string): string | undefined {
    if (!dirName) {
      return undefined
    }

    // 移除常见的文件系统不安全字符的替换
    let title = dirName
      .replace(/[_-]+/g, ' ') // 将下划线和连字符替换为空格
      .replace(/\s+/g, ' ') // 合并多个空格
      .trim()

    // 如果标题为空或者看起来像ID，返回undefined
    if (!title || /^\d+$/.test(title)) {
      return undefined
    }

    return title
  }
}
