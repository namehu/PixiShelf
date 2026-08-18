import { redactSensitiveText } from '@/services/background-task/job-serialization'

const HTTP_URL_IN_TEXT = /https?:\/\/[^\s<>{}[\]"']+/gi
const TRAILING_PUNCTUATION = /[),.;!?]+$/

export function redactArchiveUrl(input: string): string {
  try {
    const url = new URL(input)
    const firstPathSegment = url.pathname.split('/').filter(Boolean)[0]
    return `${url.protocol}//${url.host}${firstPathSegment ? `/${firstPathSegment}/…` : '/…'}`
  } catch {
    return '[REDACTED_URL]'
  }
}

export function redactArchiveText(value: string | null, maxLength?: number): string | null {
  if (value === null) return null
  const redactedUrls = value.replace(HTTP_URL_IN_TEXT, (matched) => {
    const trailing = matched.match(TRAILING_PUNCTUATION)?.[0] ?? ''
    const url = trailing ? matched.slice(0, -trailing.length) : matched
    return `${redactArchiveUrl(url)}${trailing}`
  })
  const redactedLocator = redactedUrls.replace(/(\blocator["']?\s*[:=]\s*["']?)[^\s,;}"']+/gi, '$1[REDACTED]')
  return maxLength === undefined
    ? redactSensitiveText(redactedLocator)
    : redactSensitiveText(redactedLocator, maxLength)
}
