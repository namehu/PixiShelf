import { AppConfig, ConfigOverrides } from './types'

/**
 * 获取默认配置
 * 提供所有配置项的合理默认值
 */
export function getDefaultConfig(): AppConfig {
  return {
    env: (process.env.NODE_ENV as any) || 'development',
    appName: 'PixiShelf API',
    version: '1.0.0',

    database: {
      url: process.env.DATABASE_URL || 'postgresql://localhost:5432/pixishelf',
      connectionLimit: 20,
      connectionTimeout: 30000,
      queryTimeout: 60000
    },

    server: {
      port: 3001,
      host: '0.0.0.0',
      enableCors: true,
      bodyLimit: '10mb',
      enableRequestLogging: true
    },

    auth: {
      jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
      jwtExpiresIn: '7d',
      enableAuth: false,
      bcryptRounds: 12
    },

    log: {
      level: 'info',
      enableFileLogging: false,
      enableStructuredLogging: true,
      format: 'pretty'
    }
  }
}

/**
 * 获取生产环境配置覆盖
 */
export function getProductionOverrides(): ConfigOverrides {
  return {
    log: {
      level: 'warn',
      enableFileLogging: true,
      logFilePath: '/var/log/pixishelf/app.log',
      enableStructuredLogging: true,
      format: 'json'
    },

    database: {
      connectionLimit: 50
    },

    server: {
      enableRequestLogging: false // 生产环境可能关闭请求日志
    }
  }
}

/**
 * 获取开发环境配置覆盖
 */
export function getDevelopmentOverrides(): ConfigOverrides {
  return {
    log: {
      level: 'debug',
      enableFileLogging: false,
      enableStructuredLogging: false,
      format: 'pretty'
    },

    database: {}
  }
}

/**
 * 根据环境获取配置覆盖
 */
export function getEnvironmentOverrides(env: string): ConfigOverrides {
  switch (env) {
    case 'production':
      return getProductionOverrides()
    case 'development':
      return getDevelopmentOverrides()
    default:
      return {}
  }
}
