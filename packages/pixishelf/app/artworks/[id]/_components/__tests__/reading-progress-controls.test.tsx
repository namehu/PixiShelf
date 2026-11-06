import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'
import { ReadingProgressControls } from '../reading-progress-controls'

afterEach(cleanup)
describe('reading progress reserved layout', () => {
  it('shows a single completed progress value', () => {
    const reading = { summary: { totalCount: 100, progressCount: 90, viewCount: 1, status: 'COMPLETED', completed: true, furthestMediaId: null, furthestMediaIndex: null } } as unknown as ArtworkReadingHandle
    const { rerender } = render(<ReadingProgressControls reading={reading} />)
    expect(screen.getByRole('status').textContent).toBe('已读完 · 100 张')
    rerender(<ReadingProgressControls reading={{ ...reading, summary: { ...reading.summary!, progressCount: 100 } }} />)
    expect(screen.getByRole('status').textContent).toBe('已读完 · 100 张')
  })

  it('offers a retry for failed explicit restoration even when a cached summary exists', () => {
    const retry = vi.fn()
    const reading = { summary: { totalCount: 3, progressCount: 1, viewCount: 1, status: 'IN_PROGRESS', completed: false, furthestMediaId: null, furthestMediaIndex: null }, isLoading: false, retry } as unknown as ArtworkReadingHandle
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
      summary: { totalCount: 3000, progressCount: 3000, viewCount: 1, status: 'COMPLETED', completed: true, furthestMediaId: null, furthestMediaIndex: null } as ArtworkReadingHandle['summary']
    }} />)
    expect(container.firstElementChild?.classList.contains('h-20')).toBe(true)
    expect(screen.getByText('已读完 · 3000 张')).toBeTruthy()
  })
})

describe('reading progress footer action', () => {
  function createReading(overrides: Partial<ArtworkReadingHandle> = {}): ArtworkReadingHandle {
    return {
      ownerUserId: 'alice', context: {}, isLoading: false, marking: false, markError: null,
      markRead: vi.fn().mockResolvedValue(undefined),
      summary: { totalCount: 100, progressCount: 90, viewCount: 2, status: 'IN_PROGRESS', completed: false, furthestMediaId: null, furthestMediaIndex: null },
      ...overrides
    } as ArtworkReadingHandle
  }

  it('keeps header metadata only and exposes whole-work completion in the footer', () => {
    const reading = createReading()
    const { rerender } = render(<ReadingProgressControls reading={reading} />)
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<ReadingProgressControls reading={reading} showMarkAll />)
    expect(screen.getByRole('status').textContent).toBe('已读 90 / 100· 剩余 10')
    expect(screen.getByText('阅读 2 次')).toBeTruthy()
    const action = screen.getByRole('button', { name: '标记已读完' })
    expect(action.hasAttribute('disabled')).toBe(false)
    expect(action.textContent).toBe('')
    expect(action.getAttribute('title')).toBe('标记已读完')
    fireEvent.click(action)
    expect(reading.markRead).toHaveBeenCalledExactlyOnceWith()
  })

  it.each(['loading', 'context', 'owner', 'completed', 'empty'] as const)('disables marking when %s', (state) => {
    const reading = createReading()
    if (state === 'loading') reading.isLoading = true
    if (state === 'context') reading.context = undefined
    if (state === 'owner') reading.ownerUserId = null
    if (state === 'completed') reading.summary = { ...reading.summary!, completed: true, progressCount: 100 }
    if (state === 'empty') reading.summary = { ...reading.summary!, progressCount: 0, totalCount: 0 }
    render(<ReadingProgressControls reading={reading} showMarkAll />)
    const action = screen.getByRole('button', { name: '标记已读完' })
    expect(action.hasAttribute('disabled')).toBe(true)
    fireEvent.click(action)
    expect(reading.markRead).not.toHaveBeenCalled()
  })

  it('keeps the saving indicator during optimistic completion and allows retry after a failed save', () => {
    const reading = createReading()
    const { rerender } = render(<ReadingProgressControls reading={reading} showMarkAll />)
    fireEvent.click(screen.getByRole('button', { name: '标记已读完' }))
    rerender(<ReadingProgressControls reading={{ ...reading, marking: true, summary: { ...reading.summary!, progressCount: 100 } }} showMarkAll />)
    const saving = screen.getByRole('button', { name: '标记已读完' })
    expect(saving.hasAttribute('disabled')).toBe(true)
    expect(saving.getAttribute('aria-busy')).toBe('true')
    expect(saving.querySelector('svg')?.classList.contains('animate-spin')).toBe(true)
    rerender(<ReadingProgressControls reading={{ ...reading, markError: '标记未保存，请重试。' }} showMarkAll />)
    expect(screen.getByRole('alert').textContent).toBe('标记未保存，请重试。')
    expect(screen.getByRole('status').textContent).toBe('已读 90 / 100· 剩余 10')
    const retry = screen.getByRole('button', { name: '标记已读完' })
    expect(retry.hasAttribute('disabled')).toBe(false)
    fireEvent.click(retry)
    expect(reading.markRead).toHaveBeenCalledTimes(2)
  })

  it('retains the true summary when the unread filter has no displayed images', () => {
    const reading = createReading()
    render(<ReadingProgressControls reading={reading} empty showMarkAll />)
    expect(screen.getByRole('status').textContent).toBe('已读 90 / 100· 剩余 10')
    expect(screen.getByText('阅读 2 次')).toBeTruthy()
  })
})
