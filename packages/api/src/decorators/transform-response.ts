import { transformPrismaResult } from '../utils/response-transformer'

/**
 * 装饰器：自动转换路由处理函数的返回值中的日期格式
 * 使用方法：在路由处理函数上添加 @TransformResponse 装饰器
 */
export function TransformResponse(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value

  descriptor.value = async function (...args: any[]) {
    const result = await originalMethod.apply(this, args)
    
    // 如果返回值是对象，自动转换其中的日期
    if (result && typeof result === 'object') {
      return transformPrismaResult(result)
    }
    
    return result
  }

  return descriptor
}

/**
 * 高阶函数：包装路由处理函数，自动转换响应中的日期
 */
export function withDateTransform<T extends (...args: any[]) => any>(handler: T): T {
  return (async (...args: any[]) => {
    const result = await handler(...args)
    
    if (result && typeof result === 'object') {
      return transformPrismaResult(result)
    }
    
    return result
  }) as T
}

/**
 * 专门用于 Fastify 路由的包装函数
 */
export function createTransformedRoute<TRequest = any, TReply = any>(
  handler: (request: TRequest, reply: TReply) => Promise<any>
) {
  return async (request: TRequest, reply: TReply) => {
    const result = await handler(request, reply)
    
    // 如果处理函数返回了数据（而不是直接调用 reply.send），则转换日期
    if (result && typeof result === 'object') {
      return transformPrismaResult(result)
    }
    
    return result
  }
}