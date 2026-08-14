import { headers } from 'next/headers'
import { rateLimiter } from './rate-limit'

export async function checkRateLimit(limit: number = 10, prefix: string = 'global') {
  const headersList = await headers()
  // X-Forwarded-For 按“客户端、第一层代理、后续代理”排列，仅取最左侧客户端地址。
  const forwardedFor = headersList.get('x-forwarded-for')
  const ip = forwardedFor ? forwardedFor.split(',').map((x) => x.trim())[0] : 'unknown'

  return rateLimiter.check(limit, `${prefix}:${ip}`)
}
