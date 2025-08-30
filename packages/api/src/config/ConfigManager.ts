import { AppConfig, ConfigValidationResult } from './types'
import { getDefaultConfig } from './defaults'
import { validateConfig } from './validator'

/**
 * 配置管理器类
 * 负责配置的加载、验证和获取
 */
export class ConfigManager {
  private config: AppConfig
  private isInitialized: boolean = false

  constructor() {
    this.config = getDefaultConfig()
  }

  /**
   * 初始化配置管理器
   */
  async initialize(): Promise<void> {
    try {
      // 1. 加载默认配置
      this.config = getDefaultConfig()

      // 2. 验证配置
      const validation = this.validateConfig()
      if (!validation.isValid) {
        throw new Error(`配置验证失败: ${validation.errors.join(', ')}`)
      }

      this.isInitialized = true
    } catch (error) {
      throw error
    }
  }

  /**
   * 获取完整配置
   */
  getConfig(): AppConfig {
    this.ensureInitialized()
    return { ...this.config }
  }

  /**
   * 获取配置的某个部分
   */
  getConfigSection<K extends keyof AppConfig>(section: K): AppConfig[K] {
    this.ensureInitialized()
    return this.config[section]
  }

  /**
   * 获取特定配置值
   */
  getConfigValue(path: string): any {
    this.ensureInitialized()
    const keys = path.split('.')
    let current: any = this.config

    for (const key of keys) {
      if (current && current[key] !== undefined) {
        current = current[key]
      } else {
        return undefined
      }
    }

    return current
  }

  /**
   * 重新加载配置
   */
  async reload(): Promise<void> {
    this.isInitialized = false
    await this.initialize()
  }

  /**
   * 验证当前配置
   */
  validateConfig(): ConfigValidationResult {
    return validateConfig(this.config)
  }

  /**
   * 检查配置健康状态
   */
  checkConfigHealth(): { isHealthy: boolean; issues: string[] } {
    this.ensureInitialized()
    const issues: string[] = []
    
    // 检查必需的配置项
    if (!this.config.database.url) {
      issues.push('数据库URL未配置')
    }
    
    if (!this.config.auth.jwtSecret) {
      issues.push('JWT密钥未配置')
    }
    
    if (!this.config.server.port) {
      issues.push('服务器端口未配置')
    }
    
    return {
      isHealthy: issues.length === 0,
      issues
    }
  }

  /**
   * 获取配置摘要（用于日志记录）
   */
  getConfigSummary(): object {
    this.ensureInitialized()
    return {
      env: this.config.env,
      appName: this.config.appName,
      version: this.config.version,
      database: {
        url: this.config.database.url ? '[已设置]' : '[未设置]'
      },
      server: {
        port: this.config.server.port,
        host: this.config.server.host
      },
      auth: {
        jwtSecret: this.config.auth.jwtSecret ? '[已设置]' : '[未设置]'
      }
    }
  }

  /**
   * 确保已初始化
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('ConfigManager is not initialized. Call initialize() first.')
    }
  }

  /**
   * 销毁配置管理器
   */
  destroy(): void {
    this.isInitialized = false
  }
}
