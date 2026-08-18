import { describe, expect, it } from 'vitest'
import {
  analyzeArchiveUrlInput,
  archiveIntakeItemHref,
  archiveReplacementNotice,
  archiveTaskHref,
  clearArchiveIntakeItemHref,
  countArchiveIntakeActions,
  getOrCreateArchiveCommandKey,
  reconcileArchiveIntakeSelection,
  releaseArchiveCommandKey,
  updateArchiveIntakeSelection,
  type ArchiveIntakeSelectionItem,
  type ArchiveIntakeSelectionState
} from '../archive-intake-view-state'

const emptySelection = (): ArchiveIntakeSelectionState => ({
  selectedIds: new Set(),
  manuallyDeselectedIds: new Set(),
  qualityById: new Map()
})

describe('archive intake view state', () => {
  it('classifies non-empty input without hiding duplicate or invalid lines', () => {
    const analysis = analyzeArchiveUrlInput(`
https://e-hentai.org/g/123/token/
not-a-url
https://e-hentai.org/g/123/token/
https://example.com/g/456/token/
https://e-hentai.org/s/page/123-1
`)

    expect(analysis).toMatchObject({
      nonEmptyCount: 5,
      validCount: 3,
      invalidCount: 2,
      duplicateCount: 1,
      overLimitCount: 0
    })
    expect(analysis.lines.map((line) => line.raw.trim())).toHaveLength(5)
  })

  it('keeps a manual deselection stable across polling and removes off-page state', () => {
    const readyNew: ArchiveIntakeSelectionItem = { id: 'new', status: 'READY', resolutionKind: 'NEW' }
    const readyUnchanged: ArchiveIntakeSelectionItem = {
      id: 'unchanged',
      status: 'READY',
      resolutionKind: 'UNCHANGED'
    }
    let state = reconcileArchiveIntakeSelection([readyNew, readyUnchanged], emptySelection())
    expect([...state.selectedIds]).toEqual(['new'])

    state = updateArchiveIntakeSelection(state, 'new', false)
    state = reconcileArchiveIntakeSelection([readyNew, readyUnchanged], state)
    expect(state.selectedIds.has('new')).toBe(false)
    expect(state.manuallyDeselectedIds.has('new')).toBe(true)

    state = reconcileArchiveIntakeSelection([readyUnchanged], state)
    expect(state.manuallyDeselectedIds.has('new')).toBe(false)
    expect(state.qualityById.has('new')).toBe(false)
  })

  it('counts only currently legal actions from a mixed selection', () => {
    const items: ArchiveIntakeSelectionItem[] = [
      { id: 'ready', status: 'READY', resolutionKind: 'UPDATE' },
      { id: 'stale', status: 'STALE', resolutionKind: 'NEW' },
      { id: 'failed', status: 'FAILED', resolutionKind: null, retryable: true },
      { id: 'permanent-failure', status: 'FAILED', resolutionKind: null, retryable: false },
      { id: 'active-task', status: 'READY', resolutionKind: 'ACTIVE_TASK' }
    ]

    expect(countArchiveIntakeActions(items, new Set(items.map((item) => item.id)))).toEqual({
      enqueue: 1,
      cancel: 2,
      retry: 2
    })
  })

  it('does not select or retry a permanent failure with the original URL', () => {
    const permanentFailure: ArchiveIntakeSelectionItem = {
      id: 'permanent',
      status: 'FAILED',
      resolutionKind: null,
      retryable: false
    }

    const state = reconcileArchiveIntakeSelection([permanentFailure], emptySelection())
    expect(state.selectedIds.size).toBe(0)
    expect(countArchiveIntakeActions([permanentFailure], new Set(['permanent']))).toEqual({
      enqueue: 0,
      cancel: 0,
      retry: 0
    })
  })

  it('builds safe item/task deep links and clears only the item locator', () => {
    expect(archiveIntakeItemHref('item/with spaces')).toBe('/admin/archive/inbox?itemId=item%2Fwith+spaces')
    expect(archiveTaskHref('task?private')).toBe('/admin/archive?taskId=task%3Fprivate')
    expect(clearArchiveIntakeItemHref('itemId=item-1&providerKey=e-hentai')).toBe(
      '/admin/archive/inbox?providerKey=e-hentai'
    )
    expect(clearArchiveIntakeItemHref('itemId=item-1')).toBe('/admin/archive/inbox')
  })

  it('reuses a command key after failure and releases it after success', () => {
    const keys = new Map<string, string>()
    const generated = ['key-1', 'key-2']
    const createKey = () => generated.shift()!
    const payload = [{ itemId: 'item-1', quality: 'ORIGINAL' }]

    expect(getOrCreateArchiveCommandKey(keys, 'ENQUEUE', payload, createKey)).toBe('key-1')
    expect(getOrCreateArchiveCommandKey(keys, 'ENQUEUE', payload, createKey)).toBe('key-1')
    releaseArchiveCommandKey(keys, 'ENQUEUE', payload)
    expect(getOrCreateArchiveCommandKey(keys, 'ENQUEUE', payload, createKey)).toBe('key-2')
  })

  it('reports the actual outcome when a corrected URL is not queued', () => {
    expect(archiveReplacementNotice({ acceptedCount: 1, duplicateCount: 0, rejectedCount: 0 }).tone).toBe('success')
    expect(archiveReplacementNotice({ acceptedCount: 0, duplicateCount: 1, rejectedCount: 0 })).toMatchObject({
      tone: 'info',
      title: '修正链接已在收件队列中'
    })
    expect(archiveReplacementNotice({ acceptedCount: 0, duplicateCount: 0, rejectedCount: 1 })).toMatchObject({
      tone: 'warning',
      title: '修正项目未进入解析队列'
    })
  })
})
