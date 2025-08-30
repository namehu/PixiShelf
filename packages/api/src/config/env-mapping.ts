/**
 * 环境变量到配置路径的映射
 * 只包含项目实际使用的环境变量
 */
export const envVarMapping = {
  // 应用基础配置
  NODE_ENV: 'env',
  APP_NAME: 'appName',
  APP_VERSION: 'version',

  // 数据库配置
  DATABASE_URL: 'database.url',

  // 服务器配置
  PORT: 'server.port',
  HOST: 'server.host',

  // 认证配置
  JWT_SECRET: 'auth.jwtSecret'
} as const

/**
 * 获取必需的环境变量列表
 */
export function getRequiredEnvVars(): string[] {
  return ['DATABASE_URL', 'JWT_SECRET']
}

/**
 * 检查必需的环境变量是否已设置
 */
export function checkRequiredEnvVars(): {
  missing: string[]
  isValid: boolean
} {
  const required = getRequiredEnvVars()
  const missing = required.filter(envVar => !process.env[envVar])
  
  return {
    missing,
    isValid: missing.length === 0
  }
}
