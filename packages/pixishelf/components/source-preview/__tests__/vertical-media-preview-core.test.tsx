import { StrictMode, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VerticalMediaPreviewCore } from '../vertical-media-preview-core'

const swiper = {
  activeIndex: 0,
  allowSlideNext: true,
  allowSlidePrev: true,
  slideNext: vi.fn(),
  slidePrev: vi.fn(),
  slideTo: vi.fn()
}

vi.mock('swiper/modules', () => ({ Keyboard: {}, Virtual: {}, Zoom: {} }))
vi.mock('swiper/react', () => ({
  Swiper: (props: {
    children: ReactNode
    initialSlide: number
    keyboard: { pageUpDown?: boolean }
    onSwiper: (value: typeof swiper) => void
    onSlideChange: (value: typeof swiper) => void
    onZoomChange: (value: typeof swiper, scale: number) => void
    'data-testid'?: string
  }) => {
    swiper.activeIndex = props.initialSlide
    props.onSwiper(swiper)
    return (
      <div data-testid={props['data-testid']} data-page-keys={String(props.keyboard.pageUpDown)}>
        {props.children}
        <button
          type="button"
          onClick={() => {
            swiper.activeIndex = 1
            props.onSlideChange(swiper)
          }}
        >
          切到第二张
        </button>
        <button type="button" onClick={() => props.onZoomChange(swiper, 2)}>
          放大
        </button>
        <button
          type="button"
          onClick={() => {
            swiper.activeIndex = 3
            props.onSlideChange(swiper)
          }}
        >
          切到第四张
        </button>
      </div>
    )
  },
  SwiperSlide: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? children : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>
}))

function Preview({
  items,
  initialIndex = 0,
  open = true,
  onClose = vi.fn()
}: {
  items: number[]
  initialIndex?: number
  open?: boolean
  onClose?: (index: number) => void
}) {
  return (
    <VerticalMediaPreviewCore
      items={items}
      itemKey={(item) => item}
      initialIndex={initialIndex}
      open={open}
      onClose={onClose}
      historyKey="__preview_test__"
      title="预览"
      description="上下浏览"
      closeLabel="关闭预览"
      renderSlide={(item) => <span>图片 {item}</span>}
    />
  )
}

describe('VerticalMediaPreviewCore', () => {
  beforeEach(() => {
    history.replaceState({}, '', window.location.href)
    swiper.activeIndex = 0
    swiper.allowSlideNext = true
    swiper.allowSlidePrev = true
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('creates one history entry in StrictMode and keeps the active item while pages append', () => {
    const push = vi.spyOn(history, 'pushState')
    const { rerender } = render(
      <StrictMode>
        <Preview items={[1, 2]} />
      </StrictMode>
    )

    expect(push).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '切到第二张' }))
    expect(screen.getByText('2 / 2')).toBeTruthy()

    rerender(
      <StrictMode>
        <Preview items={[1, 2, 3]} initialIndex={2} />
      </StrictMode>
    )

    expect(push).toHaveBeenCalledTimes(1)
    expect(screen.getByText('2 / 3')).toBeTruthy()
    expect(screen.getByTestId('vertical-media-preview-swiper').getAttribute('data-page-keys')).toBe('true')

    rerender(
      <StrictMode>
        <Preview items={[1, 2, 3, 4]} initialIndex={3} />
      </StrictMode>
    )
    fireEvent.click(screen.getByRole('button', { name: '切到第四张' }))
    expect(screen.getByText('4 / 4')).toBeTruthy()
  })

  it('closes once through the owned history entry and disables paging while zoomed', () => {
    const onClose = vi.fn()
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined)
    render(<Preview items={[1, 2]} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(swiper.allowSlideNext).toBe(false)
    expect(swiper.allowSlidePrev).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }))
    expect(back).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()

    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: {} })))
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: {} })))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith(0)
  })

  it('consumes its history entry when a parent closes the controlled overlay', () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined)
    const { rerender } = render(<Preview items={[1, 2]} />)

    rerender(<Preview items={[1, 2]} open={false} />)
    rerender(<Preview items={[1, 2]} open={false} />)

    expect(back).toHaveBeenCalledTimes(1)
  })
})
