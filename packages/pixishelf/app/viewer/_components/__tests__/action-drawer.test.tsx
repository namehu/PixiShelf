import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { RandomImageItem } from '@/types/images'
import { MediaType } from '@/types'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))
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
  it('keeps artwork actions and removes feed-level settings', () => {
    const onOpenChange = vi.fn()
    const onEnterClearMode = vi.fn()
    render(
      <ActionDrawer open onOpenChange={onOpenChange} image={image} onEnterClearMode={onEnterClearMode} />
    )

    expect(screen.queryByText('浏览模式')).toBeNull()
    expect(screen.queryByText('最大图片数量')).toBeNull()
    expect(screen.queryByText('媒体类型')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '查看作品详情' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(pushMock).toHaveBeenCalledWith('/artworks/7')

    fireEvent.click(screen.getByRole('button', { name: '清屏播放' }))
    expect(onEnterClearMode).toHaveBeenCalledOnce()
  })
})
