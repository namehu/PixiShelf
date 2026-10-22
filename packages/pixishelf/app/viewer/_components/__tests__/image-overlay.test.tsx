import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaType } from '@/types'
import type { RandomImageItem } from '@/types/images'
import { useViewerStore } from '@/store/viewer-store'
import ImageOverlay from '../image-overlay'

const rating = vi.hoisted(() => ({
  level: null as null | 1 | 2 | 3 | 4,
  confirmedLevel: null,
  isLoading: false,
  isSaving: false,
  error: null,
  setLevel: vi.fn(),
  retry: vi.fn()
}))
vi.mock('@/hooks/use-artwork-rating', () => ({ useArtworkRating: () => rating }))
vi.mock('@/components/auth', () => ({
  useAuthUser: () => ({ id: 'alice' })
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
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
  isLike: false,
  ratingLevel: null
}

describe('viewer image overlay', () => {
  beforeEach(() => {
    rating.setLevel.mockClear()
    rating.level = null
    rating.isSaving = false
    useViewerStore.setState({ artworkRatingMap: new Map([[artwork.id, null]]), isChromeHidden: false })
  })

  afterEach(() => cleanup())

  it('keeps progress accessible while hiding information without unmounting controls', () => {
    render(<ImageOverlay isActive image={artwork} onHideChrome={vi.fn()} mediaControls={<button>播放器</button>} />)
    const player = screen.getByRole('button', { name: '播放器' })
    act(() => useViewerStore.getState().setChromeHidden(true))
    expect(screen.queryByRole('region', { name: '作品信息与操作' })).toBeNull()
    expect(player.closest('[inert]')).toBeNull()
    expect(screen.getByRole('region', { name: '浏览进度' }).contains(player)).toBe(true)
    expect(screen.queryByRole('button', { name: /喜欢作品/ })).toBeNull()
    expect(screen.getByText('Test artwork').closest('[inert]')).not.toBeNull()
    act(() => useViewerStore.getState().setChromeHidden(false))
    expect(screen.getByRole('button', { name: '播放器' })).toBe(player)
  })

  it('reports open artwork actions to block parent gestures', () => {
    const onPanelOpenChange = vi.fn()
    const view = render(
      <ImageOverlay isActive image={artwork} onHideChrome={vi.fn()} onPanelOpenChange={onPanelOpenChange} />
    )
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }))
    expect(onPanelOpenChange).toHaveBeenLastCalledWith(true)
    view.unmount()
    expect(onPanelOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('still likes through the button and exposes only the action drawer to gestures', async () => {
    const api = vi.fn()
    render(<ImageOverlay isActive image={artwork} onHideChrome={vi.fn()} onInteractionApiChange={api} />)
    expect(api).toHaveBeenLastCalledWith({ openActions: expect.any(Function) })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /喜欢作品/ })))
    expect(rating.setLevel).toHaveBeenCalledExactlyOnceWith(2)
  })

  it.each([2, 3, 4] as const)('clears a lit heart at rating %s and describes the loss of its score', (level) => {
    rating.level = level
    render(<ImageOverlay isActive image={artwork} onHideChrome={vi.fn()} />)
    const button = screen.getByRole('button', { name: /当前评分：.+；取消喜欢并清除评分/ })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'))
    fireEvent.click(button)
    expect(rating.setLevel).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('upgrades 一般 to 喜欢 and accepts another choice while a save is pending', () => {
    rating.level = 1
    rating.isSaving = true
    render(<ImageOverlay isActive image={artwork} onHideChrome={vi.fn()} />)
    const button = screen.getByRole('button', { name: '当前评分：一般；喜欢作品' })
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(button.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(button)
    expect(rating.setLevel).toHaveBeenCalledExactlyOnceWith(2)
  })

  it('keeps avatar, like, and more actions inside the bottom information area', () => {
    render(<ImageOverlay isActive image={artwork} onHideChrome={vi.fn()} />)

    const information = screen.getByRole('region', { name: '作品信息与操作' })
    expect(within(information).getByRole('link', { name: 'Test artwork' }).getAttribute('href')).toBe('/artworks/1')
    expect(within(information).getByRole('link', { name: '查看艺术家 Artist' }).getAttribute('href')).toBe('/artists/2')
    expect(within(information).getByRole('button', { name: /喜欢作品/ }).className).toContain('size-11')
    expect(within(information).getByRole('button', { name: '更多操作' }).className).toContain('size-11')
  })
})
