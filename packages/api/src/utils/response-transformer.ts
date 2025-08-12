/**
 * 统一的响应数据转换工具
 * 自动将 Prisma 返回的 Date 对象转换为 ISO 字符串
 */

// 定义日期转换后的类型映射
export type DateToString<T> = T extends Date
  ? string
  : T extends (infer U)[]
  ? DateToString<U>[]
  : T extends object
  ? { [K in keyof T]: DateToString<T[K]> }
  : T

/**
 * 递归转换对象中的所有 Date 类型为 string
 * 提供精确的类型推断
 */
export function transformDates<T>(obj: T): DateToString<T> {
  if (obj === null || obj === undefined) {
    return obj as DateToString<T>
  }

  if (obj instanceof Date) {
    return obj.toISOString() as DateToString<T>
  }

  if (Array.isArray(obj)) {
    return obj.map(item => transformDates(item)) as DateToString<T>
  }

  if (typeof obj === 'object') {
    const transformed = {} as any
    for (const [key, value] of Object.entries(obj)) {
      transformed[key] = transformDates(value)
    }
    return transformed as DateToString<T>
  }

  return obj as DateToString<T>
}

/**
 * 专门用于转换 Prisma 查询结果的工具函数
 * 提供类型安全的转换
 */
export function transformPrismaResult<T>(result: T): DateToString<T> {
  return transformDates(result)
}

/**
 * 转换分页响应数据
 */
export function transformPaginatedResponse<T>(data: {
  items: T[]
  total: number
  page: number
  pageSize: number
}) {
  return {
    ...data,
    items: data.items.map(item => transformDates(item))
  }
}