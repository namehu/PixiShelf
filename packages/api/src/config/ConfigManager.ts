import { promises as fs } from 'fs'
import path from 'path'
import { AppConfig, ConfigLoadOptions, ConfigUpdateOptions, ConfigValidationResult, ConfigOverrides } from './types'
import { getDefaultConfig } from './defaults'
import { validateConfig } from './validator'
import { envVarMapping } from './env-mapping'

/**
 * 全局配置管理器
 * 提供配置加载、验证、更新、持久化等功能
 */
export class ConfigManager {
  private config: AppConfig
  private configPath?: string
  private watchers: Array<(config: AppConfig) => void> = []
  private isInitialized = false

  constructor() {
    this.config = getDefaultConfig()
  }

  /**
   * 初始化配置管理器
   */
  async initialize(options: ConfigLoadOptions = {}): Promise<void> {
    if (this.isInitialized) {
      throw new Error('ConfigManager is already initialized')
    }

    const { configPath, useEnvVars = true, validate = true, defaults } = options

    // 1. 加载默认配置
    this.config = defaults ? this.deepMerge(getDefaultConfig(), defaults) : getDefaultConfig()

    // 2. 从配置文件加载
    if (configPath) {
      await this.loadFromFile(configPath)
      this.configPath = configPath
    }

    // 3. 从环境变量加载
    if (useEnvVars) {
      this.loadFromEnv()
    }

    // 4. 验证配置
    if (validate) {
      const validation = this.validateConfig()
      if (!validation.isValid) {
        throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`)
      }
      if (validation.warnings.length > 0) {
        console.warn('Configuration warnings:', validation.warnings)
      }
    }

    this.isInitialized = true
  }

  /**
   * 获取完整配置
   */
  getConfig(): AppConfig {
    this.ensureInitialized()
    return { ...this.config }
  }

  /**
   * 获取特定配置节
   */
  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    this.ensureInitialized()
    return this.config[key]
  }

  /**
   * 获取嵌套配置值
   */
  getValue<T = any>(path: string): T {
    this.ensureInitialized()
    return this.getNestedValue(this.config, path)
  }

  /**
   * 更新配置
   */
  async updateConfig(updates: ConfigOverrides, options: ConfigUpdateOptions = {}): Promise<void> {
    this.ensureInitialized()

    const { validate = true, persist = false, onUpdate } = options

    // 合并配置
    const newConfig = this.deepMerge(this.config, updates)

    // 验证新配置
    if (validate) {
      const validation = validateConfig(newConfig)
      if (!validation.isValid) {
        throw new Error(`Configuration update validation failed: ${validation.errors.join(', ')}`)
      }
    }

    // 更新配置
    const oldConfig = { ...this.config }
    this.config = newConfig

    // 持久化配置
    if (persist && this.configPath) {
      await this.saveToFile(this.configPath)
    }

    // 通知观察者
    this.notifyWatchers(this.config)

    // 执行回调
    if (onUpdate) {
      onUpdate(this.config)
    }
  }

  /**
   * 设置特定配置值
   */
  async setValue(path: string, value: any, options: ConfigUpdateOptions = {}): Promise<void> {
    this.ensureInitialized()

    const updates = this.setNestedValue({}, path, value)
    await this.updateConfig(updates, options)
  }

  /**
   * 重新加载配置
   */
  async reload(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('ConfigManager is not initialized')
    }

    // 重置为默认配置
    this.config = getDefaultConfig()

    // 重新加载
    if (this.configPath) {
      await this.loadFromFile(this.configPath)
    }
    this.loadFromEnv()

    // 通知观察者
    this.notifyWatchers(this.config)
  }

  /**
   * 验证当前配置
   */
  validateConfig(): ConfigValidationResult {
    return validateConfig(this.config)
  }

  /**
   * 监听配置变化
   */
  watch(callback: (config: AppConfig) => void): () => void {
    this.watchers.push(callback)

    // 返回取消监听的函数
    return () => {
      const index = this.watchers.indexOf(callback)
      if (index > -1) {
        this.watchers.splice(index, 1)
      }
    }
  }

  /**
   * 获取配置摘要信息
   */
  getConfigSummary(): {
    env: string
    initialized: boolean
    configPath?: string
    lastUpdated: Date
    validation: ConfigValidationResult
  } {
    return {
      env: this.config.env,
      initialized: this.isInitialized,
      configPath: this.configPath,
      lastUpdated: new Date(),
      validation: this.validateConfig()
    }
  }

  /**
   * 导出配置到文件
   */
  async exportConfig(filePath: string): Promise<void> {
    this.ensureInitialized()
    await this.saveToFile(filePath)
  }

  /**
   * 从文件加载配置
   */
  private async loadFromFile(filePath: string): Promise<void> {
    try {
      const configContent = await fs.readFile(filePath, 'utf-8')
      const fileConfig = JSON.parse(configContent)
      this.config = this.deepMerge(this.config, fileConfig)
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        console.warn(`Configuration file not found: ${filePath}`)
      } else {
        throw new Error(`Failed to load configuration from ${filePath}: ${(error as Error).message}`)
      }
    }
  }

  /**
   * 从环境变量加载配置
   */
  private loadFromEnv(): void {
    const envConfig: any = {}

    for (const [configPath, mapping] of Object.entries(envVarMapping)) {
      const envValue = process.env[mapping.envVar]

      if (envValue !== undefined) {
        const parsedValue = this.parseEnvValue(envValue, mapping.type)

        if (mapping.validate && !mapping.validate(parsedValue)) {
          console.warn(`Invalid environment variable value for ${mapping.envVar}: ${envValue}`)
          continue
        }

        this.setNestedValue(envConfig, configPath, parsedValue)
      } else if (mapping.required) {
        throw new Error(`Required environment variable ${mapping.envVar} is not set`)
      } else if (mapping.defaultValue !== undefined) {
        this.setNestedValue(envConfig, configPath, mapping.defaultValue)
      }
    }

    this.config = this.deepMerge(this.config, envConfig)
  }

  /**
   * 保存配置到文件
   */
  private async saveToFile(filePath: string): Promise<void> {
    try {
      const configDir = path.dirname(filePath)
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(filePath, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (error) {
      throw new Error(`Failed to save configuration to ${filePath}: ${(error as Error).message}`)
    }
  }

  /**
   * 解析环境变量值
   */
  private parseEnvValue(value: string, type: 'string' | 'number' | 'boolean'): any {
    switch (type) {
      case 'string':
        return value
      case 'number':
        const num = Number(value)
        if (isNaN(num)) {
          throw new Error(`Invalid number value: ${value}`)
        }
        return num
      case 'boolean':
        return value.toLowerCase() === 'true'
      default:
        return value
    }
  }

  /**
   * 深度合并对象
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target }

    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key])
      } else {
        result[key] = source[key]
      }
    }

    return result
  }

  /**
   * 获取嵌套值
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj)
  }

  /**
   * 设置嵌套值
   */
  private setNestedValue(obj: any, path: string, value: any): any {
    const keys = path.split('.')
    const lastKey = keys.pop()!

    const target = keys.reduce((current, key) => {
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {}
      }
      return current[key]
    }, obj)

    target[lastKey] = value
    return obj
  }

  /**
   * 通知观察者
   */
  private notifyWatchers(config: AppConfig): void {
    this.watchers.forEach((callback) => {
      try {
        callback(config)
      } catch (error) {
        console.error('Error in config watcher:', error)
      }
    })
  }

  /**
   * 确保已初始化
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('ConfigManager is not initialized. Call initialize() first.')
    }
  }
}
