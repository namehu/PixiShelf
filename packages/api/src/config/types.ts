/**
 * 简化的配置类型定义
 * 只包含项目实际使用的配置项
 */

// 数据库配置
export interface DatabaseConfig {
  /** 数据库连接URL */
  url: string
}

// 服务器配置
export interface ServerConfig {
  /** 服务器端口 */
  port: number
  /** 服务器主机 */
  host: string
}

// 认证配置
export interface AuthConfig {
  /** JWT密钥 */
  jwtSecret: string
}

// 应用配置（根配置）
export interface AppConfig {
  /** 环境类型 */
  env: 'development' | 'production' | 'test'
  /** 应用名称 */
  appName: string
  /** 应用版本 */
  version: string
  /** 数据库配置 */
  database: DatabaseConfig
  /** 服务器配置 */
  server: ServerConfig
  /** 认证配置 */
  auth: AuthConfig
}

// 配置验证结果
export interface ConfigValidationResult {
  /** 是否有效 */
  isValid: boolean
  /** 错误信息 */
  errors: string[]
  /** 警告信息 */
  warnings: string[]
}
