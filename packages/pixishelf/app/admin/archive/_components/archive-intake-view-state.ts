export type ArchiveIntakeStatus =
  | 'QUEUED'
  | 'RESOLVING'
  | 'RETRY_WAIT'
  | 'READY'
  | 'STALE'
  | 'FAILED'
  | 'ENQUEUED'
  | 'CANCELLED'
  | 'DUPLICATE'

export type ArchiveResolutionKind = 'NEW' | 'UPDATE' | 'UNCHANGED' | 'ACTIVE_TASK' | 'DUPLICATE_IDENTITY' | null
export type ArchiveQuality = 'ORIGINAL' | 'DISPLAY'

export interface ArchiveUrlInputLine {
  raw: string
  value: string
  valid: boolean
  duplicate: boolean
}

export interface ArchiveUrlInputAnalysis {
  lines: ArchiveUrlInputLine[]
  nonEmptyCount: number
  validCount: number
  invalidCount: number
  duplicateCount: number
  overLimitCount: number
}

export interface ArchiveIntakeSelectionItem {
  id: string
  status: string
  resolutionKind: string | null
  retryable?: boolean | null
}

export interface ArchiveIntakeSelectionState {
  selectedIds: Set<string>
  manuallyDeselectedIds: Set<string>
  qualityById: Map<string, ArchiveQuality>
}

export interface ArchiveIntakeActionCounts {
  enqueue: number
  cancel: number
  retry: number
}

export interface ArchiveReplacementResult {
  acceptedCount: number
  duplicateCount: number
  rejectedCount: number
}

export interface ArchiveReplacementNotice {
  tone: 'success' | 'info' | 'warning'
  title: string
  description: string
}

const CANCELLABLE_STATUSES = new Set<string>(['QUEUED', 'RESOLVING', 'RETRY_WAIT', 'READY', 'STALE'])
const RETRYABLE_STATUSES = new Set<string>(['CANCELLED', 'STALE'])

export function analyzeArchiveUrlInput(input: string): ArchiveUrlInputAnalysis {
  const seen = new Set<string>()
  const lines = input
    .split(/\r?\n/)
    .filter((raw) => raw.trim().length > 0)
    .map((raw) => {
      const value = raw.trim()
      const duplicate = seen.has(value)
      seen.add(value)
      return { raw, value, duplicate, valid: isSupportedArchiveUrl(value) }
    })

  return {
    lines,
    nonEmptyCount: lines.length,
    validCount: lines.filter((line) => line.valid).length,
    invalidCount: lines.filter((line) => !line.valid).length,
    duplicateCount: lines.filter((line) => line.duplicate).length,
    overLimitCount: Math.max(0, lines.length - 100)
  }
}

export function isSelectableIntakeItem(item: ArchiveIntakeSelectionItem): boolean {
  if (CANCELLABLE_STATUSES.has(item.status) || isRetryableIntakeItem(item)) {
    if (item.status !== 'READY') return true
    return ['NEW', 'UPDATE', 'UNCHANGED'].includes(item.resolutionKind ?? '')
  }
  return false
}

export function isRetryableIntakeItem(item: ArchiveIntakeSelectionItem): boolean {
  return RETRYABLE_STATUSES.has(item.status) || (item.status === 'FAILED' && item.retryable === true)
}

export function isDefaultSelectedIntakeItem(item: ArchiveIntakeSelectionItem): boolean {
  return item.status === 'READY' && (item.resolutionKind === 'NEW' || item.resolutionKind === 'UPDATE')
}

export function reconcileArchiveIntakeSelection(
  items: readonly ArchiveIntakeSelectionItem[],
  state: ArchiveIntakeSelectionState
): ArchiveIntakeSelectionState {
  const visibleSelectableIds = new Set(items.filter(isSelectableIntakeItem).map((item) => item.id))
  const manuallyDeselectedIds = new Set(
    [...state.manuallyDeselectedIds].filter((itemId) => visibleSelectableIds.has(itemId))
  )
  const selectedIds = new Set([...state.selectedIds].filter((itemId) => visibleSelectableIds.has(itemId)))
  const qualityById = new Map([...state.qualityById].filter(([itemId]) => visibleSelectableIds.has(itemId))) as Map<
    string,
    ArchiveQuality
  >

  for (const item of items) {
    if (!isSelectableIntakeItem(item)) continue
    if (!qualityById.has(item.id)) qualityById.set(item.id, 'ORIGINAL')
    if (isDefaultSelectedIntakeItem(item) && !manuallyDeselectedIds.has(item.id)) selectedIds.add(item.id)
  }
  return { selectedIds, manuallyDeselectedIds, qualityById }
}

export function updateArchiveIntakeSelection(
  state: ArchiveIntakeSelectionState,
  itemId: string,
  checked: boolean
): ArchiveIntakeSelectionState {
  const selectedIds = new Set(state.selectedIds)
  const manuallyDeselectedIds = new Set(state.manuallyDeselectedIds)
  if (checked) {
    selectedIds.add(itemId)
    manuallyDeselectedIds.delete(itemId)
  } else {
    selectedIds.delete(itemId)
    manuallyDeselectedIds.add(itemId)
  }
  return { ...state, selectedIds, manuallyDeselectedIds }
}

export function countArchiveIntakeActions(
  items: readonly ArchiveIntakeSelectionItem[],
  selectedIds: ReadonlySet<string>
): ArchiveIntakeActionCounts {
  return items.reduce<ArchiveIntakeActionCounts>(
    (counts, item) => {
      if (!selectedIds.has(item.id) || !isSelectableIntakeItem(item)) return counts
      if (item.status === 'READY' && ['NEW', 'UPDATE', 'UNCHANGED'].includes(item.resolutionKind ?? '')) {
        counts.enqueue += 1
      }
      if (CANCELLABLE_STATUSES.has(item.status)) counts.cancel += 1
      if (isRetryableIntakeItem(item)) counts.retry += 1
      return counts
    },
    { enqueue: 0, cancel: 0, retry: 0 }
  )
}

export function archiveIntakePollingInterval(activeCount: number): number {
  return activeCount > 0 ? 1_500 : 8_000
}

export function archiveReplacementNotice(result: ArchiveReplacementResult): ArchiveReplacementNotice {
  if (result.acceptedCount > 0) {
    return {
      tone: 'success',
      title: '修正链接已作为新项目加入队尾',
      description: '原失败记录保持不变，可通过修正关系追溯新项目。'
    }
  }
  if (result.duplicateCount > 0) {
    return {
      tone: 'info',
      title: '修正链接已在收件队列中',
      description: '系统未重复排队，并已保留关联审计记录。'
    }
  }
  return {
    tone: 'warning',
    title: '修正项目未进入解析队列',
    description:
      result.rejectedCount > 0
        ? '收件队列已满，已保留失败记录；释放容量后可直接重试该项目。'
        : '系统已保留失败记录，请检查项目状态后重试。'
  }
}

export function archiveIntakeItemHref(itemId: string): string {
  return `/admin/archive/inbox?${new URLSearchParams({ itemId }).toString()}`
}

export function archiveTaskHref(taskId: string): string {
  return `/admin/archive?${new URLSearchParams({ taskId }).toString()}`
}

export function clearArchiveIntakeItemHref(searchParams: string): string {
  const params = new URLSearchParams(searchParams)
  params.delete('itemId')
  const query = params.toString()
  return query ? `/admin/archive/inbox?${query}` : '/admin/archive/inbox'
}

export function getOrCreateArchiveCommandKey(
  keys: Map<string, string>,
  command: string,
  payload: unknown,
  createKey: () => string
): string {
  // 网络结果未确认前按命令和 payload 指纹复用同一 key；成功后由调用方释放，后续操作才生成新 key。
  const fingerprint = archiveCommandFingerprint(command, payload)
  const existing = keys.get(fingerprint)
  if (existing) return existing
  const next = createKey()
  keys.set(fingerprint, next)
  return next
}

export function releaseArchiveCommandKey(keys: Map<string, string>, command: string, payload: unknown): void {
  keys.delete(archiveCommandFingerprint(command, payload))
}

function archiveCommandFingerprint(command: string, payload: unknown): string {
  return `${command}:${JSON.stringify(payload)}`
}

function isSupportedArchiveUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.hostname.toLowerCase() === 'e-hentai.org' &&
      /^\/(?:g|s)\//.test(url.pathname)
    )
  } catch {
    return false
  }
}
