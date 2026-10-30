import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaMarkActions } from '../media-mark-actions'

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
  retry: vi.fn(),
  useMediaMark: vi.fn()
}))
vi.mock('@/hooks/use-media-mark', () => ({ useMediaMark: mocks.useMediaMark }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.useMediaMark.mockReturnValue({
    bookmarkedAt: 'saved',
    likedAt: null,
    available: true,
    isLoading: false,
    isSaving: false,
    error: null,
    set: mocks.set,
    retry: mocks.retry
  })
})
afterEach(cleanup)

describe('media mark actions', () => {
  it('can hide bookmarks while keeping the current-media like action', () => {
    render(<MediaMarkActions artworkId={7} mediaId={42} layout="menu" showBookmark={false} />)
    expect(screen.queryByRole('button', { name: /书签/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '喜欢这张图片' }))
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith('like', true)
  })
  it('hides only inactive detail likes while full-screen and menu actions retain bookmarks and retry', () => {
    const view = render(<MediaMarkActions artworkId={7} mediaId={42} overlay showBookmark={false} hideInactiveLike />)
    expect(screen.queryByRole('button', { name: '喜欢这张图片' })).toBeNull()
    mocks.useMediaMark.mockReturnValue({ available: true, likedAt: 'saved', set: mocks.set })
    view.rerender(<MediaMarkActions artworkId={7} mediaId={42} overlay showBookmark={false} hideInactiveLike />)
    const like = screen.getByRole('button', { name: '取消图片喜欢' })
    expect(like.className).toContain('sm:size-12')
    expect(like.className).toContain('[&_svg]:size-6')
    mocks.useMediaMark.mockReturnValue({ available: false, error: new Error('offline'), retry: mocks.retry })
    view.rerender(<MediaMarkActions artworkId={7} mediaId={42} layout="menu" />)
    expect(screen.getByRole('button', { name: '喜欢这张图片' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '添加图片书签' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试图片标记' })).toBeTruthy()
  })
  it('keeps mark and playback button nodes when changing to vertical orientation', () => {
    const view = render(
      <MediaMarkActions artworkId={7} mediaId={42} overlay>
        <button>播放</button>
      </MediaMarkActions>
    )
    const buttons = screen.getAllByRole('button')
    view.rerender(
      <MediaMarkActions artworkId={7} mediaId={42} overlay orientation="vertical">
        <button>播放</button>
      </MediaMarkActions>
    )
    expect(screen.getAllByRole('button')).toEqual(buttons)
    expect(screen.getByRole('group', { name: '当前图片标记' }).className).toContain('flex-col')
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
    expect(mocks.set.mock.calls).toEqual([
      ['bookmark', false],
      ['like', true]
    ])
    expect(mocks.useMediaMark).toHaveBeenCalledWith(7, 42)
  })
  it('keeps button nodes and their order while switching media and showing a read failure', () => {
    const view = render(
      <MediaMarkActions artworkId={7} mediaId={42} overlay>
        <button>轮播</button>
      </MediaMarkActions>
    )
    const bookmark = screen.getByRole('button', { name: '取消图片书签' })
    const like = screen.getByRole('button', { name: '喜欢这张图片' })
    expect(screen.getAllByRole('button')).toEqual([bookmark, screen.getByText('轮播'), like])
    mocks.useMediaMark.mockReturnValue({ available: false, isLoading: true, error: null })
    view.rerender(
      <MediaMarkActions artworkId={7} mediaId={43} overlay>
        <button>轮播</button>
      </MediaMarkActions>
    )
    expect(screen.getByRole('button', { name: '添加图片书签' })).toBe(bookmark)
    expect(screen.getByRole('button', { name: '喜欢这张图片' })).toBe(like)
    expect(bookmark.getAttribute('aria-pressed')).toBe('false')
    expect(bookmark.className).toContain('disabled:opacity-100')
    mocks.useMediaMark.mockReturnValue({ available: false, error: new Error('offline'), retry: mocks.retry })
    view.rerender(
      <MediaMarkActions artworkId={7} mediaId={43} overlay>
        <button>轮播</button>
      </MediaMarkActions>
    )
    expect(screen.getByRole('button', { name: '添加图片书签' })).toBe(bookmark)
    expect(screen.getByRole('button', { name: '重试图片标记' })).toBeTruthy()
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
  it('keeps retry in the vertical toolbar flow so its scrolling container cannot clip an absolute popup', () => {
    mocks.useMediaMark.mockReturnValue({ available: false, error: new Error('offline'), retry: mocks.retry })
    const view = render(<MediaMarkActions artworkId={7} mediaId={42} overlay />)
    expect(screen.getByRole('button', { name: '重试图片标记' }).className).toContain('absolute')
    view.rerender(<MediaMarkActions artworkId={7} mediaId={42} overlay orientation="vertical" />)
    const retry = screen.getByRole('button', { name: '重试图片标记' })
    expect(retry.className).not.toContain('absolute')
    fireEvent.click(retry)
    expect(mocks.retry).toHaveBeenCalledExactlyOnceWith()
  })
})
