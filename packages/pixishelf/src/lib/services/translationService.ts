/**
 * 翻译服务 - 集成WZH-Wbot翻译API
 * 支持单个和批量翻译，包含错误处理和重试机制
 */

export interface TranslationResult {
  originalText: string
  translatedText: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  success: boolean
  error?: string
}

export interface WZHBotResponse {
  response: {
    translated_text: string
    usage: {
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
    }
  }
}

export interface TranslationService {
  translateText(text: string): Promise<TranslationResult>
  translateBatch(texts: string[], batchSize?: number): Promise<TranslationResult[]>
}

export interface RetryConfig {
  maxRetries: number
  retryDelay: number
  backoffMultiplier: number
}

export class WZHBotTranslationService implements TranslationService {
  private readonly apiUrl = 'https://aify.api.ecylt.top'
  private readonly retryConfig: RetryConfig = {
    maxRetries: 3,
    retryDelay: 1000,
    backoffMultiplier: 2
  }
  private readonly timeout = 10000 // 10秒超时

  /**
   * 翻译单个文本
   */
  async translateText(text: string): Promise<TranslationResult> {
    if (!text || text.trim().length === 0) {
      return {
        originalText: text,
        translatedText: text,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        success: true
      }
    }

    return this.withRetry(() => this.callTranslationAPI(text))
  }

  /**
   * 批量翻译文本
   */
  async translateBatch(texts: string[], batchSize = 20): Promise<TranslationResult[]> {
    if (!texts || texts.length === 0) {
      return []
    }

    const batches = this.chunkArray(texts, batchSize)
    const results: TranslationResult[] = []

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]!
      console.log(`Processing batch ${i + 1}/${batches.length} (${batch.length} items)`)

      try {
        // 并发处理批次内的翻译请求
        const batchResults = await Promise.allSettled(batch.map((text) => this.translateText(text)))

        const processedResults = this.processBatchResults(batchResults)
        results.push(...processedResults)

        // 批次间添加延迟避免API限流
        if (i < batches.length - 1) {
          await this.delay(500)
        }
      } catch (error) {
        console.error(`Batch ${i + 1} failed:`, error)

        // 为失败的批次创建错误结果
        const errorResults = batch.map((text) => ({
          originalText: text,
          translatedText: text,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          success: false,
          error: error instanceof Error ? error.message : 'Unknown batch error'
        }))

        results.push(...errorResults)
      }
    }

    return results
  }

  /**
   * 带重试机制的操作执行
   */
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error

    for (let attempt = 1; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error as Error
        console.warn(`Translation attempt ${attempt} failed:`, error)

        if (attempt < this.retryConfig.maxRetries) {
          const delay = this.retryConfig.retryDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1)
          console.log(`Retrying in ${delay}ms...`)
          await this.delay(delay)
        }
      }
    }

    throw lastError!
  }

  /**
   * 调用WZH-Wbot翻译API
   */
  private async callTranslationAPI(text: string): Promise<TranslationResult> {
    const url = `${this.apiUrl}?text=${encodeURIComponent(text)}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        },
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`Translation API error: ${response.status} ${response.statusText}`)
      }

      const data: WZHBotResponse = await response.json()

      if (!data.response || !data.response.translated_text) {
        throw new Error('Invalid API response format')
      }

      return {
        originalText: text,
        translatedText: data.response.translated_text,
        usage: {
          promptTokens: data.response.usage.prompt_tokens,
          completionTokens: data.response.usage.completion_tokens,
          totalTokens: data.response.usage.total_tokens
        },
        success: true
      }
    } catch (error) {
      clearTimeout(timeoutId)

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Translation request timeout after ${this.timeout}ms`)
      }

      throw error
    }
  }

  /**
   * 处理批量翻译结果
   */
  private processBatchResults(results: PromiseSettledResult<TranslationResult>[]): TranslationResult[] {
    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value
      } else {
        console.error(`Translation ${index} failed:`, result.reason)
        return {
          originalText: '',
          translatedText: '',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          success: false,
          error: result.reason instanceof Error ? result.reason.message : 'Unknown error'
        }
      }
    })
  }

  /**
   * 将数组分割成指定大小的批次
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size))
    }
    return chunks
  }

  /**
   * 延迟执行
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * 获取翻译服务统计信息
   */
  getStats() {
    return {
      apiUrl: this.apiUrl,
      retryConfig: this.retryConfig,
      timeout: this.timeout
    }
  }
}

/**
 * 默认翻译服务实例
 */
export const translationService = new WZHBotTranslationService()

/**
 * 翻译服务工厂函数
 */
export function createTranslationService(config?: Partial<RetryConfig>): WZHBotTranslationService {
  const service = new WZHBotTranslationService()
  if (config) {
    Object.assign(service['retryConfig'], config)
  }
  return service
}
