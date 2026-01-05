import { createSafeActionClient, DEFAULT_SERVER_ERROR_MESSAGE } from 'next-safe-action'
import { cookies } from 'next/headers'
import { sessionManager } from './session'

// 定义一个错误类
export class ActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActionError'
  }
}

export const actionClient = createSafeActionClient({
  defaultValidationErrorsShape: 'flattened',
  handleServerError(e) {
    // A. 记录详细日志到控制台（给开发者看）
    // logger.error('Action error:', e)

    if (e instanceof ActionError) {
      return e.message
    }

    // 如果是其他未知的系统错误（如数据库挂了），则返回通用模糊信息，保护系统隐私
    return DEFAULT_SERVER_ERROR_MESSAGE
  }
})

// Auth client defined by extending the base one.
// Note that the same initialization options and middleware functions of the base client
// will also be used for this one.
export const authActionClient = actionClient
  // Define authorization middleware.
  .use(async ({ next }) => {
    // 1. 获取当前用户 Session
    const cookieStore = await cookies()
    const token = cookieStore.get('auth-token')?.value

    if (!token) {
      throw new Error('token not found!')
    }

    const session = await sessionManager.getSession(token)
    if (!session || !session.isActive) {
      throw new Error('token is invalid!')
    }

    if (!session.userId) {
      throw new Error('Session is not valid!')
    }

    // Return the next middleware with `userId` value in the context
    return next({ ctx: { userId: Number(session.userId) } })
  })
