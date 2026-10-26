import type { ArtworkDedupOperationDto } from '@pixishelf/job-contracts'

export const duplicateOperationLabels: Record<ArtworkDedupOperationDto['status'], string> = {
  BUILDING: '正在准备预览',
  READY: '确认删除',
  DRAINING: '正在准备删除',
  VERIFYING: '正在重新核对原件',
  DELETING: '正在永久删除',
  DELETED: '删除完成',
  STOPPED: '删除已停止',
  STALE: '预览已过期',
  FAILED: '处理失败',
  ISOLATING: '旧流程记录',
  ISOLATED: '旧流程记录',
  RESTORING: '旧流程记录',
  RESTORED: '旧流程记录',
  PURGING: '正在永久删除',
  PURGED: '已永久删除',
  RECOVERY_REQUIRED: '需要继续处理',
  CANCELLED: '已取消'
}
export function isDuplicateOperationActive(operation: ArtworkDedupOperationDto) {
  return (
    ['BUILDING', 'ISOLATING', 'RESTORING', 'PURGING', 'DRAINING', 'VERIFYING', 'DELETING'].includes(operation.status) ||
    operation.purgePreview?.status === 'BUILDING'
  )
}
export function newerDuplicateOperation(current: ArtworkDedupOperationDto | undefined, next: ArtworkDedupOperationDto) {
  if (!current) return next
  if (current.operationId !== next.operationId) return current
  if (current.version > next.version) return current
  if (current.version === next.version && Date.parse(current.updatedAt) > Date.parse(next.updatedAt)) return current
  return next
}
export function duplicateFileStatus(status: string) {
  const labels: Record<string, string> = {
    SELECTED: '待处理',
    PENDING: '待检查',
    VERIFIED: '已核对',
    BLOCKED: '无法处理',
    ISOLATING: '旧流程记录',
    MOVE_INTENT: '正在隔离',
    MOVED: '已隔离',
    ISOLATED: '旧流程记录',
    RESTORING: '旧流程记录',
    RESTORE_INTENT: '正在恢复',
    RESTORED: '旧流程记录',
    PURGING: '正在永久删除',
    DELETE_INTENT: '正在永久删除',
    DELETED: '已删除',
    PURGED: '已删除',
    RECOVERY_REQUIRED: '需要继续处理'
  }
  return labels[status] ?? '待核对'
}
export function duplicateBytes(value: string | null) {
  if (value === null) return '统计中'
  const bytes = BigInt(value)
  for (const [unit, size] of [
    ['TB', 1099511627776n],
    ['GB', 1073741824n],
    ['MB', 1048576n],
    ['KB', 1024n]
  ] as const) {
    if (bytes >= size) return `${Number((bytes * 10n) / size) / 10} ${unit}`
  }
  return `${bytes} B`
}

export function isDirectDeletePreview(
  operation: ArtworkDedupOperationDto
): operation is ArtworkDedupOperationDto & { protocolVersion: 1 | 2 | 3 | 4 } {
  return operation.preparePurpose === 'DIRECT_DELETE' && [1, 2, 3, 4].includes(operation.protocolVersion ?? 0)
}
export function duplicateSourceLabel(source: string) {
  return (
    (
      {
        LOCAL_CREATED: '手动创建',
        PIXIV_IMPORTED: 'Pixiv 导入',
        LOCAL_IMPORT: '本地导入',
        URL_ARCHIVE: '链接归档'
      } as Record<string, string>
    )[source] ??
    (source || '来源未知')
  )
}
export function duplicateBlockReason(code: string) {
  const reasons: Record<string, string> = {
    CONTENT_OR_SCOPE_CHANGED: '作品已被修改或删除，请重新检查。',
    SNAPSHOT_CHANGED: '作品、来源或整理依据已变化，请重新预览。',
    UNKNOWN_ATTACHMENT: '发现未登记附件，不能自动删除。',
    UNVERIFIED_ARCHIVE_REVISION: '归档历史原件未通过本次一致性验证。',
    SHARED_PATH: '文件路径由多个作品共用，不能自动删除。',
    HARD_LINK: '发现硬链接，不能自动删除。',
    SYMBOLIC_LINK: '发现符号链接，不能自动删除。',
    OWNERSHIP_UNCONFIRMED: '文件归属尚未确认。',
    SOURCE_HELD: '来源正被其他操作保护。',
    EXPLICIT_CHOICE_REQUIRED: '请先明确选择保留作品。',
    MULTIPLE_ORGANIZED_MEMBERS: '有多份整理记录，请先选择保留作品。',
    CONTAINED_HAS_ORGANIZATION: '被包含的作品有整理记录，请明确选择保留完整作品；整理记录不会转移。',
    CONTAINMENT_DIRECTION_REQUIRED: '完整包含只能保留包含全部原媒体的作品。',
    CONFLICTING_SELECTION: '所选结果有冲突：同一作品不能既保留又删除，也不能重复删除。请减少选择后重试。'
  }
  return reasons[code] ?? '本项无法安全处理，请重新检查作品、来源及附属文件。'
}

export function duplicateDiagnosticCode(value: string) {
  return /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : 'REVIEW_REQUIRED'
}
