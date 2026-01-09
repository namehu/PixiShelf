import 'server-only'
import logger from './lib/logger'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    logger.log({
      level: 'info',
      message: '🚀 Server is starting up... Performing initialization.'
    })

    // 在这里执行你的启动任务
    // 例如：连接数据库、初始化缓存、打印环境信息等
    const { initializeAdmin, testDatabaseConnection } = await import('./lib/prisma')
    try {
      if (await testDatabaseConnection()) {
        await initializeAdmin()
      }
    } catch (error) {
      logger.error({
        level: 'error',
        message: '❌ Database connection failed:',
        error
      })
    }

    // 可以在这里注册其他的监控工具
  }
}
