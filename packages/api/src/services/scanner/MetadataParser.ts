import { promises as fs } from 'fs'
import {
  ArtworkMetadata,
  IMetadataParser,
  ValidationResult,
  MetadataValidationError,
  MetadataParseError
} from '@pixishelf/shared'

/**
 * 元数据解析器实现
 * 负责解析 {artworkID}-meta.txt 格式的元数据文件
 */
export class MetadataParser implements IMetadataParser {
  private readonly requiredFields = ['ID', 'User', 'UserID', 'Title']

  /**
   * 解析元数据文件
   * @param filePath 文件路径
   * @returns 解析后的元数据
   */
  async parse(filePath: string): Promise<ArtworkMetadata> {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const metadata = this.parseContent(content)

      const validationResult = this.validate(metadata)
      if (!validationResult.isValid) {
        throw new MetadataValidationError(validationResult.errors)
      }

      return metadata
    } catch (error) {
      if (error instanceof MetadataValidationError) {
        throw error
      }
      throw new MetadataParseError(filePath, error as Error)
    }
  }

  /**
   * 验证元数据
   * @param metadata 元数据对象
   * @returns 验证结果
   */
  validate(metadata: ArtworkMetadata): ValidationResult {
    const errors: string[] = []

    // 字段名映射
    const fieldMapping: { [key: string]: keyof ArtworkMetadata } = {
      'ID': 'id',
      'User': 'user',
      'UserID': 'userId',
      'Title': 'title'
    }

    // 检查必填字段
    for (const field of this.requiredFields) {
      const fieldKey = fieldMapping[field]
      const value = metadata[fieldKey]

      if (!value || (typeof value === 'string' && value.trim() === '')) {
        errors.push(`Required field '${field}' is missing or empty`)
      }
    }

    // 验证ID格式（应该是数字字符串）
    if (metadata.id && !/^\d+$/.test(metadata.id)) {
      errors.push('ID must be a numeric string')
    }

    // 验证UserID格式（应该是数字字符串）
    if (metadata.userId && !/^\d+$/.test(metadata.userId)) {
      errors.push('UserID must be a numeric string')
    }

    // 验证URL格式
    if (metadata.url && !this.isValidUrl(metadata.url)) {
      errors.push('URL format is invalid')
    }

    if (metadata.originalUrl && !this.isValidUrl(metadata.originalUrl)) {
      errors.push('Original URL format is invalid')
    }

    if (metadata.thumbnailUrl && !this.isValidUrl(metadata.thumbnailUrl)) {
      errors.push('Thumbnail URL format is invalid')
    }

    // 验证收藏数量（应该是非负数）
    if (metadata.bookmark !== undefined && metadata.bookmark < 0) {
      errors.push('Bookmark count must be non-negative')
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * 获取必填字段列表
   * @returns 必填字段名称数组
   */
  getRequiredFields(): string[] {
    return [...this.requiredFields]
  }

  /**
   * 解析文件内容
   * @param content 文件内容
   * @returns 解析后的元数据
   */
  private parseContent(content: string): ArtworkMetadata {
    const lines = content.split('\n').map((line) => line.trim())
    const metadata: Partial<ArtworkMetadata> = {}

    let currentKey = ''
    let currentValue = ''

    for (const line of lines) {
      if (line === '') {
        // 空行表示一个字段的结束
        if (currentKey && currentValue !== undefined) {
          this.setMetadataField(metadata, currentKey, currentValue)
          currentKey = ''
          currentValue = ''
        }
      } else if (!currentKey) {
        // 新字段的开始
        currentKey = line
      } else {
        // 字段值（可能是多行）
        currentValue += (currentValue ? '\n' : '') + line
      }
    }

    // 处理最后一个字段（如果文件末尾没有空行）
    if (currentKey && currentValue !== undefined) {
      this.setMetadataField(metadata, currentKey, currentValue)
    }

    return metadata as ArtworkMetadata
  }

  /**
   * 设置元数据字段
   * @param metadata 元数据对象
   * @param key 字段名
   * @param value 字段值
   */
  private setMetadataField(metadata: Partial<ArtworkMetadata>, key: string, value: string): void {
    const normalizedKey = key.toUpperCase()
    const trimmedValue = value.trim()

    switch (normalizedKey) {
      case 'ID':
        metadata.id = trimmedValue
        break
      case 'TITLE':
        metadata.title = trimmedValue
        break
      case 'USER':
        metadata.user = trimmedValue
        break
      case 'USERID':
        metadata.userId = trimmedValue
        break
      case 'DESCRIPTION':
        metadata.description = trimmedValue || undefined
        break
      case 'TAGS':
        metadata.tags = this.parseTags(trimmedValue)
        break
      case 'URL':
        metadata.url = trimmedValue || undefined
        break
      case 'ORIGINAL':
        metadata.originalUrl = trimmedValue || undefined
        break
      case 'THUMBNAIL':
        metadata.thumbnailUrl = trimmedValue || undefined
        break
      case 'XRESTRICT':
        metadata.xRestrict = trimmedValue || undefined
        break
      case 'AI':
        metadata.ai = this.parseBoolean(trimmedValue)
        break
      case 'SIZE':
        metadata.size = trimmedValue || undefined
        break
      case 'BOOKMARK':
        metadata.bookmark = this.parseNumber(trimmedValue)
        break
      case 'DATE':
        metadata.date = this.parseDate(trimmedValue)
        break
      default:
        // 忽略未知字段
        break
    }
  }

  /**
   * 解析标签字符串
   * @param tagsString 标签字符串
   * @returns 标签数组
   */
  private parseTags(tagsString: string): string[] {
    if (!tagsString) return []

    return tagsString
      .split(/\s+/) // 按空白字符分割
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
      .map((tag) => {
        // 移除开头的 # 符号
        return tag.startsWith('#') ? tag.substring(1) : tag
      })
      .filter((tag) => tag.length > 0) // 再次过滤空标签
  }

  /**
   * 解析布尔值
   * @param value 字符串值
   * @returns 布尔值或undefined
   */
  private parseBoolean(value: string): boolean | undefined {
    if (!value) return undefined

    const lowerValue = value.toLowerCase()
    if (lowerValue === 'yes' || lowerValue === 'true' || lowerValue === '1') {
      return true
    }
    if (lowerValue === 'no' || lowerValue === 'false' || lowerValue === '0') {
      return false
    }

    return undefined
  }

  /**
   * 解析数字
   * @param value 字符串值
   * @returns 数字或undefined
   */
  private parseNumber(value: string): number | undefined {
    if (!value) return undefined

    const num = parseInt(value, 10)
    return isNaN(num) ? undefined : num
  }

  /**
   * 解析日期
   * @param value 字符串值
   * @returns 日期对象或undefined
   */
  private parseDate(value: string): Date | undefined {
    if (!value) return undefined

    try {
      const date = new Date(value)
      return isNaN(date.getTime()) ? undefined : date
    } catch {
      return undefined
    }
  }

  /**
   * 验证URL格式
   * @param url URL字符串
   * @returns 是否为有效URL
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  }
}
