import { describe, expect, it } from 'vitest'
import {
  getReadingStatus,
  isVideoReadingComplete,
  compareReadingVersion,
  type ReadingSummaryDto
} from '../reading-contract'

describe('position reading contract', () => {
  it.each([
    [{ completed: false, progressCount: 0, viewCount: 0 }, 'UNREAD'],
    [{ completed: false, progressCount: 0, viewCount: 1 }, 'IN_PROGRESS'],
    [{ completed: false, progressCount: 90, viewCount: 0 }, 'IN_PROGRESS'],
    [{ completed: true, progressCount: 112, viewCount: 0 }, 'COMPLETED']
  ] as const)('uses explicit completion and real activity', (summary, expected) =>
    expect(getReadingStatus(summary)).toBe(expected)
  )
  it('orders layout before state version', () => {
    const a = { readingLayoutVersion: 2, stateVersion: 0 } as ReadingSummaryDto
    const b = { readingLayoutVersion: 1, stateVersion: 999 } as ReadingSummaryDto
    expect(compareReadingVersion(a, b)).toBeGreaterThan(0)
  })
  it('keeps the video threshold separate', () => {
    expect(isVideoReadingComplete({ currentTime: 89.99, duration: 100 })).toBe(false)
    expect(isVideoReadingComplete({ currentTime: 90, duration: 100 })).toBe(true)
    expect(isVideoReadingComplete({ currentTime: 0.45, duration: 0.5 })).toBe(true)
    expect(isVideoReadingComplete({ currentTime: 0, duration: 0 })).toBe(false)
  })
})
