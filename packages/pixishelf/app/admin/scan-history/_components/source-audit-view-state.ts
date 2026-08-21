export const SOURCE_AUDIT_CLASSIFICATIONS = ['NEW', 'CHANGED', 'MISSING', 'INVALID', 'IDENTITY_CONFLICT'] as const

export type SourceAuditClassification = (typeof SOURCE_AUDIT_CLASSIFICATIONS)[number]
export type SourceAuditSummaryClassification = SourceAuditClassification | 'UNCHANGED'
export type SourceAuditFilter = SourceAuditClassification | 'ALL'
export type SourceAuditApplyAction = 'IMPORT' | 'SYNC'
export type SourceAuditApplyResult = 'APPLIED' | 'SKIPPED' | 'STALE' | 'CONFLICT' | 'FAILED'
export type SourceAuditApplyItemState = 'PENDING' | 'PROCESSING' | SourceAuditApplyResult
export type SourceAuditApplyStage =
  | 'QUEUED'
  | 'VERIFYING'
  | 'APPLYING'
  | 'FINALIZING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
export type SourceAuditApplyBlockedReason =
  | 'APPLY_ACTIVE'
  | 'SCAN_BUSY'
  | 'AUDIT_NOT_COMPLETE'
  | 'ITEMS_NOT_ELIGIBLE'
  | 'CUTOVER_DISABLED'
  | 'DISPATCH_DISABLED'
  | 'SCAN_ROOT_NOT_CONFIGURED'
  | 'SOURCE_ROOT_UNAVAILABLE'
  | 'INVENTORY_NOT_READY'
  | 'WORKER_NOT_READY'
  | 'IDEMPOTENCY_CONFLICT'

export type SourceAuditStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'PAUSING'
  | 'PAUSED'
  | 'RETRY_WAIT'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'CANCELLING'
  | 'SKIPPED'

export type SourceAuditActionRequiredReason =
  | 'EMPTY_SOURCE'
  | 'SOURCE_CHANGED'
  | 'INVENTORY_NOT_READY'
  | 'SAFETY_LIMIT_EXCEEDED'
  | 'PRECONDITION_FAILED'
  | 'EXECUTION_FAILED'
  | 'CANCELLED'

export interface SourceAuditCounts {
  new: number
  changed: number
  missing: number
  invalid: number
  identityConflict: number
  unchanged: number
}

export interface SourceAuditSelectableItemLike {
  id: string
  classification: SourceAuditClassification
}

export interface SourceAuditSelectionCounts {
  total: number
  new: number
  changed: number
}

const classificationMeta = {
  NEW: { label: '来源新增', description: '目录中存在，但尚未进入图库', tone: 'info' },
  CHANGED: { label: '来源变化', description: 'metadata 与已记录版本不同', tone: 'warning' },
  MISSING: { label: '来源缺失', description: '图库有记录，但目录中已找不到', tone: 'destructive' },
  INVALID: { label: '无效 metadata', description: '文件无法作为有效 Pixiv metadata 读取', tone: 'destructive' },
  IDENTITY_CONFLICT: { label: '身份冲突', description: '路径、文件名或作品身份彼此矛盾', tone: 'warning' },
  UNCHANGED: { label: '一致', description: '来源与图库记录一致，无需处理', tone: 'success' }
} as const

export function getSourceAuditClassificationMeta(classification: SourceAuditSummaryClassification) {
  return classificationMeta[classification]
}

export function getSourceAuditCount(counts: SourceAuditCounts, classification: SourceAuditSummaryClassification) {
  return {
    NEW: counts.new,
    CHANGED: counts.changed,
    MISSING: counts.missing,
    INVALID: counts.invalid,
    IDENTITY_CONFLICT: counts.identityConflict,
    UNCHANGED: counts.unchanged
  }[classification]
}

export function formatSourceAuditStatus(status: SourceAuditStatus) {
  return {
    PENDING: '等待执行',
    RUNNING: '核对中',
    PAUSING: '正在暂停',
    PAUSED: '已暂停',
    RETRY_WAIT: '等待重试',
    COMPLETED: '核对完成',
    FAILED: '核对失败',
    CANCELLED: '已取消',
    CANCELLING: '正在取消',
    SKIPPED: '未执行'
  }[status]
}

export function shouldPollSourceAudit(status: SourceAuditStatus | undefined) {
  return (
    status === undefined || ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'].includes(status)
  )
}

export function sourceAuditApplyPayloadFingerprint(auditRunId: string, itemIds: readonly string[]) {
  return `${auditRunId}:${[...new Set(itemIds)].sort().join(',')}`
}

export function getOrCreateSourceAuditApplyKey(
  keys: Map<string, string>,
  auditRunId: string,
  itemIds: readonly string[],
  createKey: () => string
) {
  const fingerprint = sourceAuditApplyPayloadFingerprint(auditRunId, itemIds)
  const existing = keys.get(fingerprint)
  if (existing) return existing
  const next = createKey()
  keys.set(fingerprint, next)
  return next
}

export function releaseSourceAuditApplyKey(keys: Map<string, string>, auditRunId: string, itemIds: readonly string[]) {
  keys.delete(sourceAuditApplyPayloadFingerprint(auditRunId, itemIds))
}

export function reconcileSourceAuditSelection(
  selectedIds: ReadonlySet<string>,
  currentPageEligibleIds: readonly string[]
) {
  const eligibleIds = new Set(currentPageEligibleIds)
  return new Set([...selectedIds].filter((itemId) => eligibleIds.has(itemId)))
}

export function toggleSourceAuditItemSelection(selectedIds: ReadonlySet<string>, itemId: string, checked: boolean) {
  const next = new Set(selectedIds)
  if (checked) next.add(itemId)
  else next.delete(itemId)
  return next
}

export function toggleSourceAuditCurrentPageSelection(
  selectedIds: ReadonlySet<string>,
  currentPageEligibleIds: readonly string[],
  checked: boolean
) {
  const next = reconcileSourceAuditSelection(selectedIds, currentPageEligibleIds)
  for (const itemId of currentPageEligibleIds) {
    if (checked) next.add(itemId)
    else next.delete(itemId)
  }
  return next
}

export function sourceAuditCurrentPageSelectionState(
  selectedIds: ReadonlySet<string>,
  currentPageEligibleIds: readonly string[]
) {
  const selectedCount = currentPageEligibleIds.filter((itemId) => selectedIds.has(itemId)).length
  return {
    selectedCount,
    checked:
      selectedCount === 0
        ? (false as const)
        : selectedCount === currentPageEligibleIds.length && currentPageEligibleIds.length > 0
          ? (true as const)
          : ('indeterminate' as const)
  }
}

export function countSourceAuditSelection(
  items: readonly SourceAuditSelectableItemLike[],
  selectedIds: ReadonlySet<string>
): SourceAuditSelectionCounts {
  return items.reduce<SourceAuditSelectionCounts>(
    (counts, item) => {
      if (!selectedIds.has(item.id)) return counts
      counts.total += 1
      if (item.classification === 'NEW') counts.new += 1
      if (item.classification === 'CHANGED') counts.changed += 1
      return counts
    },
    { total: 0, new: 0, changed: 0 }
  )
}

export function formatSourceAuditApplyResult(result: SourceAuditApplyResult, action: SourceAuditApplyAction) {
  if (result === 'APPLIED') return action === 'IMPORT' ? '已导入' : '已同步'
  return {
    SKIPPED: '无需同步',
    STALE: '来源已变化',
    CONFLICT: '图库状态冲突',
    FAILED: '执行失败'
  }[result]
}

export function formatSourceAuditApplyItemState(state: SourceAuditApplyItemState, action: SourceAuditApplyAction) {
  if (state === 'PENDING') return '等待处理'
  if (state === 'PROCESSING') return action === 'IMPORT' ? '正在导入' : '正在同步'
  return formatSourceAuditApplyResult(state, action)
}

export function formatSourceAuditApplyStage(stage: SourceAuditApplyStage) {
  return {
    QUEUED: '等待执行',
    VERIFYING: '重新核验来源',
    APPLYING: '同步所选来源',
    FINALIZING: '整理结果',
    PAUSED: '已暂停',
    COMPLETED: '同步完成',
    FAILED: '同步任务失败',
    CANCELLED: '同步已取消'
  }[stage]
}

export function getSourceAuditApplyBlockedCopy(reason: SourceAuditApplyBlockedReason) {
  return {
    APPLY_ACTIVE: '已有来源同步正在执行，已切换到该任务的进度。',
    SCAN_BUSY: '当前有其他扫描任务正在运行，请等待完成后重试。',
    AUDIT_NOT_COMPLETE: '这次来源核对尚未形成完整结果，不能开始同步。',
    ITEMS_NOT_ELIGIBLE: '所选项目已被处理或不再适合同步，请刷新当前页后重新选择。',
    CUTOVER_DISABLED: '中央任务调度尚未启用，暂时不能同步来源。',
    DISPATCH_DISABLED: '后台 Worker 调度尚未启用，暂时不能同步来源。',
    SCAN_ROOT_NOT_CONFIGURED: '扫描目录尚未配置，暂时不能同步来源。',
    SOURCE_ROOT_UNAVAILABLE: '扫描目录当前不可访问，请检查挂载后重试。',
    INVENTORY_NOT_READY: '来源清单尚未准备完成，请先完成增量扫描。',
    WORKER_NOT_READY: '后台 Worker 尚未就绪，请稍后重试。',
    IDEMPOTENCY_CONFLICT: '这次提交与已有请求不一致。请刷新页面后重新选择。'
  }[reason]
}

export function getSourceAuditApplyResultCopy(result: SourceAuditApplyResult) {
  return {
    APPLIED: '已按核对快照完成来源同步。',
    SKIPPED: '当前状态已经满足目标，无需重复同步。',
    STALE: '来源文件在核对后发生变化，本项没有写入图库。请重新运行来源核对。',
    CONFLICT: '图库身份或来源记录已经变化，本项没有写入。请检查作品后重新核对。',
    FAILED: '本项未完成同步。可按结果中的建议处理后重新选择。'
  }[result]
}

export function shouldPollSourceAuditApply(status: SourceAuditStatus | undefined) {
  return shouldPollSourceAudit(status)
}

export function resolveSourceAuditApplyOperationId(
  explicitOperationId: string | null,
  activeOperationId: string | null,
  latestOperationId: string | null
) {
  return explicitOperationId ?? activeOperationId ?? latestOperationId
}

export function getSourceAuditReasonCopy(reason: SourceAuditActionRequiredReason | null) {
  if (!reason) return null
  return {
    EMPTY_SOURCE: {
      title: '扫描目录没有可核对的 metadata',
      description: '请确认扫描目录配置正确且内容已经挂载，再重新发起来源核对。'
    },
    SOURCE_CHANGED: {
      title: '核对期间来源目录发生了变化',
      description: '本次结果未被作为完整快照，请等待文件变动结束后重新核对。'
    },
    INVENTORY_NOT_READY: {
      title: '来源清单尚未建立完成',
      description: '请先运行“扫描新作品”完成来源基线，再重新核对。'
    },
    SAFETY_LIMIT_EXCEEDED: {
      title: '差异数量超过安全上限',
      description: '请先检查扫描目录和挂载状态，确认不是路径异常后再重新核对。'
    },
    PRECONDITION_FAILED: {
      title: '核对所需条件已经变化',
      description: '请检查扫描目录和 Worker 状态，然后重新发起来源核对。'
    },
    EXECUTION_FAILED: {
      title: 'Worker 未能完成来源核对',
      description: '本次结果不可使用。请在后台任务中查看执行状态，排除问题后重新核对。'
    },
    CANCELLED: {
      title: '来源核对已取消',
      description: '本次没有形成可用结果，需要时可从扫描设置重新发起。'
    }
  }[reason]
}
