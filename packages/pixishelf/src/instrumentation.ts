import 'server-only'
import { APP_VERSION } from './_config'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { default: logger } = await import('./lib/logger')
    logger.log({
      level: 'info',
      message: '🚀 Server is starting up... Performing initialization.'
    })

    // 在这里执行你的启动任务
    // 例如：连接数据库、初始化缓存、打印环境信息等
    const { testDatabaseConnection } = await import('./lib/prisma')
    try {
      await testDatabaseConnection()
    } catch (error) {
      logger.error({
        level: 'error',
        message: '❌ Database connection failed:',
        error
      })
    }

    logger.log({
      level: 'info',
      message: `✅ Server is up and running! Version: ${APP_VERSION}`
    })

    // 可以在这里注册其他的监控工具
  }
}
