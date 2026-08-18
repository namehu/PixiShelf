import { redactSensitiveText } from '@/services/background-task/job-serialization'

const HTTP_URL_IN_TEXT = /https?:\/\/[^\s<>{}[\]"']+/gi
const TRAILING_PUNCTUATION = /[),.;!?]+$/

export const ARCHIVE_INTERNAL_ERROR_MESSAGE = '内部处理失败，请稍后重试或查看服务日志。'

// 路径 token 在 URL 片段末端截断，保留协议主机/首路径便于排障而不泄露完整凭证/鉴权参数。
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

export function archiveWireErrorMessage(errorCode: string | null, value: string | null): string | null {
  return errorCode === 'INTERNAL' ? ARCHIVE_INTERNAL_ERROR_MESSAGE : redactArchiveText(value)
}
