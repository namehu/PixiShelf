import { ConfigManager } from './ConfigManager'
import { AppConfig, ConfigOverrides } from './types'
import { getEnvironmentOverrides } from './defaults'
import { checkRequiredEnvVars } from './env-mapping'
import { validateEnvironmentConsistency } from './validator'

/**
 * 全局配置管理器实例
 */
const globalConfigManager = new ConfigManager()

/**
 * 配置是否已初始化
 */
let isConfigInitialized = false

/**
 * 初始化全局配置
 * 应用启动时调用一次
 */
export async function initializeConfig(
  options: {
    configPath?: string
    useEnvVars?: boolean
    validate?: boolean
  } = {}
): Promise<void> {
  if (isConfigInitialized) {
    console.warn('Configuration is already initialized')
    return
  }

  try {
    // 检查必需的环境变量
    const envCheck = checkRequiredEnvVars()
    if (!envCheck.isValid) {
      console.error('Missing required environment variables:', envCheck.missing)
      console.log('\nExample .env file content:')
      throw new Error(`Missing required environment variables: ${envCheck.missing.join(', ')}`)
    }

    // 获取环境特定的配置覆盖
    const env = process.env.NODE_ENV || 'development'
    const envOverrides = getEnvironmentOverrides(env)

    // 初始化配置管理器
    await globalConfigManager.initialize({
      ...options,
      defaults: envOverrides
    })

    // 环境一致性检查
    const consistencyCheck = validateEnvironmentConsistency(globalConfigManager.getConfig())
    if (consistencyCheck.warnings.length > 0) {
      console.warn('Configuration warnings:', consistencyCheck.warnings)
    }
    if (!consistencyCheck.isValid) {
      throw new Error(`Environment consistency check failed: ${consistencyCheck.errors.join(', ')}`)
    }

    isConfigInitialized = true
    console.log(`Configuration initialized for ${env} environment`)
  } catch (error) {
    console.error('Failed to initialize configuration:', error)
    throw error
  }
}

/**
 * 获取完整配置
 * 提供完整的类型提示
 */
export function getConfig(): AppConfig {
  ensureInitialized()
  return globalConfigManager.getConfig()
}

/**
 * 获取特定配置节
 * 使用泛型提供精确的类型提示
 */
export function getConfigSection<K extends keyof AppConfig>(key: K): AppConfig[K] {
  ensureInitialized()
  return globalConfigManager.get(key)
}

/**
 * 获取嵌套配置值
 * 支持点号路径访问
 */
export function getConfigValue<T = any>(path: string): T {
  ensureInitialized()
  return globalConfigManager.getValue<T>(path)
}

/**
 * 更新配置
 */
export async function updateConfig(
  updates: ConfigOverrides,
  options?: {
    validate?: boolean
    persist?: boolean
    onUpdate?: (config: AppConfig) => void
  }
): Promise<void> {
  ensureInitialized()
  await globalConfigManager.updateConfig(updates, options)
}

/**
 * 设置特定配置值
 */
export async function setConfigValue(
  path: string,
  value: any,
  options?: {
    validate?: boolean
    persist?: boolean
  }
): Promise<void> {
  ensureInitialized()
  await globalConfigManager.setValue(path, value, options)
}

/**
 * 监听配置变化
 */
export function watchConfig(callback: (config: AppConfig) => void): () => void {
  ensureInitialized()
  return globalConfigManager.watch(callback)
}

/**
 * 重新加载配置
 */
export async function reloadConfig(): Promise<void> {
  ensureInitialized()
  await globalConfigManager.reload()
}

/**
 * 验证当前配置
 */
export function validateCurrentConfig() {
  ensureInitialized()
  return globalConfigManager.validateConfig()
}

/**
 * 获取配置摘要
 */
export function getConfigSummary() {
  ensureInitialized()
  return globalConfigManager.getConfigSummary()
}

/**
 * 导出配置到文件
 */
export async function exportConfig(filePath: string): Promise<void> {
  ensureInitialized()
  await globalConfigManager.exportConfig(filePath)
}

/**
 * 便捷的配置访问器
 * 提供常用配置的快速访问
 */
export const config = {
  /**
   * 应用配置
   */
  get app() {
    return {
      env: getConfigValue<string>('env'),
      name: getConfigValue<string>('appName'),
      version: getConfigValue<string>('version')
    }
  },

  /**
   * 服务器配置
   */
  get server() {
    return getConfigSection('server')
  },

  /**
   * 数据库配置
   */
  get database() {
    return getConfigSection('database')
  },

  /**
   * 认证配置
   */
  get auth() {
    return getConfigSection('auth')
  },

  /**
   * 日志配置
   */
  get log() {
    return getConfigSection('log')
  },

  /**
   * 是否为生产环境
   */
  get isProduction() {
    return getConfigValue<string>('env') === 'production'
  },

  /**
   * 是否为开发环境
   */
  get isDevelopment() {
    return getConfigValue<string>('env') === 'development'
  },

  /**
   * 是否为测试环境
   */
  get isTest() {
    return getConfigValue<string>('env') === 'test'
  }
}

/**
 * 类型安全的配置钩子
 * 用于React式的配置访问
 */
export function useConfig(): AppConfig
export function useConfig<K extends keyof AppConfig>(key: K): AppConfig[K]
export function useConfig<T = any>(path: string): T
export function useConfig<K extends keyof AppConfig, T = any>(keyOrPath?: K | string): AppConfig | AppConfig[K] | T {
  ensureInitialized()

  if (!keyOrPath) {
    return getConfig()
  }

  if (keyOrPath in getConfig()) {
    return getConfigSection(keyOrPath as K)
  }

  return getConfigValue<T>(keyOrPath as string)
}

/**
 * 配置装饰器
 * 用于类方法的配置注入
 */
export function ConfigInject(path?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value

    descriptor.value = function (...args: any[]) {
      const configValue = path ? getConfigValue(path) : getConfig()
      return originalMethod.call(this, configValue, ...args)
    }

    return descriptor
  }
}

/**
 * 确保配置已初始化
 */
function ensureInitialized(): void {
  if (!isConfigInitialized) {
    throw new Error('Configuration is not initialized. Call initializeConfig() first.')
  }
}

/**
 * 检查配置健康状态
 */
export function checkConfigHealth(): {
  isHealthy: boolean
  issues: string[]
  recommendations: string[]
} {
  try {
    ensureInitialized()

    const validation = validateCurrentConfig()
    const consistency = validateEnvironmentConsistency(getConfig())
    const issues: string[] = []
    const recommendations: string[] = []

    issues.push(...validation.errors, ...consistency.errors)
    recommendations.push(...validation.warnings, ...consistency.warnings)

    return {
      isHealthy: issues.length === 0,
      issues,
      recommendations
    }
  } catch (error) {
    return {
      isHealthy: false,
      issues: [(error as Error).message],
      recommendations: ['Initialize configuration properly']
    }
  }
}

// 导出类型
export * from './types'
export { ConfigManager } from './ConfigManager'
export { validateConfig, validateEnvironmentConsistency } from './validator'
export { getDefaultConfig } from './defaults'
export { checkRequiredEnvVars } from './env-mapping'
