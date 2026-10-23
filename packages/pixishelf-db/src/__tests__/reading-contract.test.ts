import { describe, expect, it } from 'vitest'
import { getReadingStatus, isArtworkReadingComplete, isVideoReadingComplete } from '../reading-contract'

describe('artwork reading completion', () => {
  it.each([
    [0, 0, false],
    [0, 1, false],
    [1, 1, true],
    [8, 9, false],
    [9, 10, true],
    [17, 20, false],
    [18, 20, true],
    [89, 100, false],
    [90, 100, true],
    [98, 100, true],
    [899, 1000, false],
    [900, 1000, true],
    [100, 111, true],
    [100, 112, false]
  ])('classifies %i / %i without rounding or a fixed missing-item allowance', (seenCount, totalCount, completed) => {
    expect(isArtworkReadingComplete(seenCount, totalCount)).toBe(completed)
    expect(getReadingStatus({ seenCount, totalCount, viewCount: 0 }))
      .toBe(completed ? 'COMPLETED' : seenCount > 0 ? 'IN_PROGRESS' : 'UNREAD')
  })

  it('keeps real viewing activity separate from counted media and empty works', () => {
    expect(getReadingStatus({ seenCount: 0, totalCount: 1, viewCount: 1 })).toBe('IN_PROGRESS')
    expect(getReadingStatus({ seenCount: 0, totalCount: 0, viewCount: 1 })).toBe('IN_PROGRESS')
    expect(getReadingStatus({ seenCount: 0, totalCount: 1, viewCount: 0 })).toBe('UNREAD')
  })

  it('retains the video item threshold independently of artwork completion', () => {
    expect(isVideoReadingComplete({ currentTime: 89.9, duration: 100 })).toBe(false)
    expect(isVideoReadingComplete({ currentTime: 90, duration: 100 })).toBe(true)
    expect(isVideoReadingComplete({ currentTime: 0, duration: 0 })).toBe(false)
  })
})
