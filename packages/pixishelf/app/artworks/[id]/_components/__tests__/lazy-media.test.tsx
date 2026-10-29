import { act, cleanup, render, screen } from '@testing-library/react'
import { useArtworkAutoBrowseStore as autoBrowse } from '@/store/use-artwork-auto-browse-store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LazyMedia from '../lazy-media'
import { ReadingCollector } from '@/lib/reading/reading-collector'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'
import type { ReadingContextDto, ReadingReportInput } from '@pixishelf/db/reading-contract'

const playerMocks = vi.hoisted(() => ({ props: vi.fn(), animatedProps: vi.fn(), imageProps: vi.fn(), apngProps: vi.fn() }))
const intersectionCallback = vi.hoisted(() => ({ current: null as null | ((inView: boolean) => void), threshold: 0 }))
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
vi.mock('@/components/players/apng-player', () => ({ default: (props: unknown) => {
  playerMocks.apngProps(props)
  return null
} }))
vi.mock('@/components/players/animated-webp-player', () => ({
  default: (props: { isAnimated?: boolean; controlMode?: string }) => {
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
vi.mock('react-intersection-observer', () => ({
  useOnInView: (callback: (inView: boolean) => void, options?: { rootMargin?: string; threshold?: number }) => {
    if (!options?.rootMargin) { intersectionCallback.current = callback; intersectionCallback.threshold = options?.threshold ?? 0 }
    return vi.fn()
  }
}))
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
    autoBrowse.getState().initialize(1)
    optimizationState.job = null
    optimizationState.isStarting = false
    optimizationState.canManage = true
    optimizationState.suspendPlayback = false
    enqueue.mockReset()
    cancel.mockReset()
    playerMocks.props.mockReset()
    playerMocks.animatedProps.mockReset()
    playerMocks.imageProps.mockReset()
    playerMocks.apngProps.mockReset()
  })

  it.each([
    { path: '/image.jpg' },
    { path: '/animation.webp', isAnimated: true, webpAnimationStatus: 2 },
    { path: '/animation.png', isAnimated: true },
    { path: '', detailsPending: true, reliableDimensions: true }
  ])('records a brief visible image region before loading: $path', async (image) => {
    const context: ReadingContextDto = {
      artworkId: 1, mediaRevision: 1, seenMediaIds: [], resume: null,
      media: [{ mediaId: media.id, memberMediaIds: [media.id], index: 0 }],
      summary: { artworkId: 1, mediaRevision: 1, stateVersion: 0, viewCount: 0, seenCount: 0,
        totalCount: 1, status: 'UNREAD', lastViewedAt: null, lastActiveAt: null, lastMediaId: null, lastMediaIndex: null }
    }
    const report = vi.fn(async (input: ReadingReportInput) => {
      expect(input.expectedUserId).toBe('reader')
      return { mediaRevision: 1, seenMediaIds: [media.id], summary: context.summary }
    })
    const collector = new ReadingCollector({ report })
    collector.setAccount('reader')
    collector.setContext(context, 'reader')
    const reading = {
      observe: (surface: string, observation: Parameters<ArtworkReadingHandle['observe']>[1]) =>
        collector.observe(surface, { ...observation, artworkId: 1 }),
      clearSurface: (surface: string) => collector.clearSurface(surface)
    } as ArtworkReadingHandle
    const view = render(<LazyMedia media={{ ...media, ...image, mediaType: 'image' }} index={0} reading={reading} />)
    try {
      await collector.flush()
      expect(report).not.toHaveBeenCalled()
      act(() => intersectionCallback.current?.(true))
      act(() => intersectionCallback.current?.(false))
      view.unmount()
      await collector.flush()
      expect(report).toHaveBeenCalledTimes(1)
      expect(report.mock.calls[0]?.[0].events).toMatchObject([{ type: 'VIEW', mediaId: media.id }])
    } finally {
      collector.dispose()
    }
  })

  it('keeps loading errors eligible but preserves the active and visibility gates', () => {
    const observe = vi.fn()
    const reading = { observe, clearSurface: vi.fn() } as unknown as ArtworkReadingHandle
    const image = { ...media, path: '/image.jpg', mediaType: 'image' }
    const view = render(<LazyMedia media={image} index={0} reading={reading} trackingActive={false} />)
    act(() => intersectionCallback.current?.(true))
    act(() => playerMocks.imageProps.mock.lastCall?.[0].onError())
    expect(observe.mock.lastCall?.[1]).toMatchObject({ ready: true, visible: true, active: false })
    view.rerender(<LazyMedia media={image} index={0} reading={reading} />)
    expect(observe.mock.lastCall?.[1]).toMatchObject({ ready: true, visible: true, active: true })
    act(() => intersectionCallback.current?.(false))
    expect(observe.mock.lastCall?.[1]).toMatchObject({ ready: true, visible: false })
  })

  it('still waits for a stack frame to load and excludes pending video regions', () => {
    const observe = vi.fn()
    const reading = { observe, clearSurface: vi.fn() } as unknown as ArtworkReadingHandle
    const view = render(<LazyMedia media={{ ...media, path: '/image.jpg', mediaType: 'image' }} index={0} reading={reading} fill />)
    act(() => intersectionCallback.current?.(true))
    expect(observe.mock.lastCall?.[1]).toMatchObject({ ready: false, visible: true })
    view.rerender(<LazyMedia media={{ ...media, path: '', detailsPending: true }} index={0} reading={reading} />)
    expect(observe.mock.lastCall?.[1]).toMatchObject({ ready: false, visible: true })
  })

  it('keeps mounted images eager at reading width across start, pause and exit', () => {
    autoBrowse.getState().initialize(1)
    render(<LazyMedia media={{ ...media, path: '/next.jpg', mediaType: 'image' }} index={12} />)
    expect(playerMocks.imageProps.mock.calls.at(-1)?.[0]).toMatchObject({
      loading: 'eager', sizes: '(max-width: 45rem) 100vw, 45rem'
    })
    act(() => autoBrowse.getState().start('scroll'))
    expect(playerMocks.imageProps.mock.calls.at(-1)?.[0].loading).toBe('eager')
    act(() => autoBrowse.getState().pause())
    expect(playerMocks.imageProps.mock.calls.at(-1)?.[0].loading).toBe('eager')
    act(() => autoBrowse.getState().stop())
    expect(playerMocks.imageProps.mock.calls.at(-1)?.[0].loading).toBe('eager')
  })

  it('does not treat a narrow glimpse of the next stack as whole-group reading', () => {
    const props = { media: { ...media, path: '/next.jpg', mediaType: 'image' }, index: 0 }
    const view = render(<LazyMedia {...props} fill />)
    expect(intersectionCallback.threshold).toBe(0.5)
    view.rerender(<LazyMedia {...props} />)
    expect(intersectionCallback.threshold).toBe(0)
  })

  it('preloads the WebP poster without starting offscreen animation', () => {
    render(<LazyMedia media={{ ...media, path: '/next.webp', mediaType: 'image', isAnimated: true }} index={12} />)
    expect(playerMocks.animatedProps.mock.calls.at(-1)?.[0]).toMatchObject({ posterLoading: 'eager', playing: false })
    act(() => autoBrowse.getState().start('scroll'))
    expect(playerMocks.animatedProps.mock.calls.at(-1)?.[0]).toMatchObject({ posterLoading: 'eager', playing: false })
    act(() => autoBrowse.getState().pause())
    expect(playerMocks.animatedProps.mock.calls.at(-1)?.[0]).toMatchObject({ posterLoading: 'eager', playing: false })
  })

  it('sizes APNG posters for the reading column', () => {
    render(<LazyMedia media={{ ...media, path: '/next.png', mediaType: 'image', isAnimated: true }} index={12} />)
    expect(playerMocks.apngProps.mock.calls.at(-1)?.[0].posterSizes).toBe('(max-width: 45rem) 100vw, 45rem')
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

  it('stops reading during optimization and waits for the restored player to become ready', () => {
    const observe = vi.fn()
    const reading = { observe, clearSurface: vi.fn(), observationEpoch: 0 } as never
    const { rerender } = render(<LazyMedia media={media} index={0} reading={reading} />)
    act(() => intersectionCallback.current?.(true))
    act(() => playerMocks.props.mock.calls.at(-1)?.[0].onReady())
    expect(observe.mock.calls.at(-1)?.[1]).toMatchObject({ visible: true, ready: false })
    act(() => playerMocks.props.mock.calls.at(-1)?.[0].onReadingProgress({
      currentTime: 1, duration: 100, started: true, playing: true
    }))
    expect(observe.mock.calls.at(-1)?.[1]).toMatchObject({ visible: true, ready: true })

    optimizationState.suspendPlayback = true
    rerender(<LazyMedia media={{ ...media }} index={0} reading={reading} />)
    expect(screen.queryByTestId('video-player')).toBeNull()
    expect(observe.mock.calls.at(-1)?.[1]).toMatchObject({ visible: true, ready: false })

    optimizationState.suspendPlayback = false
    rerender(<LazyMedia media={{ ...media }} index={0} reading={reading} />)
    expect(screen.getByTestId('video-player')).toBeTruthy()
    expect(observe.mock.calls.at(-1)?.[1]).toMatchObject({ visible: true, ready: false })
    act(() => playerMocks.props.mock.calls.at(-1)?.[0].onReady())
    expect(observe.mock.calls.at(-1)?.[1]).toMatchObject({ visible: true, ready: true })
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
    expect(playerMocks.animatedProps.mock.calls.at(-1)?.[0].controlMode).toBe('badge')

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
    expect(playerMocks.animatedProps.mock.calls.at(-1)?.[0].controlMode).toBe('badge')
  })

  it('does not use stacked animation metadata as the visible aspect ratio', () => {
    const { container, rerender } = render(
      <LazyMedia
        media={{
          ...media,
          path: '/artist/work/animated.webp',
          width: 696,
          height: 81000,
          mediaType: 'image',
          webpAnimationStatus: 2,
          isAnimated: true
        }}
        index={0}
      />
    )

    expect((container.firstElementChild as HTMLElement).style.aspectRatio).toBe('')

    rerender(
      <LazyMedia
        media={{
          ...media,
          path: '/artist/work/pending.webp',
          width: 696,
          height: 81000,
          mediaType: 'image',
          webpAnimationStatus: 0,
          isAnimated: false
        }}
        index={0}
      />
    )

    expect((container.firstElementChild as HTMLElement).style.aspectRatio).toBe('')
  })

  it('controls automatic WebP playback and preserves an error pause', () => {
    autoBrowse.getState().initialize(1)
    autoBrowse.getState().start('scroll')
    render(
      <LazyMedia media={{ ...media, path: '/animation.webp', isAnimated: true, webpAnimationStatus: 2 }} index={0} />
    )
    act(() => autoBrowse.getState().setActiveAnimation(media.id))
    const props = playerMocks.animatedProps.mock.calls.at(-1)![0]
    expect(props).toMatchObject({ playing: true, playOnce: true, updatedAt: media.updatedAt })
    expect(autoBrowse.getState().status).toBe('running')
    act(() => {
      props.onAnimationError()
      props.onPlayingChange(false)
    })
    expect(autoBrowse.getState()).toMatchObject({ status: 'paused', reason: 'error', activeAnimationId: null })
    expect(playerMocks.animatedProps.mock.calls.at(-1)![0]).toMatchObject({ playing: false, playOnce: false })
  })

  it('does not restore a previous manual loop after automatic playback finishes', () => {
    autoBrowse.getState().initialize(1)
    render(
      <LazyMedia media={{ ...media, path: '/animation.webp', isAnimated: true, webpAnimationStatus: 2 }} index={0} />
    )
    act(() => playerMocks.animatedProps.mock.calls.at(-1)![0].onPlayingChange(true))
    expect(playerMocks.animatedProps.mock.calls.at(-1)![0].playing).toBe(true)
    act(() => {
      autoBrowse.getState().start('scroll')
      autoBrowse.getState().setActiveAnimation(media.id)
    })
    act(() => autoBrowse.getState().setActiveAnimation(null))
    expect(playerMocks.animatedProps.mock.calls.at(-1)![0].playing).toBe(false)
  })
})
