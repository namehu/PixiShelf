import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LazyMedia from '../lazy-media'

const playerMocks = vi.hoisted(() => ({ props: vi.fn(), animatedProps: vi.fn(), imageProps: vi.fn() }))
const enqueue = vi.hoisted(() => vi.fn())
const cancel = vi.hoisted(() => vi.fn())
const optimizationState = vi.hoisted(() => ({
  job: null as null | { status: string; progress: number; message: string; queuePosition?: number },
  isStarting: false,
  canManage: true,
  suspendPlayback: false,
  enqueue,
  cancel
}))

vi.mock('@/components/players/video-player', () => ({
  default: (props: { src: string; settingActions?: unknown[] }) => {
    playerMocks.props(props)
    return <div data-testid="video-player" data-src={props.src} />
  }
}))
vi.mock('@/components/players/apng-player', () => ({ default: () => null }))
vi.mock('@/components/players/animated-webp-player', () => ({
  default: (props: { isAnimated?: boolean }) => {
    playerMocks.animatedProps(props)
    return <div data-testid="animated-image-player" />
  }
}))
vi.mock('next/image', () => ({
  default: (props: { src: string }) => {
    playerMocks.imageProps(props)
    return <div data-testid="static-image" />
  }
}))
vi.mock('react-intersection-observer', () => ({ useOnInView: () => vi.fn() }))
vi.mock('@/store/use-artwork-store', () => ({
  useArtworkStore: (selector: (state: { setCurrentIndex: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({ setCurrentIndex: vi.fn() })
}))
vi.mock('../artwork-video-optimization-context', () => ({
  useArtworkVideoOptimization: () => optimizationState
}))

describe('LazyMedia video cache version', () => {
  const media = {
    id: 7,
    path: '/artist/work/video.mp4',
    updatedAt: '2026-08-10T10:20:30.000Z',
    width: 1920,
    height: 1080,
    size: 100,
    mediaType: 'video'
  } as any

  afterEach(() => {
    cleanup()
    optimizationState.job = null
    optimizationState.isStarting = false
    optimizationState.canManage = true
    optimizationState.suspendPlayback = false
    enqueue.mockReset()
    cancel.mockReset()
    playerMocks.props.mockReset()
    playerMocks.animatedProps.mockReset()
    playerMocks.imageProps.mockReset()
  })

  it('uses image updatedAt to version the immutable video URL', () => {
    render(<LazyMedia media={media} index={0} />)

    expect(screen.getByTestId('video-player').getAttribute('data-src')).toBe(
      '/api/v1/images/artist%2Fwork%2Fvideo.mp4?v=2026-08-10T10%3A20%3A30.000Z'
    )
  })

  it('places the lossless optimization action inside Artplayer settings', () => {
    render(<LazyMedia media={media} index={0} />)

    const settingActions = playerMocks.props.mock.calls.at(-1)?.[0].settingActions
    expect(settingActions).toEqual([
      expect.objectContaining({ name: 'video-streaming-optimization', label: '无损优化', tooltip: '执行' })
    ])

    settingActions[0].onClick()
    expect(enqueue).toHaveBeenCalledWith(media)
  })

  it('shows the completed state in Artplayer settings without a floating badge', () => {
    optimizationState.job = { status: 'COMPLETED', progress: 100, message: '完成' }

    render(<LazyMedia media={media} index={0} />)

    const settingAction = playerMocks.props.mock.calls.at(-1)?.[0].settingActions[0]
    expect(settingAction).toMatchObject({ label: '无损优化', tooltip: '已优化', disabled: true })
    expect(screen.queryByText('已优化')).toBeNull()
  })

  it('unmounts the player as soon as the optimization is waiting in the queue', () => {
    optimizationState.job = { status: 'PENDING', progress: 0, message: '等待中', queuePosition: 3 }
    optimizationState.suspendPlayback = true

    render(<LazyMedia media={media} index={0} />)

    expect(screen.queryByTestId('video-player')).toBeNull()
    expect(screen.getByText('优化处理中')).toBeTruthy()
    expect(screen.getByText('排队中 · 第 3 位')).toBeTruthy()
    expect(screen.getByRole('button', { name: '取消排队' })).toBeTruthy()
  })

  it('renders a confirmed static WebP as an ordinary image', () => {
    render(
      <LazyMedia
        media={{
          ...media,
          path: '/artist/work/static.webp',
          mediaType: 'image',
          webpAnimationStatus: 1,
          isAnimated: false
        }}
        index={0}
      />
    )

    expect(screen.getByTestId('static-image')).toBeTruthy()
    expect(screen.queryByTestId('animated-image-player')).toBeNull()
  })

  it('keeps animated and pending WebP files on the on-demand player path', () => {
    const { rerender } = render(
      <LazyMedia
        media={{
          ...media,
          path: '/artist/work/animated.webp',
          mediaType: 'image',
          webpAnimationStatus: 2,
          isAnimated: true
        }}
        index={0}
      />
    )

    expect(screen.getByTestId('animated-image-player')).toBeTruthy()
    expect(playerMocks.animatedProps.mock.calls.at(-1)?.[0].isAnimated).toBe(true)

    rerender(
      <LazyMedia
        media={{
          ...media,
          path: '/artist/work/pending.webp',
          mediaType: 'image',
          webpAnimationStatus: 0,
          isAnimated: false
        }}
        index={0}
      />
    )

    expect(screen.getByTestId('animated-image-player')).toBeTruthy()
    expect(playerMocks.animatedProps.mock.calls.at(-1)?.[0].isAnimated).toBe(false)
  })
})
