import dotenv from 'dotenv'
import { buildServer } from './app'
import { initializeConfig, config, checkConfigHealth, getConfigSummary } from './config'

// 加载环境变量
dotenv.config()

const start = async () => {
  try {
    // 初始化配置系统
    console.log('Initializing configuration...')
    await initializeConfig({
      useEnvVars: true,
      validate: true,
    })

    // 检查配置健康状态
    const healthCheck = checkConfigHealth()
    if (!healthCheck.isHealthy) {
      console.error('Configuration health check failed:')
      healthCheck.issues.forEach(issue => console.error(`  - ${issue}`))
      process.exit(1)
    }

    if (healthCheck.recommendations.length > 0) {
      console.warn('Configuration recommendations:')
      healthCheck.recommendations.forEach(rec => console.warn(`  - ${rec}`))
    }

    // 构建服务器
    console.log('Building server...')
    const server = await buildServer()
    
    // 使用配置系统获取服务器配置
    const { port, host } = config.server
    
    // 启动服务器
    server
      .listen({ port, host })
      .then((address) => {
        server.log.info(`Server listening at ${address}`)
        server.log.info(`Environment: ${config.app.env}`)
        server.log.info(`App: ${config.app.name} v${config.app.version}`)
        
        // 输出配置摘要
        if (config.isDevelopment) {
          const summary = getConfigSummary()
          server.log.debug('Configuration summary:')
          server.log.debug(summary)
        }
      })
      .catch((err) => {
        server.log.error('Failed to start server:')
        console.error(err)
        process.exit(1)
      })
  } catch (error) {
    console.error('Failed to start application:', error)
    process.exit(1)
  }
}

// 优雅关闭处理
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...')
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...')
  process.exit(0)
})

start()
