import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
// @ts-ignore
import ExifReader from 'exifreader'

dayjs.extend(customParseFormat)

export type DateSource = 'filename' | 'metadata' | 'file-attribute' | 'default'

export interface DateParseResult {
  date: Date
  source: DateSource
}

// 预编译正则以提升性能
const PATTERNS = [
  // 年-月-日的常见分隔符变体
  { regex: /(\d{4})[-_/. ](\d{1,2})[-_/. ](\d{1,2})/, format: 'YYYY-MM-DD' },
  // 连续 8 位年月日，允许前后存在非数字字符
  { regex: /(?:^|[^0-9])(\d{4})(\d{2})(\d{2})(?:[^0-9]|$)/, format: 'YYYYMMDD' },
  // 日-月-年
  { regex: /(\d{1,2})[-_/. ](\d{1,2})[-_/. ](\d{4})/, format: 'DD-MM-YYYY' },
  // 月-日-年：美式格式较少见，但仍可能出现在文件名中
  { regex: /(\d{1,2})[-_/. ](\d{1,2})[-_/. ](\d{4})/, format: 'MM-DD-YYYY' }
]

/**
 * 从文件名解析日期
 */
export function parseDateFromFilename(filename: string): Date | null {
  for (const p of PATTERNS) {
    const match = filename.match(p.regex)
    if (match) {
      let dateStr = ''
      let formatStr = ''

      if (p.format === 'YYYY-MM-DD') {
        // 捕获组：[完整匹配, 年, 月, 日]
        dateStr = `${match[1]!}-${match[2]!}-${match[3]!}`
        formatStr = `YYYY-${match[2]!.length === 2 ? 'MM' : 'M'}-${match[3]!.length === 2 ? 'DD' : 'D'}`
      } else if (p.format === 'YYYYMMDD') {
        // 捕获组：[完整匹配, 年, 月, 日]
        dateStr = `${match[1]!}${match[2]!}${match[3]!}`
        formatStr = 'YYYYMMDD'
      } else if (p.format === 'DD-MM-YYYY') {
        // 捕获组：[完整匹配, 日, 月, 年]
        dateStr = `${match[3]!}-${match[2]!}-${match[1]!}`
        formatStr = `YYYY-${match[2]!.length === 2 ? 'MM' : 'M'}-${match[1]!.length === 2 ? 'DD' : 'D'}`
      } else if (p.format === 'MM-DD-YYYY') {
        // 捕获组：[完整匹配, 月, 日, 年]
        dateStr = `${match[3]!}-${match[1]!}-${match[2]!}`
        formatStr = `YYYY-${match[1]!.length === 2 ? 'MM' : 'M'}-${match[2]!.length === 2 ? 'DD' : 'D'}`
      }

      const d = dayjs(dateStr, formatStr, true)
      if (d.isValid()) {
        return d.toDate()
      }
    }
  }
  return null
}

/**
 * 从文件元数据解析日期 (Exif)
 */
export async function parseDateFromMetadata(file: File): Promise<Date | null> {
  // 只处理图片
  if (!file.type.startsWith('image/')) {
    return null
  }

  try {
    // ExifReader.load 读取文件缓冲区。
    // 注意：ExifReader 在浏览器端支持直接传 File 对象
    const tags = (await ExifReader.load(file, { expanded: true })) as any

    // 优先尝试 DateTimeOriginal
    let dateStr = tags.exif?.DateTimeOriginal?.description
    if (!dateStr) dateStr = tags.exif?.CreateDate?.description
    if (!dateStr) dateStr = tags.exif?.ModifyDate?.description
    // 有些时候是在 tiff 组里
    if (!dateStr) dateStr = tags.tiff?.DateTime?.description

    if (dateStr) {
      // Exif 标准格式通常是 "YYYY:MM:DD HH:mm:ss"
      // dayjs 需要正确格式解析
      // 有些可能带有时区或者格式不标准，这里做简单尝试
      // 替换冒号为连字符前两个 (YYYY:MM:DD -> YYYY-MM-DD)
      // 或者直接用 customParseFormat
      const d = dayjs(dateStr, 'YYYY:MM:DD HH:mm:ss')
      if (d.isValid()) {
        return d.toDate()
      }

      // 尝试 ISO 格式
      const dIso = dayjs(dateStr)
      if (dIso.isValid()) {
        return dIso.toDate()
      }
    }
  } catch (e) {
    console.warn('Failed to parse metadata date for', file.name, e)
  }
  return null
}

/**
 * 从文件属性解析日期 (Last Modified)
 */
export function parseDateFromFileAttribute(file: File): Date | null {
  if (file.lastModified) {
    const d = new Date(file.lastModified)
    if (!isNaN(d.getTime())) {
      return d
    }
  }
  return null
}

/**
 * 综合解析函数
 */
export async function parseFileDate(file: File, defaultDate: Date): Promise<DateParseResult> {
  // 1. 文件名
  const dName = parseDateFromFilename(file.name)
  if (dName) {
    return { date: dName, source: 'filename' }
  }

  // 2. 图片 Exif 元数据
  const dMeta = await parseDateFromMetadata(file)
  if (dMeta) {
    return { date: dMeta, source: 'metadata' }
  }

  // 3. 文件最后修改时间；主要用于无法读取元数据的视频
  const dAttr = parseDateFromFileAttribute(file)
  if (dAttr) {
    return { date: dAttr, source: 'file-attribute' }
  }

  // 4. 调用方提供的默认日期
  return { date: defaultDate, source: 'default' }
}
