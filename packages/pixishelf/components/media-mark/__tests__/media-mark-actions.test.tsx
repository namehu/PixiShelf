import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaMarkActions } from '../media-mark-actions'

const mocks = vi.hoisted(() => ({
  set: vi.fn(), retry: vi.fn(), useMediaMark: vi.fn()
}))
vi.mock('@/hooks/use-media-mark', () => ({ useMediaMark: mocks.useMediaMark }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.useMediaMark.mockReturnValue({ bookmarkedAt: 'saved', likedAt: null, available: true, isLoading: false, isSaving: false, error: null, set: mocks.set, retry: mocks.retry })
})
afterEach(cleanup)

describe('media mark actions', () => {
  it('can hide bookmarks while keeping the current-media like action', () => {
    render(<MediaMarkActions artworkId={7} mediaId={42} layout="menu" showBookmark={false} />)
    expect(screen.queryByRole('button', { name: /书签/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '喜欢这张图片' }))
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith('like', true)
  })
  it('exposes independent pressed states and accessible 44px actions', () => {
    render(<MediaMarkActions artworkId={7} mediaId={42} />)
    const bookmark = screen.getByRole('button', { name: '取消图片书签' })
    const like = screen.getByRole('button', { name: '喜欢这张图片' })
    expect(bookmark.getAttribute('aria-pressed')).toBe('true')
    expect(like.getAttribute('aria-pressed')).toBe('false')
    expect(bookmark.className).toContain('min-h-11')
    fireEvent.click(bookmark)
    fireEvent.click(like)
    expect(mocks.set.mock.calls).toEqual([['bookmark', false], ['like', true]])
    expect(mocks.useMediaMark).toHaveBeenCalledWith(7, 42)
  })
  it('disables unavailable media and retries failed initial reads', () => {
    mocks.useMediaMark.mockReturnValue({ available: false, isLoading: false, error: null })
    const { rerender } = render(<MediaMarkActions artworkId={7} mediaId={null} layout="menu" />)
    expect((screen.getByRole('button', { name: '添加图片书签' }) as HTMLButtonElement).disabled).toBe(true)
    mocks.useMediaMark.mockReturnValue({ available: false, error: new Error('offline'), retry: mocks.retry })
    rerender(<MediaMarkActions artworkId={7} mediaId={42} layout="menu" />)
    fireEvent.click(screen.getByRole('button', { name: '重试图片标记' }))
    expect(mocks.retry).toHaveBeenCalledOnce()
  })
})
