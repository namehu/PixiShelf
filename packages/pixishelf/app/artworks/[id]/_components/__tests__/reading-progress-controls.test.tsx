import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'
import { ReadingProgressControls } from '../reading-progress-controls'

afterEach(cleanup)
describe('reading progress reserved layout', () => {
  it('offers a retry for failed explicit restoration even when a cached summary exists', () => {
    const retry = vi.fn()
    const reading = { summary: { totalCount: 3, seenCount: 1, viewCount: 1, status: 'IN_PROGRESS' }, isLoading: false, retry } as unknown as ArtworkReadingHandle
    const error = new Error('reader refresh failed')
    const { container, rerender } = render(<ReadingProgressControls reading={reading} resumeError={error} />)
    expect(container.firstElementChild?.classList.contains('h-20')).toBe(true)
    expect(screen.getByText('继续阅读加载失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalledOnce()

    rerender(<ReadingProgressControls reading={reading} resumeError={error} empty />)
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()

    rerender(<ReadingProgressControls reading={reading} resumeError={error} resumeLoading />)
    expect(screen.getByRole('button', { name: '正在重试…' }).hasAttribute('disabled')).toBe(true)
    expect(container.firstElementChild?.getAttribute('aria-busy')).toBe('true')

    rerender(<ReadingProgressControls reading={reading} />)
    expect(screen.queryByText('继续阅读加载失败')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('阅读 1 次')).toBeTruthy()
  })

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
