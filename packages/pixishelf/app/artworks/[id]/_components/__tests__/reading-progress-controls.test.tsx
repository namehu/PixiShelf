import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'
import { ReadingProgressControls } from '../reading-progress-controls'

afterEach(cleanup)
describe('reading progress reserved layout', () => {
  it('reserves the same block through a delayed response, error, and completion', () => {
    const loading = { summary: null, isLoading: true, retry: vi.fn() } as unknown as ArtworkReadingHandle
    const { container, rerender } = render(<ReadingProgressControls reading={loading} />)
    expect(container.firstElementChild?.classList.contains('h-20')).toBe(true)
    expect(screen.getByText('正在加载阅读状态…')).toBeTruthy()
    rerender(<ReadingProgressControls reading={{ ...loading, isLoading: false, error: new Error('offline') }} />)
    expect(container.firstElementChild?.classList.contains('h-20')).toBe(true)
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
    rerender(<ReadingProgressControls reading={{ ...loading, isLoading: false,
      summary: { totalCount: 3000, seenCount: 3000, viewCount: 1, status: 'COMPLETED' } as ArtworkReadingHandle['summary']
    }} />)
    expect(container.firstElementChild?.classList.contains('h-20')).toBe(true)
    expect(screen.getByText('已读完 · 3000 张')).toBeTruthy()
  })
})
