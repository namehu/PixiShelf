import { createHash } from 'node:crypto'
import { archiveProviderRegistry } from '@/services/archive/provider-registry'
import { validateArchiveUrl } from '@/services/archive/safe-http'
import { ArchiveError } from '@/services/archive/errors'

export function validateSubmittedUrl(url: string, customValidator?: (url: string) => void) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch (error) {
    throw new ArchiveError('INVALID_URL', '作品链接格式无效', { cause: error })
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new ArchiveError('INVALID_URL', '归档链接必须使用不含用户凭据的 HTTPS URL')
  }
  const identity = archiveProviderRegistry.getForUrl(url).identifySource(url)
  if (customValidator) customValidator(url)
  else {
    // Provider 先确认其可接收的入口；Safe HTTP 再以该入口主机为精确 allowlist 拒绝凭据和非标准端口。
    validateArchiveUrl(url, [parsed.hostname])
  }
  return identity
}

export function hashSubmittedUrl(url: string) {
  return createHash('sha256').update(url.trim()).digest('hex')
}

// 对外展示前去掉搜索参数和片段，减少敏感参数在日志/消息中外泄风险；展示层统一走这个函数。
export function safeThumbnailUrl(input: string | null): string | null {
  if (!input) return null
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}
