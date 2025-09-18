// src/instrumentation.ts 或 instrumentation.ts

// 确保只在服务器端执行
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('🚀 Server is starting up... Performing initialization.')

    // 在这里执行你的启动任务
    // 例如：连接数据库、初始化缓存、打印环境信息等
    const { initializeAdmin, testDatabaseConnection } = await import('./lib/prisma')
    try {
      if (await testDatabaseConnection()) {
        await initializeAdmin()
      }
    } catch (error) {
      console.error('❌ Database connection failed:', error)
    }
    // 也可以在这里注册其他的监控工具
  }
}
