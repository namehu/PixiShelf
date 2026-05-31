import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useCurrentChapter } from './use-current-chapter'
import type { NormalizedChapter } from './video-chapters'

const chapters: NormalizedChapter[] = [
  {
    id: 'chapter-1-0',
    index: 1,
    title: 'Opening',
    start: 0,
    end: 12,
    duration: 12
  },
  {
    id: 'chapter-2-20',
    index: 2,
    title: 'Main',
    start: 20,
    end: 50,
    duration: 30
  }
]

describe('useCurrentChapter', () => {
  it('returns current chapter within chapter range', () => {
    const { result } = renderHook(() => useCurrentChapter(chapters, 21))

    expect(result.current?.id).toBe('chapter-2-20')
  })

  it('returns undefined when current time is in a gap', () => {
    const { result } = renderHook(() => useCurrentChapter(chapters, 15))

    expect(result.current).toBeUndefined()
  })

  it('returns last chapter when current time equals the final chapter end', () => {
    const { result } = renderHook(() => useCurrentChapter(chapters, 50))

    expect(result.current?.id).toBe('chapter-2-20')
  })
})
