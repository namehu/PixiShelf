import { z } from 'zod'

const codeSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/)
export const jobDiagnosticEvidenceSchema = z
  .object({
    code: codeSchema.optional(),
    errno: codeSchema.optional(),
    httpStatus: z.number().int().min(100).max(599).optional()
  })
  .strict()
export const jobDiagnosticSchema = z
  .object({
    version: z.literal(1),
    code: codeSchema,
    reasonKey: z
      .string()
      .max(160)
      .regex(/^(?:errno|http|code):[A-Za-z0-9_.:-]+$/),
    message: z.string().max(1000),
    suggestion: z.string().max(500),
    evidence: z.array(jobDiagnosticEvidenceSchema).max(8),
    remoteHost: z.string().max(253).nullable(),
    httpStatus: z.number().int().min(100).max(599).nullable()
  })
  .strict()
export type JobDiagnostic = z.infer<typeof jobDiagnosticSchema>
export interface JobDiagnosticInput {
  key: string
  scope?: 'TASK' | 'ITEM'
  origin?: 'CURRENT' | 'INHERITED'
  targetType?: string | undefined
  targetId?: string | undefined
  targetLabel?: string | undefined
  stage?: string | undefined
  code?: string | undefined
  message?: string | undefined
  error?: unknown
  remoteHost?: string | null | undefined
  httpStatus?: number | null | undefined
  itemAttempt?: number | undefined
}

/** Error prose is retained only after removing transport addresses, credentials, SQL and stack frames. */
export function sanitizeDiagnosticText(value: string, limit = 1000): string {
  return value
    .replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s<>"']+/gi, '[地址已隐藏]')
    .replace(
      /\b(?:select\s|insert\s+into\b|update\s+[\"a-z0-9_.]+\s+set\b|delete\s+from\b|(?:alter|create)\s+(?:table|index|view|database|schema|function)\b)[\s\S]*/i,
      '[数据库语句已隐藏]'
    )
    .replace(/Invalid\s+[^\r\n]*prisma[\s\S]*/i, '[数据库调用详情已隐藏]')
    .replace(/\bBearer\s+[^\s,;]+/gi, '[凭据已隐藏]')
    .replace(
      /(?:cookie|authorization|password|(?:client[_-]?)?secret|(?:access[_-]?|refresh[_-]?)?token|api[_-]?key|connection[_-]?string|database[_-]?url)[\"']?\s*[:=][^\r\n]*/gi,
      '[凭据已隐藏]'
    )
    .replace(/\n\s*at\s[\s\S]*/, '')
    .replace(/\b[A-Za-z]:[\\/][^\r\n\"'<>|,;)]*/g, redactDiagnosticPath)
    .replace(/\\\\[^\s\"'<>|,;)]+/g, redactDiagnosticPath)
    .replace(
      /(^|[\s(\"'])\/(?!\/)[^\s\"'<>|,:;)]+/g,
      (_match, prefix: string) => prefix + redactDiagnosticPath(_match.slice(prefix.length))
    )
    .slice(0, limit)
}
function redactDiagnosticPath(value: string): string {
  const basename = value.trim().split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  return '[路径已隐藏]' + (basename ? '/' + basename : '')
}
const safeCode = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : undefined
function read(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key)
  } catch {
    return undefined
  }
}
export function extractJobDiagnostic(
  error: unknown,
  input: Pick<JobDiagnosticInput, 'code' | 'message' | 'remoteHost' | 'httpStatus'> = {}
): JobDiagnostic {
  const evidence: JobDiagnostic['evidence'] = []
  const seen = new Set<unknown>()
  const messages: string[] = []
  let observedHost: string | null = null
  let cursor = error
  for (let depth = 0; depth < 8 && cursor && typeof cursor === 'object' && !seen.has(cursor); depth++) {
    seen.add(cursor)
    const rawMessage = read(cursor, 'message')
    if (typeof rawMessage === 'string' && rawMessage.trim()) messages.push(rawMessage.slice(0, 4096))
    observedHost = safeDiagnosticHost(read(cursor, 'remoteHost')) ?? observedHost
    const code = safeCode(read(cursor, 'code'))
    const rawErrno = read(cursor, 'errno')
    const errno =
      safeCode(rawErrno) ??
      (typeof rawErrno === 'number' && Number.isSafeInteger(rawErrno) ? String(rawErrno) : undefined)
    const status = read(cursor, 'httpStatus') ?? read(cursor, 'status') ?? read(cursor, 'statusCode')
    const httpStatus =
      typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined
    if (code || errno || httpStatus) evidence.push({ code, errno, httpStatus })
    cursor = read(cursor, 'cause')
  }
  if (typeof cursor === 'string' && cursor.trim()) messages.push(cursor.slice(0, 4096))
  const sourceText = messages.at(-1) ?? ''
  const recognizedCode =
    /\b(ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENOSPC|EACCES|EPERM|ENOENT|ECONNREFUSED|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UND_ERR_[A-Z_]+)\b/.exec(
      sourceText
    )?.[1]
  const recognizedStatus = /\bHTTP(?:\/\d(?:\.\d)?)?\s+(\d{3})\b/i.exec(sourceText)?.[1]
  if (evidence.length < 8 && (recognizedCode || recognizedStatus))
    evidence.push({
      code: recognizedCode,
      ...(recognizedStatus && Number(recognizedStatus) >= 100 && Number(recognizedStatus) <= 599
        ? { httpStatus: Number(recognizedStatus) }
        : {})
    })
  const root = [...evidence].reverse()
  const errno =
    root.find(
      (item) =>
        item.code &&
        /^(?:E[A-Z0-9]+|EAI_[A-Z]+|UND_ERR_[A-Z_]+|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE)$/.test(item.code)
    )?.code ?? root.find((item) => item.errno)?.errno
  const httpStatus =
    input.httpStatus && input.httpStatus >= 100 && input.httpStatus <= 599
      ? input.httpStatus
      : (root.find((item) => item.httpStatus)?.httpStatus ?? null)
  const code = safeCode(input.code) ?? root.find((item) => item.code)?.code ?? 'UNKNOWN_ERROR'
  const reasonKey = errno ? `errno:${errno}` : httpStatus ? `http:${httpStatus}` : `code:${code}`
  let message = '任务执行失败，未记录可识别的底层原因。'
  let suggestion = '查看对应对象状态，修复后重试。'
  const reasons: Record<string, string> = {
    ECONNRESET: '远端连接被重置',
    ETIMEDOUT: '连接或请求超时',
    ENOTFOUND: '无法解析远端域名',
    EAI_AGAIN: '域名解析暂时失败',
    ENOSPC: '存储空间不足',
    EACCES: '没有文件访问权限',
    EPERM: '操作权限不足',
    ENOENT: '文件或目录不存在',
    ECONNREFUSED: '远端拒绝连接',
    CERT_HAS_EXPIRED: '远端 TLS 证书已过期',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: '无法验证远端 TLS 证书',
    WORKER_LEASE_EXPIRED: 'Worker 执行租约过期，未确认执行完成',
    INVALID_PAYLOAD: '任务参数不符合执行要求',
    UNSUPPORTED_DEFINITION_VERSION: 'Worker 不支持此任务版本',
    DATABASE_SCHEMA_MISMATCH: '数据库结构与 Worker 版本不匹配',
    DATABASE_UNAVAILABLE: '数据库连接不可用',
    LEASE_LOST: '任务执行所有权已丢失',
    RESOURCE_BUSY: '执行资源正在被其他任务占用',
    PRECONDITION_FAILED: '任务执行前置条件未满足',
    SOURCE_NOT_FOUND: '来源对象不存在',
    PATH_OUTSIDE_ALLOWED_ROOT: '目标路径超出允许的根目录',
    FILESYSTEM_PERMISSION_DENIED: '没有文件系统访问权限',
    EXTERNAL_PROCESS_FAILED: '外部处理程序执行失败',
    EXTERNAL_PROCESS_TIMEOUT: '外部处理程序执行超时'
  }
  if (errno) {
    message = (reasons[errno] ?? '底层操作失败') + '（' + errno + '）。'
    suggestion = '检查存储权限、文件可用性及网络连接后重试。'
  } else if (httpStatus) {
    message = `远端服务返回 HTTP ${httpStatus}。`
    suggestion = httpStatus === 429 ? '等待远端限流解除后重试。' : '检查来源服务和访问权限后重试。'
  } else if (code !== 'UNKNOWN_ERROR')
    message = reasons[code] ? reasons[code] + '。' : `任务执行失败（${code}），未提供更具体的底层原因。`
  const actualReason = sanitizeDiagnosticText(sourceText || input.message || '').trim()
  if (actualReason) message = errno || httpStatus ? sanitizeDiagnosticText(message + ' ' + actualReason) : actualReason
  const remoteHost = safeDiagnosticHost(input.remoteHost) ?? observedHost
  return jobDiagnosticSchema.parse({
    version: 1,
    code,
    reasonKey,
    message,
    suggestion,
    evidence,
    remoteHost,
    httpStatus
  })
}

function safeDiagnosticHost(value: unknown): string | null {
  if (typeof value !== 'string' || /[\s/@?#]/.test(value)) return null
  const match = /^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])(?::([0-9]{1,5}))?$/i.exec(value)
  return match && value.length <= 253 && (!match[1] || (Number(match[1]) > 0 && Number(match[1]) <= 65535))
    ? value.toLowerCase()
    : null
}

/** Validate structured diagnostics without reconstructing (and potentially reversing) their cause chain. */
export function sanitizeJobDiagnostic(value: JobDiagnostic): JobDiagnostic {
  const parsed = jobDiagnosticSchema.parse(value)
  return {
    ...parsed,
    message: sanitizeDiagnosticText(parsed.message),
    suggestion: sanitizeDiagnosticText(parsed.suggestion, 500),
    remoteHost: safeDiagnosticHost(parsed.remoteHost)
  }
}
