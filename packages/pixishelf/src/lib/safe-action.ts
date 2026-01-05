import { createSafeActionClient, DEFAULT_SERVER_ERROR_MESSAGE } from 'next-safe-action'
import logger from './logger'

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
