import { describe, expect, it } from 'vitest'
import {
  archiveLaneStatusLabel,
  archiveMaintenanceRetryAction,
  archiveTaskBulkPayloadKey,
  archiveTaskDeepLinkId,
  archiveTaskPageWithoutDetail,
  archiveTaskPollingInterval,
  archiveTaskStatusLabel,
  currentPageSelectionState,
  eligibleArchiveTaskIds,
  goToNextArchiveTaskPage,
  goToPreviousArchiveTaskPage,
  getOrCreateArchiveTaskBulkKey,
  reconcileCurrentPageSelection,
  releaseArchiveTaskBulkKey,
  resetArchiveTaskBrowseState,
  toggleCurrentPageSelection
} from '../archive-task-view-state'

const tasks = [
  { id: 'pending', status: 'PENDING' },
  { id: 'running', status: 'RUNNING' },
  { id: 'paused', status: 'PAUSED' },
  { id: 'failed', status: 'FAILED' },
  { id: 'cancelled', status: 'CANCELLED' },
  { id: 'completed', status: 'COMPLETED' }
]

describe('archive task bulk action eligibility', () => {
  const selected = new Set(tasks.map((task) => task.id))

  it('uses the same status whitelist as the server action contract', () => {
    expect(eligibleArchiveTaskIds(tasks, selected, 'PAUSE')).toEqual(['pending', 'running'])
    expect(eligibleArchiveTaskIds(tasks, selected, 'RESUME')).toEqual(['paused'])
    expect(eligibleArchiveTaskIds(tasks, selected, 'CANCEL')).toEqual(['pending', 'running', 'paused'])
    expect(eligibleArchiveTaskIds(tasks, selected, 'RETRY')).toEqual(['failed', 'cancelled'])
  })

  it('never includes an eligible row that is not selected', () => {
    expect(eligibleArchiveTaskIds(tasks, new Set(['failed']), 'RETRY')).toEqual(['failed'])
  })

  it('uses a stable payload identity independent of selection order', () => {
    expect(archiveTaskBulkPayloadKey('PAUSE', ['b', 'a'])).toBe(archiveTaskBulkPayloadKey('PAUSE', ['a', 'b']))
    expect(archiveTaskBulkPayloadKey('RESUME', ['a', 'b'])).not.toBe(archiveTaskBulkPayloadKey('PAUSE', ['a', 'b']))
  })

  it('keeps uncertain payload keys across selection changes and releases only a success', () => {
    const keys = new Map<string, string>()
    const generated = ['key-a', 'key-b', 'key-a-next']
    const createKey = () => generated.shift()!

    expect(getOrCreateArchiveTaskBulkKey(keys, 'PAUSE', ['a'], createKey)).toBe('key-a')
    expect(getOrCreateArchiveTaskBulkKey(keys, 'PAUSE', ['b'], createKey)).toBe('key-b')
    expect(getOrCreateArchiveTaskBulkKey(keys, 'PAUSE', ['a'], createKey)).toBe('key-a')
    releaseArchiveTaskBulkKey(keys, 'PAUSE', ['a'])
    expect(getOrCreateArchiveTaskBulkKey(keys, 'PAUSE', ['a'], createKey)).toBe('key-a-next')
  })
})

describe('current page selection', () => {
  it('reports unchecked, indeterminate, and checked states', () => {
    expect(currentPageSelectionState(new Set(), ['a', 'b'])).toEqual({ selectedCount: 0, checked: false })
    expect(currentPageSelectionState(new Set(['a']), ['a', 'b'])).toEqual({
      selectedCount: 1,
      checked: 'indeterminate'
    })
    expect(currentPageSelectionState(new Set(['a', 'b']), ['a', 'b'])).toEqual({ selectedCount: 2, checked: true })
  })

  it('selects the current page and removes ids that leave it', () => {
    expect([...toggleCurrentPageSelection(new Set(['old']), ['a', 'b'], true)]).toEqual(['a', 'b'])
    expect([...reconcileCurrentPageSelection(new Set(['old', 'a']), ['a', 'b'])]).toEqual(['a'])
  })
})

describe('cursor browsing', () => {
  it('stores a cursor stack and can return to the first page', () => {
    const second = goToNextArchiveTaskPage(resetArchiveTaskBrowseState(), 'cursor-2')
    const third = goToNextArchiveTaskPage(second, 'cursor-3')
    expect(goToPreviousArchiveTaskPage(third)).toEqual(second)
    expect(goToPreviousArchiveTaskPage(second)).toEqual(resetArchiveTaskBrowseState())
  })

  it('resets pagination when filters change', () => {
    expect(resetArchiveTaskBrowseState()).toEqual({ cursor: undefined, previousCursors: [] })
  })
})

describe('task detail deep links', () => {
  it('accepts only bounded non-empty ids', () => {
    expect(archiveTaskDeepLinkId('task-1')).toBe('task-1')
    expect(archiveTaskDeepLinkId('')).toBeUndefined()
    expect(archiveTaskDeepLinkId('x'.repeat(129))).toBeUndefined()
  })

  it('removes taskId without discarding unrelated query state', () => {
    expect(archiveTaskPageWithoutDetail('taskId=task-1')).toBe('/admin/archive')
    expect(archiveTaskPageWithoutDetail('view=recent&taskId=task-1')).toBe('/admin/archive?view=recent')
  })
})

describe('polling and labels', () => {
  it('polls quickly only while the current page has active tasks', () => {
    expect(archiveTaskPollingInterval([{ status: 'RUNNING' }])).toBe(1_500)
    expect(archiveTaskPollingInterval([{ status: 'COMPLETED' }])).toBe(8_000)
  })

  it('maps partial failures and lane states to user-facing labels', () => {
    expect(archiveTaskStatusLabel('FAILED', 'PARTIAL_FAILURE')).toBe('部分失败')
    expect(archiveTaskStatusLabel('PAUSED')).toBe('已暂停')
    expect(archiveLaneStatusLabel('DRAINING')).toBe('停止领取')
  })

  it('keeps a recovery action available while archive maintenance is pending', () => {
    expect(archiveMaintenanceRetryAction('TRASHING')).toBe('DELETE_ARCHIVE')
    expect(archiveMaintenanceRetryAction('RESTORING')).toBe('RESTORE_ARCHIVE')
    expect(archiveMaintenanceRetryAction('TRASHED')).toBeNull()
  })
})
