const ARCHIVE_CLIENT_ERROR_MESSAGES: Record<string, string> = {
  BAD_REQUEST: '请求内容无效，请检查链接或筛选条件后重试。',
  NOT_FOUND: '目标记录不存在或已超过保留期。',
  TOO_MANY_REQUESTS: '远端服务暂时限流，请稍后重试。',
  PRECONDITION_FAILED: '当前状态不允许执行此操作，请刷新后重试。',
  UNAUTHORIZED: '登录状态已失效，请重新登录。',
  FORBIDDEN: '当前账号没有执行此操作的权限。'
}

interface ArchiveClientErrorLike {
  data?: { code?: string | null } | null
}

export function archiveClientErrorMessage(error: unknown, fallback = '操作失败，请稍后重试。'): string {
  if (!error || typeof error !== 'object') return fallback
  const code = (error as ArchiveClientErrorLike).data?.code
  return code ? (ARCHIVE_CLIENT_ERROR_MESSAGES[code] ?? fallback) : fallback
}
