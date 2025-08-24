import { ScanStrategyType } from '@pixishelf/shared'
import { StrategyValidator } from './StrategyValidator'

/**
 * 配置迁移器
 * 负责将旧的配置自动迁移到新的支持策略
 */
export class ConfigMigrator {
  /**
   * 迁移策略配置
   * @param config 配置对象
   * @returns 迁移后的配置对象
   */
  static migrateStrategyConfig(config: any): any {
    const migratedConfig = { ...config }
    let migrationOccurred = false
    
    // 迁移 scanType 字段
    if (config.scanType && !StrategyValidator.isSupported(config.scanType)) {
      const oldStrategy = config.scanType
      migratedConfig.scanType = StrategyValidator.getDefault()
      
      console.warn(
        `Strategy '${oldStrategy}' is no longer supported. ` +
        `Automatically migrated to '${migratedConfig.scanType}' strategy.`
      )
      
      migrationOccurred = true
    }
    
    // 迁移 defaultStrategy 字段
    if (config.defaultStrategy && !StrategyValidator.isSupported(config.defaultStrategy)) {
      const oldStrategy = config.defaultStrategy
      migratedConfig.defaultStrategy = StrategyValidator.getDefault()
      
      console.warn(
        `Default strategy '${oldStrategy}' is no longer supported. ` +
        `Automatically migrated to '${migratedConfig.defaultStrategy}' strategy.`
      )
      
      migrationOccurred = true
    }
    
    // 记录迁移统计
    if (migrationOccurred) {
      this.recordMigration(config, migratedConfig)
    }
    
    return migratedConfig
  }
  
  /**
   * 检查配置是否需要迁移
   * @param config 配置对象
   * @returns 是否需要迁移
   */
  static needsMigration(config: any): boolean {
    const fieldsToCheck = ['scanType', 'defaultStrategy']
    
    return fieldsToCheck.some(field => {
      return config[field] && !StrategyValidator.isSupported(config[field])
    })
  }
  
  /**
   * 获取迁移建议
   * @param config 配置对象
   * @returns 迁移建议信息
   */
  static getMigrationSuggestions(config: any): {
    needsMigration: boolean
    suggestions: Array<{
      field: string
      currentValue: string
      suggestedValue: ScanStrategyType
      reason: string
    }>
  } {
    const suggestions: Array<{
      field: string
      currentValue: string
      suggestedValue: ScanStrategyType
      reason: string
    }> = []
    
    const fieldsToCheck = [
      { field: 'scanType', description: 'scan type' },
      { field: 'defaultStrategy', description: 'default strategy' }
    ]
    
    fieldsToCheck.forEach(({ field, description }) => {
      if (config[field] && !StrategyValidator.isSupported(config[field])) {
        suggestions.push({
          field,
          currentValue: config[field],
          suggestedValue: StrategyValidator.getDefault(),
          reason: `${description} '${config[field]}' is no longer supported`
        })
      }
    })
    
    return {
      needsMigration: suggestions.length > 0,
      suggestions
    }
  }
  
  /**
   * 记录迁移统计
   * @param originalConfig 原始配置
   * @param migratedConfig 迁移后配置
   */
  private static recordMigration(originalConfig: any, migratedConfig: any): void {
    const migrationInfo = {
      timestamp: new Date().toISOString(),
      originalConfig: {
        scanType: originalConfig.scanType,
        defaultStrategy: originalConfig.defaultStrategy
      },
      migratedConfig: {
        scanType: migratedConfig.scanType,
        defaultStrategy: migratedConfig.defaultStrategy
      }
    }
    
    // 这里可以添加到监控系统或日志系统
    console.info('Configuration migration completed:', migrationInfo)
  }
}

/**
 * 迁移统计管理器
 */
export class MigrationStats {
  private static migrations = new Map<string, number>()
  
  /**
   * 记录迁移事件
   * @param from 原策略
   * @param to 目标策略
   */
  static recordMigration(from: string, to: string): void {
    const key = `${from}->${to}`
    const count = this.migrations.get(key) || 0
    this.migrations.set(key, count + 1)
  }
  
  /**
   * 获取迁移统计
   * @returns 迁移统计数据
   */
  static getStats(): Record<string, number> {
    return Object.fromEntries(this.migrations)
  }
  
  /**
   * 清除统计数据
   */
  static clearStats(): void {
    this.migrations.clear()
  }
}

/**
 * 迁移日志记录器
 */
export class MigrationLogger {
  /**
   * 记录策略迁移日志
   * @param from 原策略
   * @param to 目标策略
   * @param context 上下文信息
   */
  static logStrategyMigration(from: string, to: ScanStrategyType, context?: any): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      fromStrategy: from,
      toStrategy: to,
      reason: 'Strategy no longer supported',
      context
    }
    
    console.info('Strategy migration:', logEntry)
    
    // 记录到统计
    MigrationStats.recordMigration(from, to)
  }
}