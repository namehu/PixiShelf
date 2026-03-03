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
  // YYYY-MM-DD / YYYY.MM.DD / YYYY_MM_DD / YYYY MM DD
  { regex: /(\d{4})[-_/. ](\d{1,2})[-_/. ](\d{1,2})/, format: 'YYYY-MM-DD' },
  // YYYYMMDD (8 digits) - allowing surrounding chars
  { regex: /(?:^|[^0-9])(\d{4})(\d{2})(\d{2})(?:[^0-9]|$)/, format: 'YYYYMMDD' },
  // DD-MM-YYYY / DD.MM.YYYY
  { regex: /(\d{1,2})[-_/. ](\d{1,2})[-_/. ](\d{4})/, format: 'DD-MM-YYYY' },
  // MM-DD-YYYY (US format, less common but possible)
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
        // match: [full, Y, M, D]
        dateStr = `${match[1]}-${match[2]}-${match[3]}`
        formatStr = `YYYY-${match[2].length === 2 ? 'MM' : 'M'}-${match[3].length === 2 ? 'DD' : 'D'}`
      } else if (p.format === 'YYYYMMDD') {
        // match: [full, Y, M, D]
        dateStr = `${match[1]}${match[2]}${match[3]}`
        formatStr = 'YYYYMMDD'
      } else if (p.format === 'DD-MM-YYYY') {
        // match: [full, D, M, Y]
        dateStr = `${match[3]}-${match[2]}-${match[1]}`
        formatStr = `YYYY-${match[2].length === 2 ? 'MM' : 'M'}-${match[1].length === 2 ? 'DD' : 'D'}`
      } else if (p.format === 'MM-DD-YYYY') {
        // match: [full, M, D, Y]
        dateStr = `${match[3]}-${match[1]}-${match[2]}`
        formatStr = `YYYY-${match[1].length === 2 ? 'MM' : 'M'}-${match[2].length === 2 ? 'DD' : 'D'}`
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
    // ExifReader.load 读取文件 buffer
    // 注意：ExifReader 在浏览器端支持直接传 File 对象
    const tags = await ExifReader.load(file, { expanded: true })

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
  // 1. Filename
  const dName = parseDateFromFilename(file.name)
  if (dName) {
    return { date: dName, source: 'filename' }
  }

  // 2. Metadata (Exif for images)
  const dMeta = await parseDateFromMetadata(file)
  if (dMeta) {
    return { date: dMeta, source: 'metadata' }
  }

  // 3. File Attribute (Last Modified - useful for videos without metadata support)
  const dAttr = parseDateFromFileAttribute(file)
  if (dAttr) {
    return { date: dAttr, source: 'file-attribute' }
  }

  // 4. Default
  return { date: defaultDate, source: 'default' }
}
