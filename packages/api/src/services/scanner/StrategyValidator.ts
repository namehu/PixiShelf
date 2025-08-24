import { ScanStrategyType } from '@pixishelf/shared'

/**
 * 策略验证器
 * 负责验证扫描策略的有效性和提供策略相关的工具方法
 */
export class StrategyValidator {
  private static readonly VALID_STRATEGIES: ScanStrategyType[] = ['legacy', 'unified']
  private static readonly DEFAULT_STRATEGY: ScanStrategyType = 'unified'
  
  /**
   * 验证策略是否支持
   * @param strategy 策略名称
   * @returns 验证后的策略类型
   * @throws UnsupportedStrategyError 当策略不支持时
   */
  static validate(strategy: string): ScanStrategyType {
    if (!this.VALID_STRATEGIES.includes(strategy as ScanStrategyType)) {
      throw new UnsupportedStrategyError(
        `Strategy '${strategy}' is not supported. Available strategies: ${this.VALID_STRATEGIES.join(', ')}`
      )
    }
    return strategy as ScanStrategyType
  }
  
  /**
   * 获取默认策略
   * @returns 默认策略类型
   */
  static getDefault(): ScanStrategyType {
    return this.DEFAULT_STRATEGY
  }
  
  /**
   * 获取所有支持的策略
   * @returns 支持的策略列表
   */
  static getValidStrategies(): ScanStrategyType[] {
    return [...this.VALID_STRATEGIES]
  }
  
  /**
   * 检查策略是否支持
   * @param strategy 策略名称
   * @returns 是否支持
   */
  static isSupported(strategy: string): boolean {
    return this.VALID_STRATEGIES.includes(strategy as ScanStrategyType)
  }
  
  /**
   * 迁移不支持的策略到默认策略
   * @param oldStrategy 旧策略名称
   * @returns 迁移后的策略
   */
  static migrateStrategy(oldStrategy: string): ScanStrategyType {
    const removedStrategies = ['metadata', 'media', 'full']
    if (removedStrategies.includes(oldStrategy)) {
      return this.DEFAULT_STRATEGY
    }
    return this.validate(oldStrategy)
  }
  
  /**
   * 获取策略错误信息
   * @param strategy 无效的策略名称
   * @returns 错误信息对象
   */
  static getStrategyError(strategy: string): {
    statusCode: 400
    error: 'Bad Request'
    message: string
    availableStrategies: ScanStrategyType[]
    suggestedStrategy: ScanStrategyType
  } {
    const removedStrategies: Record<string, string> = {
      metadata: 'Metadata-only scanning has been merged into unified scanning for better performance.',
      media: 'Media-only scanning has been merged into unified scanning for better consistency.',
      full: 'Full scanning has been replaced by unified scanning with improved architecture.'
    }
    
    const specificMessage = removedStrategies[strategy] || 
      `Strategy '${strategy}' is not supported.`
    
    return {
      statusCode: 400,
      error: 'Bad Request',
      message: `${specificMessage} Available strategies: ${this.VALID_STRATEGIES.join(', ')}`,
      availableStrategies: this.getValidStrategies(),
      suggestedStrategy: this.getDefault()
    }
  }
}

/**
 * 不支持的策略错误
 */
export class UnsupportedStrategyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedStrategyError'
  }
}