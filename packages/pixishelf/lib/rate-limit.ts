/**
 * A simple in-memory rate limiter.
 *
 * Note: This implementation stores rate limit data in memory.
 * If you are deploying to a serverless environment (like Vercel) or a cluster,
 * this will only limit requests per instance.
 * For a production-grade distributed rate limiter, consider using Redis (e.g., @upstash/ratelimit).
 */

type Options = {
  interval?: number // Window size in ms
  uniqueTokenPerInterval?: number // Max number of unique tokens per interval (not used in simple implementation)
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

// Global rate limiter instance
// Default: 60 seconds window
export const rateLimiter = new RateLimit({
  interval: 60000
})
