import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaType } from '@/types'
import type { RandomImageItem } from '@/types/images'
import { useViewerStore } from '@/store/viewer-store'
import ImageOverlay from '../image-overlay'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next-safe-action/hooks', () => ({
  useOptimisticAction: () => ({
    execute: vi.fn(),
    result: { data: undefined },
    optimisticState: { isLiked: false }
  })
}))
vi.mock('@/hooks/use-heart-animation', () => ({
  useHeartAnimation: () => ({ activeHearts: [], triggerHearts: vi.fn() })
}))
vi.mock('../action-drawer', () => ({ ActionDrawer: () => null }))
vi.mock('../tags-panel', () => ({ default: () => null }))

const artwork: RandomImageItem = {
  id: 1,
  key: 'artwork-1',
  title: 'Test artwork',
  imageUrl: '/image.jpg',
  mediaType: MediaType.IMAGE,
  images: [],
  author: {
    id: 2,
    userId: 'artist-2',
    name: 'Artist',
    username: 'artist',
    avatar: '/avatar.jpg'
  },
  createdAt: '2026-08-11T00:00:00.000Z',
  tags: [],
  isLike: false
}

describe('viewer image overlay', () => {
  beforeEach(() => {
    useViewerStore.setState({ artworkLikeMap: new Map([[artwork.id, false]]), isChromeHidden: false })
  })

  afterEach(() => cleanup())

  it('keeps avatar, like, and more actions inside the bottom information area', () => {
    render(<ImageOverlay isActive image={artwork} onEnterClearMode={vi.fn()} />)

    const information = screen.getByRole('region', { name: '作品信息与操作' })
    expect(within(information).getByRole('button', { name: '查看艺术家 Artist' })).toBeTruthy()
    expect(within(information).getByRole('button', { name: '喜欢作品' })).toBeTruthy()
    expect(within(information).getByRole('button', { name: '更多操作' })).toBeTruthy()
  })
})
