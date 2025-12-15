import { z } from 'zod'
// ==========================================
// Transformers (转换器)
// ==========================================

// 将 Date 对象转换为 ISO 字符串
export const dateToString = z
  .date()
  .transform((d) => d.toISOString())
  .or(z.string()) // FIXME: 临时解决 Zod 类型问题  prisma中有一个转换函数

// 处理可能为 null 的 Date
export const nullableDateToString = z
  .date()
  .transform((d) => (d ? d.toISOString() : null))
  .nullable()
