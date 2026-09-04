import dayjs from 'dayjs'
import { z } from 'zod'
// ==========================================
// 数据转换器
// ==========================================

// 将 Date 对象转换为 ISO 字符串
export const dateToString = z
  .date()
  .transform((d) => dayjs(d).format('YYYY-MM-DD HH:mm:ss'))
  // 同时接受 Prisma Date 和已经序列化的 DTO 字符串。
  .or(z.string())

// 处理可能为 null 的 Date
export const nullableDateToString = z
  .date()
  .transform((d) => (d ? dayjs(d).format('YYYY-MM-DD HH:mm:ss') : null))
  .nullable()
  .or(z.string().nullable())
