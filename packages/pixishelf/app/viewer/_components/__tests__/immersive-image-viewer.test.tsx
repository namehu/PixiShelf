import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect, type ComponentProps, type ReactNode } from 'react'
import type { Swiper as SwiperType } from 'swiper'
import type ImageSlide from '../image-slide'
import { MediaType } from '@/types'
import type { RandomImageItem } from '@/types/images'
import { useViewerStore } from '@/store/viewer-store'
import ImmersiveImageViewer from '../immersive-image-viewer'

const swiperModules = vi.hoisted(() => ({
  keyboard: { enable: vi.fn(), disable: vi.fn() },
  mousewheel: { enable: vi.fn(), disable: vi.fn() },
  activeIndex: 0,
  slideTo: vi.fn(),
  destroyed: false
}))

vi.mock('@/lib/reading/reading-provider', () => ({ useArtworkReading: () => ({ invalidated: false }) }))
vi.mock('swiper/react', () => ({
  Swiper: function MockSwiper({
    children,
    allowTouchMove,
    onSlideChange,
    onSwiper
  }: {
    children: ReactNode
    allowTouchMove: boolean
    onSlideChange: (swiper: { activeIndex: number }) => void
    onSwiper: (swiper: SwiperType) => void
  }) {
    useEffect(() => onSwiper(swiperModules as unknown as SwiperType), [onSwiper])
    return (
      <div data-testid="swiper" data-touch={allowTouchMove}>
        <button onClick={() => onSlideChange({ activeIndex: 1 })}>下一部</button>
        <button onClick={() => onSlideChange({ activeIndex: 2 })}>浏览结束</button>
        {children}
      </div>
    )
  },
  SwiperSlide: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))
vi.mock('../image-slide', () => ({
  default: (props: ComponentProps<typeof ImageSlide>) =>
    props.isActive ? (
      <div>
        <span>当前作品 {props.image.id}</span>
        <button onClick={props.onToggleChrome}>画面单击</button>
        <button onClick={() => props.onOverlayPanelOpenChange?.(true)}>打开操作面板</button>
        <button onClick={() => props.onOverlayPanelOpenChange?.(false)}>关闭操作面板</button>
        <button onClick={() => props.onChapterPanelOpenChange(true)}>打开章节</button>
        <span data-testid="chapter-state">{String(props.chapterPanelOpen)}</span>
      </div>
    ) : null
}))

const images: RandomImageItem[] = [1, 2].map((id) => ({
  id,
  key: `artwork-${id}`,
  title: 'Artwork',
  imageUrl: '/image.jpg',
  mediaType: MediaType.IMAGE,
  images: [],
  author: null,
  createdAt: '2026-08-11T00:00:00.000Z',
  tags: [],
  isLike: false
}))
const props = {
  playbackRate: 1 as const,
  onPlaybackRateChange: vi.fn(),
  initialImages: images,
  hasMore: false,
  isLoading: false,
  onLoadMore: vi.fn()
}

describe('immersive viewer chrome', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    swiperModules.activeIndex = 0
    useViewerStore.setState({ images, verticalIndex: 0, isChromeHidden: false })
    history.replaceState({}, '', window.location.href)
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('aligns the gesture surface after a cached feed resets the browsing index', () => {
    useViewerStore.setState({ verticalIndex: 1 })
    swiperModules.activeIndex = 1
    render(<ImmersiveImageViewer {...props} />)
    act(() => useViewerStore.setState({ verticalIndex: 0 }))
    expect(swiperModules.slideTo).toHaveBeenCalledWith(0, 0)
    expect(screen.getByText('当前作品 1')).toBeTruthy()
  })

  it('lets the end surface restore chrome without leaving the last artwork active', () => {
    vi.useFakeTimers()
    render(<ImmersiveImageViewer {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '隐藏界面' }))
    fireEvent.click(screen.getByRole('button', { name: '浏览结束' }))
    expect(screen.queryByText('当前作品 2')).toBeNull()
    const point = { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 50, clientY: 50 }
    fireEvent.pointerDown(screen.getByText('已浏览全部作品'), point)
    fireEvent.pointerUp(screen.getByText('已浏览全部作品'), point)
    act(() => vi.advanceTimersByTime(300))
    expect(useViewerStore.getState().isChromeHidden).toBe(false)
  })

  it('toggles without adding or traversing history and keeps the state across artworks', () => {
    const push = vi.spyOn(history, 'pushState')
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined)
    render(<ImmersiveImageViewer {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '画面单击' }))
    expect(useViewerStore.getState().isChromeHidden).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '下一部' }))
    expect(screen.getByText('当前作品 2')).toBeTruthy()
    expect(useViewerStore.getState().isChromeHidden).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '显示界面' }))
    expect(useViewerStore.getState().isChromeHidden).toBe(false)
    expect(push).not.toHaveBeenCalled()
    expect(back).not.toHaveBeenCalled()
  })

  it.each(['shortcut', 'blur'] as const)('cancels a pending end-surface tap on %s', (reason) => {
    vi.useFakeTimers()
    render(<ImmersiveImageViewer {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '浏览结束' }))
    const point = { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 50, clientY: 50 }
    fireEvent.pointerDown(screen.getByText('已浏览全部作品'), point)
    fireEvent.pointerUp(screen.getByText('已浏览全部作品'), point)
    if (reason === 'shortcut') fireEvent.keyDown(window, { key: 'c' })
    else fireEvent.blur(window)
    act(() => vi.advanceTimersByTime(300))
    expect(useViewerStore.getState().isChromeHidden).toBe(reason === 'shortcut')
  })

  it('supports C and Escape, but ignores modified keys and open panels', () => {
    const view = render(<ImmersiveImageViewer {...props} />)
    fireEvent.keyDown(window, { key: 'c' })
    expect(useViewerStore.getState().isChromeHidden).toBe(true)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useViewerStore.getState().isChromeHidden).toBe(false)
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    fireEvent.keyDown(screen.getByRole('button', { name: '隐藏界面' }), { key: 'c' })
    expect(useViewerStore.getState().isChromeHidden).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '打开操作面板' }))
    fireEvent.keyDown(window, { key: 'c' })
    expect(useViewerStore.getState().isChromeHidden).toBe(false)
    expect(screen.getByTestId('swiper').getAttribute('data-touch')).toBe('false')
    expect(swiperModules.keyboard.disable).toHaveBeenCalled()
    expect(swiperModules.mousewheel.disable).toHaveBeenCalled()
    swiperModules.keyboard.enable.mockClear()
    swiperModules.mousewheel.enable.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '关闭操作面板' }))
    expect(screen.getByTestId('swiper').getAttribute('data-touch')).toBe('true')
    expect(swiperModules.keyboard.enable).toHaveBeenCalledOnce()
    expect(swiperModules.mousewheel.enable).toHaveBeenCalledOnce()
    view.rerender(<ImmersiveImageViewer {...props} interactionLocked />)
    fireEvent.keyDown(window, { key: 'c' })
    expect(useViewerStore.getState().isChromeHidden).toBe(false)
  })

  it('retains the chapter history entry and closes chapters on Back', () => {
    const push = vi.spyOn(history, 'pushState')
    render(<ImmersiveImageViewer {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '打开章节' }))
    expect(push).toHaveBeenCalledOnce()
    expect(screen.getByTestId('chapter-state').textContent).toBe('true')
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: {} })))
    expect(screen.getByTestId('chapter-state').textContent).toBe('false')
    expect(useViewerStore.getState().isChromeHidden).toBe(false)
  })
})
