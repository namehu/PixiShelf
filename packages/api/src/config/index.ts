import { ConfigManager } from './ConfigManager'
import { AppConfig, ConfigValidationResult } from './types'
import { getDefaultConfig } from './defaults'
import { validateConfig } from './validator'
import { checkRequiredEnvVars } from './env-mapping'

// 创建全局配置管理器实例
const globalConfigManager = new ConfigManager()

/**
 * 初始化配置管理器
 */
export async function initializeConfig(): Promise<void> {
  await globalConfigManager.initialize()
}

/**
 * 获取完整配置
 */
export function getConfig(): AppConfig {
  return globalConfigManager.getConfig()
}

/**
 * 获取配置的某个部分
 */
export function getConfigSection<K extends keyof AppConfig>(section: K): AppConfig[K] {
  return globalConfigManager.getConfigSection(section)
}

/**
 * 获取特定配置值
 */
export function getConfigValue(path: string): any {
  return globalConfigManager.getConfigValue(path)
}

/**
 * 重新加载配置
 */
export async function reloadConfig(): Promise<void> {
  await globalConfigManager.reload()
}

/**
 * 验证配置
 */
export function validateCurrentConfig(): ConfigValidationResult {
  return globalConfigManager.validateConfig()
}

/**
 * 获取配置摘要
 */
export function getConfigSummary(): object {
  return globalConfigManager.getConfigSummary()
}

/**
 * 检查配置健康状态
 */
export function checkConfigHealth(): { isHealthy: boolean; issues: string[] } {
  return globalConfigManager.checkConfigHealth()
}

/**
 * 销毁配置管理器
 */
export function destroyConfig(): void {
  globalConfigManager.destroy()
}

// 便捷访问器
export const config = {
  get env() { return getConfigValue('env') },
  get appName() { return getConfigValue('appName') },
  get version() { return getConfigValue('version') },
  get isDevelopment() { return getConfigValue('env') === 'development' },
  get isProduction() { return getConfigValue('env') === 'production' },
  get server() { return getConfigSection('server') },
  get database() { return getConfigSection('database') },
  get auth() { return getConfigSection('auth') }
}

// 导出类型和工具函数
export type { AppConfig, ConfigValidationResult }
export { getDefaultConfig, validateConfig, checkRequiredEnvVars }
export { ConfigManager }
