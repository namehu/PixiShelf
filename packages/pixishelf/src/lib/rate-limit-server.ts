import { headers } from 'next/headers'
import { rateLimiter } from './rate-limit'

export async function checkRateLimit(limit: number = 10, prefix: string = 'global') {
  const headersList = await headers()
  // Handle X-Forwarded-For: client, proxy1, proxy2
  const forwardedFor = headersList.get('x-forwarded-for')
  const ip = forwardedFor ? forwardedFor.split(',').map((x) => x.trim())[0] : 'unknown'

  return rateLimiter.check(limit, `${prefix}:${ip}`)
}
