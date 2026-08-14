import { NextRequest, NextResponse } from 'next/server'
import { z, ZodError, ZodSchema } from 'zod'
import logger from '@/lib/logger'

// 定义通用的 Context 类型 (Next.js 15+ params 是 Promise)
interface RouteContext {
  params: Promise<Record<string, string>>
}

/**
 * 定义业务处理函数的签名
 * 泛型 T 为 Zod 结构推导出的数据类型
 */
type AppRouteHandler<T = any> = (
  req: NextRequest,
  data: T, // ✨ 这里直接拿到校验后的数据，且有类型提示
  context: RouteContext
) => Promise<NextResponse | any>

export function apiHandler<T extends ZodSchema>(schema: T, handler: AppRouteHandler<z.infer<T>>) {
  return async (req: NextRequest, context: RouteContext) => {
    try {
      // --- 1. 数据收集与合并 ---

      // 获取路径参数；Next.js 15 中 params 是 Promise。
      const params = await context.params

      // 获取 URL 查询参数，例如 ?id=1&type=a。
      const searchParams = Object.fromEntries(req.nextUrl.searchParams.entries())

      // 仅为非 GET/DELETE 请求读取 JSON 请求体。
      let body = {}
      const contentType = req.headers.get('content-type')
      if (req.method !== 'GET' && req.method !== 'DELETE' && contentType?.includes('application/json')) {
        try {
          body = await req.json()
        } catch {
          // 请求体为空或 JSON 格式错误时先按空对象处理，最终交由统一结构校验决定是否报错。
          // 这里简单处理为空对象
        }
      }

      // 合并后由结构一次性校验全部输入；后展开的数据源覆盖前者，因此优先级为请求体 > 查询参数 > 路径参数。
      const rawData = {
        ...params,
        ...searchParams,
        ...body
      }

      // --- 2. 统一验证 ---
      const validatedData = await schema.parseAsync(rawData)

      // --- 3. 执行业务逻辑并注入已验证数据 ---
      const result = await handler(req, validatedData, context)

      // --- 4. 响应归一化 ---
      if (result instanceof NextResponse) {
        return result
      }

      return NextResponse.json({
        code: 0,
        data: result,
        message: '',

        // 兼容 后续迭代废弃字段
        success: true,
        errorCode: 0
      })
    } catch (err: any) {
      // --- 5. 错误处理 ---
      if (err instanceof ZodError) {
        return NextResponse.json(
          {
            code: 400,
            message: 'Invalid Request Parameters',
            details: z.prettifyError(err), // 返回具体的字段错误

            // 兼容 后续迭代废弃字段
            success: false,
            errorCode: 400,
            error: 'Invalid Request Parameters'
          },
          { status: 400 }
        )
      }

      if (err instanceof ApiError) {
        return NextResponse.json(
          {
            code: err.statusCode ?? 501,
            data: err.details,
            message: err.message,

            // 兼容 后续迭代废弃字段
            success: false,
            errorCode: err.statusCode ?? 501,
            error: err.message
          },
          { status: err.statusCode }
        )
      }

      logger.error(`API Error [${req.method} ${req.nextUrl.pathname}]:`, err)

      return NextResponse.json(
        {
          code: 500,
          data: null,
          message: 'Internal Server Error',

          // 兼容 后续迭代废弃字段
          success: false,
          errorCode: 500,
          error: 'Internal Server Error'
        },
        { status: 500 }
      )
    }
  }
}

export class ApiError extends Error {
  statusCode: number
  details?: any

  constructor(message: string, statusCode = 400, details?: any) {
    super(message)
    this.statusCode = statusCode
    this.details = details
  }
}

export function responseSuccess<T>(data?: { data?: T; code?: number; message?: string }) {
  const { code = 0, message, data: responseData } = data ?? {}

  const result: any = {
    code,
    message: message ?? 'success'
  }
  if (responseData !== undefined) {
    result.data = responseData
  }
  return NextResponse.json(result, { status: 200 })
}

/**
 * 401 未授权响应
 */
export function responseUnauthorized<T>(data?: { data?: T; code?: number; message?: string }) {
  const { code = 401, message, data: responseData } = data ?? {}

  const result: any = {
    code,
    message: message ?? 'Unauthorized'
  }
  if (responseData !== undefined) {
    result.data = responseData
  }
  return NextResponse.json(result, { status: 401 })
}
