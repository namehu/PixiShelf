/**
 * 响应类型转换工具
 * 解决 Fastify 插件运行时转换与 TypeScript 编译时类型检查的不匹配问题
 */

import { DateToString } from '../utils/response-transformer'

/**
 * 将 Prisma 返回的类型转换为 API 响应类型
 * 这个类型转换只在编译时生效，运行时由 Fastify 插件自动处理
 */
export type ApiResponseType<T> = DateToString<T>

/**
 * 用于路由返回类型的辅助函数
 * 提供正确的类型推断，实际转换由插件处理
 */
export function asApiResponse<T>(data: T): ApiResponseType<T> {
  // 这个函数在运行时什么都不做，只是为了类型推断
  // 实际的日期转换由 Fastify 插件在序列化时处理
  return data as ApiResponseType<T>
}

/**
 * 专门用于分页响应的类型转换
 */
export function asPaginatedResponse<T>(data: {
  items: T[]
  total: number
  page: number
  pageSize: number
}): {
  items: ApiResponseType<T>[]
  total: number
  page: number
  pageSize: number
} {
  return data as any
}