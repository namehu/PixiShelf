import { promises as fs } from 'fs'

/**
 * 元数据信息接口
 */
export interface MetadataInfo {
  // 必填字段
  id: string // 作品唯一ID
  user: string // 作者名称
  userId: string // 作者ID
  title: string // 作品标题

  // 可选字段
  description?: string // 作品描述
  tags?: string[] // 作品标签
  url?: string // 作品URL
  original?: string // 原始图片URL
  thumbnail?: string // 缩略图URL
  xRestrict?: string // 限制等级
  ai?: string // 是否AI生成
  size?: string // 作品尺寸
  bookmark?: number // 收藏数
  date?: Date // 发布日期
}

/**
 * 解析结果接口
 */
export interface ParseResult {
  success: boolean
  metadata?: MetadataInfo
  error?: string
}

/**
 * 元数据字段映射常量
 */
const METADATA_FIELD_MAPPING = {
  // 原始字段名 -> MetadataInfo属性名
  ID: 'id',
  User: 'user',
  UserID: 'userId',
  Title: 'title',
  Description: 'description',
  Tags: 'tags',
  URL: 'url',
  Original: 'original',
  Thumbnail: 'thumbnail',
  xRestrict: 'xRestrict',
  AI: 'ai',
  Size: 'size',
  Bookmark: 'bookmark',
  Date: 'date'
} as const

/**
 * 必填字段常量
 */
const REQUIRED_FIELDS = ['ID', 'User', 'UserID', 'Title'] as const

/**
 * 已知字段列表
 */
const KNOWN_FIELDS = Object.keys(METADATA_FIELD_MAPPING)

/**
 * 解析元数据文件
 * @param filePath 元数据文件路径
 * @returns 解析结果
 */
export async function parseMetadataFile(filePath: string): Promise<ParseResult> {
  try {
    // 验证文件是否存在
    const stats = await fs.stat(filePath)
    if (!stats.isFile()) {
      return {
        success: false,
        error: `Path is not a file: ${filePath}`
      }
    }

    // 读取文件内容
    const content = await fs.readFile(filePath, 'utf-8')

    // 解析内容
    const metadata = parseContent(content)

    // 验证必填字段
    const validation = validateMetadata(metadata)
    if (!validation.success) {
      return {
        success: false,
        error: validation.error || 'Validation failed'
      }
    }

    return { success: true, metadata }
  } catch (error: any) {
    // 针对文件不存在的情况进行特殊处理，不打印错误日志，交由调用方处理
    if (error.code === 'ENOENT') {
      return {
        success: false,
        error: `File not found: ${filePath}`
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * 解析文件内容
 * @param content 文件内容
 * @returns 元数据对象
 */
function parseContent(content: string): MetadataInfo {
  const metadata: Partial<MetadataInfo> = {}
  const lines = content.split('\n')

  let currentKey = ''
  let currentValue = ''

  for (const line of lines) {
    const trimmedLine = line.trim()

    // 跳过空行
    if (!trimmedLine) {
      if (currentKey && currentValue) {
        setMetadataField(metadata, currentKey, currentValue.trim())
        currentKey = ''
        currentValue = ''
      }
      continue
    }

    // 检查是否是新的字段开始
    if (isFieldKey(trimmedLine)) {
      // 保存上一个字段
      if (currentKey && currentValue) {
        setMetadataField(metadata, currentKey, currentValue.trim())
      }

      // 开始新字段
      currentKey = trimmedLine
      currentValue = ''
    } else {
      // 累积字段值
      if (currentValue) {
        currentValue += '\n' + trimmedLine
      } else {
        currentValue = trimmedLine
      }
    }
  }

  // 处理最后一个字段
  if (currentKey && currentValue) {
    setMetadataField(metadata, currentKey, currentValue.trim())
  }

  return metadata as MetadataInfo
}

/**
 * 判断是否是字段键
 * @param line 行内容
 * @returns 是否是字段键
 */
function isFieldKey(line: string): boolean {
  return KNOWN_FIELDS.includes(line)
}

/**
 * 设置元数据字段
 * @param metadata 元数据对象
 * @param key 字段键
 * @param value 字段值
 */
function setMetadataField(metadata: Partial<MetadataInfo>, key: string, value: string): void {
  if (!value) return

  switch (key) {
    case 'ID':
      metadata.id = value
      break
    case 'User':
      metadata.user = value
      break
    case 'UserID':
      metadata.userId = value
      break
    case 'Title':
      metadata.title = value
      break
    case 'Description':
      metadata.description = value || ''
      break
    case 'Tags':
      metadata.tags = parseTags(value)
      break
    case 'URL':
      metadata.url = value
      break
    case 'Original':
      metadata.original = value
      break
    case 'Thumbnail':
      metadata.thumbnail = value
      break
    case 'xRestrict':
      metadata.xRestrict = value
      break
    case 'AI':
      metadata.ai = value
      break
    case 'Size':
      metadata.size = value
      break
    case 'Bookmark': {
      const bookmarkNum = parseInt(value, 10)
      metadata.bookmark = Number.isNaN(bookmarkNum) ? 0 : bookmarkNum
      break
    }
    case 'Date':
      metadata.date = parseDate(value) || new Date()
      break
  }
}

/**
 * 解析标签字符串
 * @param tagsString 标签字符串
 * @returns 标签数组
 */
function parseTags(tagsString: string): string[] {
  if (!tagsString) return []

  return tagsString
    .split('\n')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .map((tag) => (tag.startsWith('#') ? tag.substring(1) : tag))
    .filter((tag) => tag.length > 0)
}

/**
 * 解析日期字符串
 * @param dateString 日期字符串
 * @returns 日期对象或undefined
 */
function parseDate(dateString: string): Date | undefined {
  if (!dateString) return undefined

  try {
    const date = new Date(dateString)
    return Number.isNaN(date.getTime()) ? undefined : date
  } catch {
    return undefined
  }
}

/**
 * 验证元数据
 * @param metadata 元数据对象
 * @returns 验证结果
 */
function validateMetadata(metadata: Partial<MetadataInfo>): { success: boolean; error?: string } {
  const errors: string[] = []

  // 检查必填字段
  for (const field of REQUIRED_FIELDS) {
    const fieldKey = METADATA_FIELD_MAPPING[field] as keyof MetadataInfo
    const value = metadata[fieldKey]

    if (!value || (typeof value === 'string' && value.trim() === '')) {
      errors.push(`Required field '${field}' is missing or empty`)
    }
  }

  // 验证ID格式
  if (metadata.id && !/^\d+$/.test(metadata.id)) {
    errors.push('ID must be a numeric string')
  }

  // 验证UserID格式
  if (metadata.userId && !/^\d+$/.test(metadata.userId)) {
    errors.push('UserID must be a numeric string')
  }

  if (errors.length > 0) {
    return {
      success: false,
      error: errors.join('; ')
    }
  }

  return { success: true }
}

/**
 * 从文件名提取作品ID
 * @param filename 文件名
 * @returns 作品ID或null
 */
export function extractArtworkIdFromFilename(filename: string): string | null {
  const match = filename.match(/^(\d+)-meta\.txt$/i)
  return match && match[1] ? match[1] : null
}

/**
 * 检查文件是否是元数据文件
 * @param filename 文件名
 * @returns 是否是元数据文件
 */
export function isMetadataFile(filename: string): boolean {
  return !!extractArtworkIdFromFilename(filename)
}
