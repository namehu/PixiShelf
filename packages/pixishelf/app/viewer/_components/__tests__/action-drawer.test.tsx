import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useViewerStore } from '@/store/viewer-store'
import type { ReactNode } from 'react'
import type { RandomImageItem } from '@/types/images'
import { MediaType } from '@/types'

vi.mock('@/components/media-mark/media-mark-actions', () => ({
  MediaMarkActions: ({ artworkId, mediaId, showBookmark }: { artworkId: number; mediaId: number | null; showBookmark?: boolean }) =>
    <div data-testid="media-mark-actions" data-artwork-id={artworkId} data-media-id={mediaId} data-bookmark={String(showBookmark)} />
}))

vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

import { ActionDrawer } from '../action-drawer'

const image: RandomImageItem = {
  id: 7,
  key: '7',
  title: 'Artwork',
  description: '',
  imageUrl: '/image.jpg',
  mediaType: MediaType.IMAGE,
  images: [],
  author: { id: 9, userId: '9', name: 'Artist', username: 'artist' },
  createdAt: '2026-08-12T00:00:00.000Z',
  tags: [],
  isLike: false,
  ratingLevel: null
}

describe('ActionDrawer', () => {
  beforeEach(() => {
    useViewerStore.getState().resetViewerState()
    useViewerStore.setState({ autoBrowseInterval: 5 })
  })
  afterEach(cleanup)
  it('marks the current logical media and disables the artwork-cover fallback', () => {
    const { rerender } = render(<ActionDrawer open onOpenChange={vi.fn()} image={image} currentMediaId={42} />)
    expect(screen.getByTestId('media-mark-actions').getAttribute('data-media-id')).toBe('42')
    expect(screen.getByTestId('media-mark-actions').getAttribute('data-artwork-id')).toBe('7')
    expect(screen.getByTestId('media-mark-actions').getAttribute('data-bookmark')).toBe('false')
    rerender(<ActionDrawer open onOpenChange={vi.fn()} image={image} />)
    expect(screen.getByTestId('media-mark-actions').hasAttribute('data-media-id')).toBe(false)
    expect(screen.getByText('当前仅展示作品封面，暂无可标记的图片。')).toBeTruthy()
  })
  it('offers four persisted intervals and requests start only after closing the menu', () => {
    const close = vi.fn()
    render(<ActionDrawer open onOpenChange={close} image={image} />)
    for (const seconds of [3, 5, 10, 15]) {
      fireEvent.click(screen.getByText(`${seconds} 秒`))
      expect(useViewerStore.getState().autoBrowseInterval).toBe(seconds)
    }
    fireEvent.click(screen.getByText('开始自动浏览'))
    expect(close).toHaveBeenCalledWith(false)
    expect(useViewerStore.getState().autoBrowseStartRequested).toBe(true)
    expect(useViewerStore.getState().autoBrowseStatus).toBe('off')
  })
  it('keeps artwork actions and removes feed-level settings', () => {
    const onOpenChange = vi.fn()
    render(<ActionDrawer open onOpenChange={onOpenChange} image={image} />)

    expect(screen.queryByText('浏览模式')).toBeNull()
    expect(screen.queryByText('最大图片数量')).toBeNull()
    expect(screen.queryByText('媒体类型')).toBeNull()

    const artworkLink = screen.getByRole('link', { name: '查看作品详情' })
    expect(artworkLink.getAttribute('href')).toBe('/artworks/7')
    fireEvent.click(artworkLink)
    expect(onOpenChange).toHaveBeenCalledWith(false)

    expect(screen.getByRole('link', { name: '查看艺术家' }).getAttribute('href')).toBe('/artists/9')

    expect(screen.queryByRole('button', { name: '隐藏界面' })).toBeNull()
  })
})
