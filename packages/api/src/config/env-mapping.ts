import { EnvVarMapping } from './types'

/**
 * 环境变量到配置路径的映射
 * 定义如何从环境变量加载配置值
 */
export const envVarMapping: EnvVarMapping = {
  // 应用基础配置
  env: {
    envVar: 'NODE_ENV',
    type: 'string',
    defaultValue: 'development',
    validate: (value) => ['development', 'production', 'test'].includes(value)
  },
  appName: {
    envVar: 'APP_NAME',
    type: 'string',
    defaultValue: 'PixiShelf API'
  },
  version: {
    envVar: 'APP_VERSION',
    type: 'string',
    defaultValue: '1.0.0'
  },

  // 扫描器配置
  'scanner.enableOptimizations': {
    envVar: 'SCANNER_ENABLE_OPTIMIZATIONS',
    type: 'boolean',
    defaultValue: true
  },
  'scanner.maxConcurrency': {
    envVar: 'SCANNER_MAX_CONCURRENCY',
    type: 'number',
    defaultValue: 8,
    validate: (value) => value > 0 && value <= 100
  },
  'scanner.batchSize': {
    envVar: 'SCANNER_BATCH_SIZE',
    type: 'number',
    defaultValue: 500,
    validate: (value) => value > 0 && value <= 10000
  },
  'scanner.cacheSizeLimit': {
    envVar: 'SCANNER_CACHE_SIZE_LIMIT',
    type: 'number',
    defaultValue: 10000,
    validate: (value) => value > 0
  },
  'scanner.enablePerformanceLogging': {
    envVar: 'SCANNER_ENABLE_PERFORMANCE_LOGGING',
    type: 'boolean',
    defaultValue: false
  },
  'scanner.performanceLogInterval': {
    envVar: 'SCANNER_PERFORMANCE_LOG_INTERVAL',
    type: 'number',
    defaultValue: 5000,
    validate: (value) => value >= 1000
  },

  // 数据库配置
  'database.url': {
    envVar: 'DATABASE_URL',
    type: 'string',
    required: true
  },
  'database.connectionLimit': {
    envVar: 'DATABASE_CONNECTION_LIMIT',
    type: 'number',
    defaultValue: 20,
    validate: (value) => value > 0 && value <= 200
  },
  'database.connectionTimeout': {
    envVar: 'DATABASE_CONNECTION_TIMEOUT',
    type: 'number',
    defaultValue: 30000,
    validate: (value) => value >= 5000
  },
  'database.queryTimeout': {
    envVar: 'DATABASE_QUERY_TIMEOUT',
    type: 'number',
    defaultValue: 60000,
    validate: (value) => value >= 5000
  },

  // 服务器配置
  'server.port': {
    envVar: 'PORT',
    type: 'number',
    defaultValue: 3002,
    validate: (value) => value > 0 && value <= 65535
  },
  'server.host': {
    envVar: 'HOST',
    type: 'string',
    defaultValue: '0.0.0.0'
  },
  'server.enableCors': {
    envVar: 'ENABLE_CORS',
    type: 'boolean',
    defaultValue: true
  },
  'server.bodyLimit': {
    envVar: 'BODY_LIMIT',
    type: 'string',
    defaultValue: '10mb'
  },
  'server.enableRequestLogging': {
    envVar: 'ENABLE_REQUEST_LOGGING',
    type: 'boolean',
    defaultValue: true
  },

  // 认证配置
  'auth.jwtSecret': {
    envVar: 'JWT_SECRET',
    type: 'string',
    required: true,
    validate: (value) => value.length >= 32
  },
  'auth.jwtExpiresIn': {
    envVar: 'JWT_EXPIRES_IN',
    type: 'string',
    defaultValue: '7d'
  },
  'auth.enableAuth': {
    envVar: 'ENABLE_AUTH',
    type: 'boolean',
    defaultValue: false
  },
  'auth.bcryptRounds': {
    envVar: 'BCRYPT_ROUNDS',
    type: 'number',
    defaultValue: 12,
    validate: (value) => value >= 10 && value <= 15
  },

  // 日志配置
  'log.level': {
    envVar: 'LOG_LEVEL',
    type: 'string',
    defaultValue: 'info',
    validate: (value) => ['debug', 'info', 'warn', 'error'].includes(value)
  },
  'log.enableFileLogging': {
    envVar: 'LOG_ENABLE_FILE_LOGGING',
    type: 'boolean',
    defaultValue: false
  },
  'log.logFilePath': {
    envVar: 'LOG_FILE_PATH',
    type: 'string'
  },
  'log.enableStructuredLogging': {
    envVar: 'LOG_ENABLE_STRUCTURED_LOGGING',
    type: 'boolean',
    defaultValue: true
  },
  'log.format': {
    envVar: 'LOG_FORMAT',
    type: 'string',
    defaultValue: 'pretty',
    validate: (value) => ['json', 'pretty'].includes(value)
  }
}

/**
 * 获取必需的环境变量
 */
export function getRequiredEnvVars(): string[] {
  return Object.values(envVarMapping)
    .filter((mapping) => mapping.required)
    .map((mapping) => mapping.envVar)
}

/**
 * 检查必需的环境变量是否已设置
 */
export function checkRequiredEnvVars(): { missing: string[]; isValid: boolean } {
  const required = getRequiredEnvVars()
  const missing = required.filter((envVar) => !process.env[envVar])

  return {
    missing,
    isValid: missing.length === 0
  }
}
