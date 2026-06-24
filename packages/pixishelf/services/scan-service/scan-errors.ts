const UNKNOWN_SCAN_ERROR = '扫描失败，请查看日志'
const CANCELLED_MESSAGES = new Set(['Scan cancelled', '扫描已取消'])

export function getRawErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown error'
}

export function isScanCancelledError(error: unknown): boolean {
  return CANCELLED_MESSAGES.has(getRawErrorMessage(error))
}

export function formatInvalidMetadataPathError(relativePath: string): string {
  return `发现越界的元数据路径，已跳过: ${relativePath}`
}

export function formatScanUserError(error: unknown): string {
  const message = getRawErrorMessage(error)

  if (isScanCancelledError(message)) {
    return '扫描已取消'
  }

  if (message === 'SCAN_PATH is not configured') {
    return '扫描路径未配置，请先在设置中配置扫描目录'
  }

  if (message.startsWith('Database cleanup failed:')) {
    return '清空数据库失败，请查看日志'
  }

  if (message.startsWith('Failed to process batch ')) {
    return '部分作品处理失败，请查看扫描日志'
  }

  if (message.includes('元数据文件解析失败或媒体文件缺失')) {
    return '元数据文件解析失败或媒体文件缺失'
  }

  if (message.includes('未找到媒体文件')) {
    return '未找到该作品的媒体文件'
  }

  if (message.includes('未找到作品') && message.includes('元数据文件')) {
    return '未找到该作品的元数据文件'
  }

  if (message === 'Unknown error') {
    return UNKNOWN_SCAN_ERROR
  }

  return message
}

export function formatScanHttpErrorText(responseText: string): string {
  try {
    const parsed = JSON.parse(responseText) as { error?: unknown; message?: unknown }
    const parsedMessage = typeof parsed.error === 'string' ? parsed.error : parsed.message
    if (typeof parsedMessage === 'string') {
      return formatScanUserError(parsedMessage)
    }
  } catch {
    // Non-JSON response body; fall back to direct formatting below.
  }

  return formatScanUserError(responseText)
}
