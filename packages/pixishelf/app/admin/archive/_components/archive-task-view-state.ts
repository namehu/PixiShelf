export const ARCHIVE_TASK_ACTIVE_STATUSES = ['PENDING', 'RUNNING', 'CANCELLING'] as const

export type ArchiveTaskBulkAction = 'PAUSE' | 'RESUME' | 'CANCEL' | 'RETRY'

export interface ArchiveTaskStatusLike {
  id: string
  status: string
}

export type ArchiveMaintenanceRetryAction = 'DELETE_ARCHIVE' | 'RESTORE_ARCHIVE'

const ELIGIBLE_STATUSES: Record<ArchiveTaskBulkAction, ReadonlySet<string>> = {
  PAUSE: new Set(['PENDING', 'RUNNING']),
  RESUME: new Set(['PAUSED']),
  CANCEL: new Set(['PENDING', 'RUNNING', 'PAUSED']),
  RETRY: new Set(['FAILED', 'CANCELLED'])
}

const TASK_STATUS_LABELS: Record<string, string> = {
  PENDING: '排队中',
  RUNNING: '下载中',
  PAUSED: '已暂停',
  CANCELLING: '正在取消',
  COMPLETED: '已发布',
  FAILED: '失败',
  CANCELLED: '已取消'
}

const LANE_STATUS_LABELS: Record<string, string> = {
  READY: '就绪',
  RUNNING: '运行中',
  DRAINING: '停止领取',
  ERROR: '异常'
}

export function archiveTaskStatusLabel(status: string, errorCode?: string | null): string {
  if (status === 'FAILED' && errorCode === 'PARTIAL_FAILURE') return '部分失败'
  return TASK_STATUS_LABELS[status] ?? status
}

export function archiveLaneStatusLabel(status: string): string {
  return LANE_STATUS_LABELS[status] ?? status
}

export function archiveMaintenanceRetryAction(lifecycleState?: string | null): ArchiveMaintenanceRetryAction | null {
  if (lifecycleState === 'TRASHING') return 'DELETE_ARCHIVE'
  if (lifecycleState === 'RESTORING') return 'RESTORE_ARCHIVE'
  return null
}

export function archiveTaskPollingInterval(tasks: readonly { status: string }[]): number {
  return tasks.some((task) => ARCHIVE_TASK_ACTIVE_STATUSES.includes(task.status as never)) ? 1_500 : 8_000
}

export function eligibleArchiveTaskIds(
  tasks: readonly ArchiveTaskStatusLike[],
  selectedIds: ReadonlySet<string>,
  action: ArchiveTaskBulkAction
): string[] {
  const eligibleStatuses = ELIGIBLE_STATUSES[action]
  return tasks.filter((task) => selectedIds.has(task.id) && eligibleStatuses.has(task.status)).map((task) => task.id)
}

export function archiveTaskBulkPayloadKey(action: ArchiveTaskBulkAction, taskIds: readonly string[]): string {
  return `${action}:${[...taskIds].sort().join(',')}`
}

export function getOrCreateArchiveTaskBulkKey(
  keys: Map<string, string>,
  action: ArchiveTaskBulkAction,
  taskIds: readonly string[],
  createKey: () => string
): string {
  const payloadKey = archiveTaskBulkPayloadKey(action, taskIds)
  const existing = keys.get(payloadKey)
  if (existing) return existing
  const next = createKey()
  keys.set(payloadKey, next)
  return next
}

export function releaseArchiveTaskBulkKey(
  keys: Map<string, string>,
  action: ArchiveTaskBulkAction,
  taskIds: readonly string[]
): void {
  keys.delete(archiveTaskBulkPayloadKey(action, taskIds))
}

export function archiveTaskDeepLinkId(value: string | null): string | undefined {
  const normalized = value?.trim()
  return normalized && normalized.length <= 128 ? normalized : undefined
}

export function archiveTaskPageWithoutDetail(search: string): string {
  const params = new URLSearchParams(search)
  params.delete('taskId')
  const query = params.toString()
  return query ? `/admin/archive?${query}` : '/admin/archive'
}

export function reconcileCurrentPageSelection(
  selectedIds: ReadonlySet<string>,
  currentPageIds: readonly string[]
): Set<string> {
  const currentPage = new Set(currentPageIds)
  return new Set([...selectedIds].filter((id) => currentPage.has(id)))
}

export function currentPageSelectionState(
  selectedIds: ReadonlySet<string>,
  currentPageIds: readonly string[]
): { selectedCount: number; checked: boolean | 'indeterminate' } {
  const selectedCount = currentPageIds.filter((id) => selectedIds.has(id)).length
  return {
    selectedCount,
    checked:
      selectedCount === 0
        ? false
        : selectedCount === currentPageIds.length && currentPageIds.length > 0
          ? true
          : 'indeterminate'
  }
}

export function toggleCurrentPageSelection(
  selectedIds: ReadonlySet<string>,
  currentPageIds: readonly string[],
  checked: boolean
): Set<string> {
  const next = reconcileCurrentPageSelection(selectedIds, currentPageIds)
  for (const id of currentPageIds) {
    if (checked) next.add(id)
    else next.delete(id)
  }
  return next
}

export interface ArchiveTaskCursorState {
  cursor: string | undefined
  previousCursors: Array<string | undefined>
}

export function goToNextArchiveTaskPage(
  state: ArchiveTaskCursorState,
  nextCursor: string | null
): ArchiveTaskCursorState {
  if (!nextCursor) return state
  return { cursor: nextCursor, previousCursors: [...state.previousCursors, state.cursor] }
}

export function goToPreviousArchiveTaskPage(state: ArchiveTaskCursorState): ArchiveTaskCursorState {
  const previousCursors = [...state.previousCursors]
  const cursor = previousCursors.pop()
  return { cursor, previousCursors }
}

export function resetArchiveTaskBrowseState(): ArchiveTaskCursorState {
  return { cursor: undefined, previousCursors: [] }
}
