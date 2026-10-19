import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useViewerStore } from '@/store/viewer-store'
import type { ReactNode } from 'react'
import type { RandomImageItem } from '@/types/images'
import { MediaType } from '@/types'

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
  isLike: false
}

describe('ActionDrawer', () => {
  beforeEach(() => {
    useViewerStore.getState().resetViewerState()
    useViewerStore.setState({ autoBrowseInterval: 5 })
  })
  afterEach(cleanup)
  it('offers four persisted intervals and requests start only after closing the menu', () => {
    const close = vi.fn()
    render(<ActionDrawer open onOpenChange={close} image={image} onHideChrome={vi.fn()} />)
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
    const onHideChrome = vi.fn()
    render(<ActionDrawer open onOpenChange={onOpenChange} image={image} onHideChrome={onHideChrome} />)

    expect(screen.queryByText('浏览模式')).toBeNull()
    expect(screen.queryByText('最大图片数量')).toBeNull()
    expect(screen.queryByText('媒体类型')).toBeNull()

    const artworkLink = screen.getByRole('link', { name: '查看作品详情' })
    expect(artworkLink.getAttribute('href')).toBe('/artworks/7')
    fireEvent.click(artworkLink)
    expect(onOpenChange).toHaveBeenCalledWith(false)

    expect(screen.getByRole('link', { name: '查看艺术家' }).getAttribute('href')).toBe('/artists/9')

    fireEvent.click(screen.getByRole('button', { name: '隐藏界面' }))
    expect(onHideChrome).toHaveBeenCalledOnce()
  })
})
