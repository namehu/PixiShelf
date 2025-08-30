/**
 * 全局配置类型定义
 * 提供完整的类型安全和智能提示
 */

// 数据库配置
export interface DatabaseConfig {
  /** 数据库连接URL */
  url: string
  /** 连接池大小 */
  connectionLimit: number
  /** 连接超时时间（毫秒） */
  connectionTimeout: number
  /** 查询超时时间（毫秒） */
  queryTimeout: number
}

// 服务器配置
export interface ServerConfig {
  /** 服务器端口 */
  port: number
  /** 服务器主机 */
  host: string
  /** 是否启用CORS */
  enableCors: boolean
  /** 请求体大小限制 */
  bodyLimit: string
  /** 是否启用请求日志 */
  enableRequestLogging: boolean
}

// 认证配置
export interface AuthConfig {
  /** JWT密钥 */
  jwtSecret: string
  /** JWT过期时间 */
  jwtExpiresIn: string
  /** 是否启用认证 */
  enableAuth: boolean
  /** 密码加密轮数 */
  bcryptRounds: number
}

// 日志配置
export interface LogConfig {
  /** 日志级别 */
  level: 'debug' | 'info' | 'warn' | 'error'
  /** 是否启用文件日志 */
  enableFileLogging: boolean
  /** 日志文件路径 */
  logFilePath?: string
  /** 是否启用结构化日志 */
  enableStructuredLogging: boolean
  /** 日志格式 */
  format: 'json' | 'pretty'
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
  /** 日志配置 */
  log: LogConfig
}

// 深度Partial类型
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

// 配置更新选项
export type ConfigUpdateOptions = {
  /** 是否验证配置 */
  validate?: boolean
  /** 是否持久化配置 */
  persist?: boolean
  /** 更新回调 */
  onUpdate?: (config: AppConfig) => void
}

// 配置覆盖类型
export type ConfigOverrides = DeepPartial<AppConfig>

// 配置验证结果
export interface ConfigValidationResult {
  /** 是否有效 */
  isValid: boolean
  /** 错误信息 */
  errors: string[]
  /** 警告信息 */
  warnings: string[]
}

// 配置加载选项
export interface ConfigLoadOptions {
  /** 配置文件路径 */
  configPath?: string
  /** 是否使用环境变量 */
  useEnvVars?: boolean
  /** 是否验证配置 */
  validate?: boolean
  /** 默认配置 */
  defaults?: ConfigOverrides
}

// 环境变量映射
export interface EnvVarMapping {
  [key: string]: {
    /** 环境变量名 */
    envVar: string
    /** 数据类型 */
    type: 'string' | 'number' | 'boolean'
    /** 默认值 */
    defaultValue?: any
    /** 是否必需 */
    required?: boolean
    /** 验证函数 */
    validate?: (value: any) => boolean
  }
}
