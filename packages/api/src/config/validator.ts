import { AppConfig, ConfigValidationResult } from './types'

/**
 * 配置验证器
 * 验证配置的完整性和有效性
 */
export function validateConfig(config: AppConfig): ConfigValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // 验证应用基础配置
  if (!config.env) {
    errors.push('env is required')
  } else if (!['development', 'production', 'test'].includes(config.env)) {
    errors.push('env must be one of: development, production, test')
  }

  if (!config.appName || config.appName.trim().length === 0) {
    errors.push('appName is required and cannot be empty')
  }

  if (!config.version || config.version.trim().length === 0) {
    errors.push('version is required and cannot be empty')
  }

  // 验证数据库配置
  if (!config.database.url || config.database.url.trim().length === 0) {
    errors.push('database.url is required and cannot be empty')
  }

  // 验证服务器配置
  if (!Number.isInteger(config.server.port) || config.server.port <= 0 || config.server.port > 65535) {
    errors.push('server.port must be an integer between 1 and 65535')
  }

  if (!config.server.host || config.server.host.trim().length === 0) {
    errors.push('server.host is required and cannot be empty')
  }

  // 验证认证配置
  if (!config.auth.jwtSecret || config.auth.jwtSecret.trim().length === 0) {
    errors.push('auth.jwtSecret is required and cannot be empty')
  } else if (config.auth.jwtSecret.length < 32) {
    errors.push('auth.jwtSecret must be at least 32 characters long')
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * 快速验证配置的关键字段
 */
export function quickValidate(config: Partial<AppConfig>): boolean {
  try {
    // 检查必需字段
    if (!config.database?.url) return false
    if (!config.auth?.jwtSecret) return false
    if (!config.server?.port) return false

    return true
  } catch {
    return false
  }
}
