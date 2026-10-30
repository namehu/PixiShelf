import { StrictMode, type ReactNode, type Ref } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VerticalMediaPreviewCore } from '../vertical-media-preview-core'

const motionPreference = vi.hoisted(() => ({ reduced: false }))
const swiper = {
  activeIndex: 0,
  allowSlideNext: true,
  allowSlidePrev: true,
  slideNext: vi.fn(),
  slidePrev: vi.fn(),
  slideTo: vi.fn()
}

vi.mock('framer-motion', () => ({ useReducedMotion: () => motionPreference.reduced }))
vi.mock('swiper/modules', () => ({ EffectFade: {}, Keyboard: {}, Mousewheel: {}, Virtual: {}, Zoom: {} }))
vi.mock('swiper/react', () => ({
  Swiper: (props: {
    children: ReactNode
    initialSlide: number
    keyboard: { pageUpDown?: boolean }
    effect: string
    fadeEffect?: { crossFade: boolean }
    speed?: number
    spaceBetween: number
    onSwiper: (value: typeof swiper) => void
    onSlideChange: (value: typeof swiper) => void
    onZoomChange: (value: typeof swiper, scale: number) => void
    onDoubleTap?: (value: typeof swiper, event: MouseEvent | TouchEvent) => void
    'data-testid'?: string
  }) => {
    swiper.activeIndex = props.initialSlide
    props.onSwiper(swiper)
    return (
      <div
        data-testid={props['data-testid']}
        data-page-keys={String(props.keyboard.pageUpDown)}
        onDoubleClick={(event) => props.onDoubleTap?.(swiper, event.nativeEvent)}
        data-effect={props.effect}
        data-cross-fade={String(props.fadeEffect?.crossFade ?? false)}
        data-speed={props.speed}
        data-space-between={props.spaceBetween}
      >
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
  DialogContent: ({ children, ref }: { children: ReactNode; ref?: Ref<HTMLDivElement> }) => (
    <div ref={ref} data-testid="preview-dialog">
      {children}
    </div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>
}))

function Preview({
  items,
  initialIndex = 0,
  open = true,
  onClose = vi.fn(),
  transitionEffect
}: {
  items: number[]
  initialIndex?: number
  open?: boolean
  onClose?: (index: number) => void
  transitionEffect?: 'slide' | 'fade'
}) {
  return (
    <VerticalMediaPreviewCore
      items={items}
      itemKey={(item) => item}
      initialIndex={initialIndex}
      transitionEffect={transitionEffect}
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
    motionPreference.reduced = false
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

  it('uses crossfade only when requested and removes its duration for reduced motion', () => {
    const { rerender } = render(<Preview items={[1, 2]} />)
    const preview = screen.getByTestId('vertical-media-preview-swiper')
    expect(preview.dataset).toMatchObject({ effect: 'slide', crossFade: 'false', spaceBetween: '12' })

    rerender(<Preview items={[1, 2]} transitionEffect="fade" />)
    expect(preview.dataset).toMatchObject({ effect: 'fade', crossFade: 'true', speed: '300', spaceBetween: '0' })

    motionPreference.reduced = true
    rerender(<Preview items={[1, 2]} transitionEffect="fade" />)
    expect(preview.dataset.speed).toBe('0')
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
  it('displays original page numbers while navigation stays inside the filtered sequence', () => {
    render(
      <VerticalMediaPreviewCore
        items={[237, 599]}
        itemKey={(item) => item}
        initialIndex={1}
        open
        counterIndex={598}
        counterTotal={600}
        onClose={vi.fn()}
        historyKey="__filtered_preview__"
        title="预览"
        description="未读图片"
        closeLabel="关闭预览"
        renderSlide={(item) => <span>图片 {item}</span>}
      />
    )
    expect(screen.getByText('599 / 600')).toBeTruthy()
    expect(screen.getByRole('button', { name: '下一张媒体' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '上一张媒体' }).hasAttribute('disabled')).toBe(false)
  })
})

it('reports double-tap coordinates in the dialog, excludes controls and moves navigation away from right docking', () => {
  const onLike = vi.fn()
  const view = render(
    <VerticalMediaPreviewCore
      items={[1, 2]}
      itemKey={(item) => item}
      initialIndex={0}
      open
      onClose={vi.fn()}
      historyKey="point-preview"
      title="预览"
      description="说明"
      closeLabel="关闭"
      onLike={onLike}
      navigationSide="right"
      renderSlide={(item) => (
        <div className="swiper-zoom-container">
          <img alt={`图${item}`} />
          <button>图内控件{item}</button>
        </div>
      )}
    />
  )
  vi.spyOn(screen.getByTestId('preview-dialog'), 'getBoundingClientRect').mockReturnValue({
    left: 20,
    top: 30
  } as DOMRect)
  fireEvent.doubleClick(screen.getByAltText('图1'), { clientX: 120, clientY: 160 })
  expect(onLike).toHaveBeenCalledExactlyOnceWith({ x: 100, y: 130 })
  fireEvent.doubleClick(screen.getByRole('button', { name: '图内控件1' }))
  expect(onLike).toHaveBeenCalledTimes(1)
  view.rerender(
    <VerticalMediaPreviewCore
      items={[1, 2]}
      itemKey={(item) => item}
      initialIndex={0}
      open
      onClose={vi.fn()}
      historyKey="point-preview"
      title="预览"
      description="说明"
      closeLabel="关闭"
      navigationSide="left"
      renderSlide={(item) => <span>{item}</span>}
    />
  )
  expect(
    screen.getByRole('button', { name: '下一张媒体' }).parentElement?.getAttribute('data-preview-navigation')
  ).toBe('left')
})
