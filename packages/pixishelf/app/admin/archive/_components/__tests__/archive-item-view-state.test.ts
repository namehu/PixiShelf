import { describe, expect, it } from 'vitest'
import { archiveItemPollingIntervals, defaultArchiveItemFilter } from '../archive-item-view-state'

describe('archive item drawer view state', () => {
  it('opens partial failures on the failed filter and other tasks on all items', () => {
    expect(defaultArchiveItemFilter('FAILED', 'PARTIAL_FAILURE')).toBe('FAILED')
    expect(defaultArchiveItemFilter('FAILED', 'REMOTE_RESPONSE_INVALID')).toBe('ALL')
    expect(defaultArchiveItemFilter('RUNNING', null)).toBe('ALL')
  })

  it('polls active tasks at separate count and detail intervals and stops for terminal tasks', () => {
    expect(archiveItemPollingIntervals('RUNNING')).toEqual({ counts: 1_500, items: 3_000 })
    expect(archiveItemPollingIntervals('PENDING')).toEqual({ counts: 1_500, items: 3_000 })
    expect(archiveItemPollingIntervals('FAILED')).toEqual({ counts: false, items: false })
    expect(archiveItemPollingIntervals('COMPLETED')).toEqual({ counts: false, items: false })
  })
})
