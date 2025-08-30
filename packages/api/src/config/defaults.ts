import { AppConfig } from './types'

/**
 * 获取默认配置
 * 只包含项目实际使用的配置项
 */
export function getDefaultConfig(): AppConfig {
  return {
    env: (process.env.NODE_ENV as any) || 'development',
    appName: 'PixiShelf API',
    version: '1.0.0',

    database: {
      url: process.env.DATABASE_URL || 'postgresql://localhost:5432/pixishelf'
    },

    server: {
      port: parseInt(process.env.PORT || '3001'),
      host: process.env.HOST || '0.0.0.0'
    },

    auth: {
      jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production'
    }
  }
}
