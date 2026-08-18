import type { JsonValue } from '@pixishelf/job-contracts'

const sensitiveKey =
  /(?:apiKey|accessToken|authorization|connectionString|cookie|credential|databaseUrl|dsn|password|privateKey|secret|token)/i
const sensitiveTextField =
  '(?:apiKey|accessToken|authorization|connectionString|cookie|credential|databaseUrl|dsn|password|privateKey|secret|token)'
const DEFAULT_WIRE_TEXT_LIMIT = 4_096
const HTTP_URL_IN_TEXT = /https?:\/\/[^\s<>{}[\]"']+/gi
const TRAILING_PUNCTUATION = /[),.;!?]+$/

export type WireTextRedactor = (value: string | null, maxLength?: number) => string | null

// 供 wire 日志统一使用的低层脱敏入口；archive 场景会复用同一套规则避免各处脱敏边界不一致。
export function redactSensitiveText(value: string | null, maxLength = DEFAULT_WIRE_TEXT_LIMIT): string | null {
  if (value === null) return null
  const redacted = value
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi, '$1[REDACTED]@')
    .replace(/(bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(
      /([?&](?:access_token|accessToken|api_key|apiKey|authorization|databaseUrl|dsn|password|secret|token)=)[^&#\s]+/gi,
      '$1[REDACTED]'
    )
    .replace(new RegExp(`(${sensitiveTextField}["']?\\s*[:=]\\s*["']?)[^\\s,;}"']+`, 'gi'), '$1[REDACTED]')
  return redacted.slice(0, maxLength)
}

// archive 场景的 URL 按“协议/域名/首路径段”裁剪，避免完整 URL 泄露目录、对象和签名参数。
export function redactHttpUrlPaths(value: string): string {
  return value.replace(HTTP_URL_IN_TEXT, (matched) => {
    const trailing = matched.match(TRAILING_PUNCTUATION)?.[0] ?? ''
    const candidate = trailing ? matched.slice(0, -trailing.length) : matched
    try {
      const url = new URL(candidate)
      const firstPathSegment = url.pathname.split('/').filter(Boolean)[0]
      const redacted = `${url.protocol}//${url.host}${firstPathSegment ? `/${firstPathSegment}/…` : '/…'}`
      return `${redacted}${trailing}`
    } catch {
      return `[REDACTED_URL]${trailing}`
    }
  })
}

export function sanitizeJsonValue(
  value: unknown,
  redactText: WireTextRedactor = redactSensitiveText
): JsonValue | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return redactText(value) ?? ''
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map((nested) => sanitizeJsonValue(nested, redactText))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        sensitiveKey.test(key) ? '[REDACTED]' : sanitizeJsonValue(nested, redactText)
      ])
    )
  }
  return String(value)
}
