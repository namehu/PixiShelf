/**
 * 简单的进程内限流器。
 *
 * 限流状态只保存在当前进程内；部署到无服务器平台或集群时，各实例会分别计数，
 * 不能提供全局限流保证。需要分布式限流时应改用 Redis 等共享存储。
 */

type Options = {
  interval?: number // 时间窗口，单位为毫秒
  uniqueTokenPerInterval?: number // 每个窗口允许的唯一令牌数；当前简化实现暂未使用
}

export class RateLimit {
  private tokens: Map<string, number[]>
  private interval: number

  constructor(options?: Options) {
    this.tokens = new Map()
    this.interval = options?.interval || 60000
  }

  check(limit: number, token: string) {
    const now = Date.now()
    const windowStart = now - this.interval

    const tokenCount = this.tokens.get(token) || []
    const validTokenCount = tokenCount.filter((timestamp) => timestamp > windowStart)

    if (validTokenCount.length >= limit) {
      return false
    }

    validTokenCount.push(now)
    this.tokens.set(token, validTokenCount)

    return true
  }
}

// 全局限流实例，默认使用 60 秒窗口。
export const rateLimiter = new RateLimit({
  interval: 60000
})
