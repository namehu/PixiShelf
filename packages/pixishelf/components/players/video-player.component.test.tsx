import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VideoPlayer, { formatVideoRemainingTime } from './video-player'

const artplayerMock = vi.hoisted(() => ({
  constructor: vi.fn(),
  handlers: new Map<string, Array<(...args: unknown[]) => void>>()
}))

const videoChaptersMock = vi.hoisted(() => ({
  useVideoChapters: vi.fn()
}))

const videoKeyframesMock = vi.hoisted(() => ({
  useVideoKeyframes: vi.fn()
}))

vi.mock('artplayer', () => ({
  default: artplayerMock.constructor
}))

vi.mock('./use-video-chapters', () => ({
  useVideoChapters: videoChaptersMock.useVideoChapters
}))

vi.mock('./use-video-keyframes', () => ({
  useVideoKeyframes: videoKeyframesMock.useVideoKeyframes
}))

describe('VideoPlayer component behavior', () => {
  afterEach(() => {
    cleanup()
    artplayerMock.constructor.mockReset()
    artplayerMock.handlers.clear()
    history.replaceState(null, '', window.location.href)
  })

  it('formats the control-bar time as a decreasing remaining duration', () => {
    expect(formatVideoRemainingTime(90, 0)).toBe('1:30')
    expect(formatVideoRemainingTime(90, 29.2)).toBe('1:01')
    expect(formatVideoRemainingTime(3661, 1)).toBe('1:01:00')
    expect(formatVideoRemainingTime(0, 0)).toBe('--:--')
  })

  it('restores the remaining time after Artplayer emits a buffer-progress event', async () => {
    const art = setupArtplayerMock()

    render(<VideoPlayer src="/video.mp4" />)

    await waitFor(() => expect(artplayerMock.constructor).toHaveBeenCalled())
    const timeControl = document.createElement('div')
    timeControl.className = 'art-control-time'
    art.template.$player.append(timeControl)
    art.currentTime = 10

    act(() => emitArtplayerEvent('video:progress'))

    expect(timeControl.textContent).toBe('0:50')
  })

  beforeEach(() => {
    videoChaptersMock.useVideoChapters.mockReturnValue({
      chapters: [],
      duration: 0,
      loading: false,
      loaded: true,
      error: null,
      reload: vi.fn()
    })
    videoKeyframesMock.useVideoKeyframes.mockReturnValue({
      keyframes: [],
      publishedAt: null,
      loading: false,
      loaded: true,
      error: null,
      reload: vi.fn()
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }))
    })
  })

  function setupArtplayerMock(videoOverrides: Partial<HTMLVideoElement> = {}, initialFullscreenWeb = true) {
    const video = {
      ended: false,
      paused: false,
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1280,
      videoHeight: 720,
      duration: 60,
      ...videoOverrides
    } as HTMLVideoElement

    let fullscreenWeb = initialFullscreenWeb
    const cleanupEvents: string[] = []
    const layerCache = new Map<
      string,
      {
        element: HTMLElement
        option: {
          beforeUnmount?: (element: HTMLElement) => void
        }
      }
    >()
    const art = {
      currentTime: 0,
      duration: 60,
      video,
      template: {
        $video: video,
        $progress: document.createElement('div'),
        $player: document.createElement('div'),
        $layer: document.createElement('div')
      },
      controls: {
        show: true,
        add: vi.fn(),
        remove: vi.fn()
      },
      setting: { show: true },
      layers: {
        add: vi.fn(
          (option: {
            name: string
            style?: Partial<CSSStyleDeclaration>
            mounted?: (element: HTMLElement) => void
            beforeUnmount?: (element: HTMLElement) => void
          }) => {
            const element = document.createElement('div')
            element.className = `art-layer art-layer-${option.name}`
            Object.assign(element.style, option.style)
            art.template.$layer.append(element)
            layerCache.set(option.name, { element, option })
            Object.assign(art.layers, { [option.name]: element })
            option.mounted?.(element)
            return element
          }
        ),
        remove: vi.fn((name: string) => {
          const item = layerCache.get(name)
          if (!item) return
          item.option.beforeUnmount?.(item.element)
          item.element.remove()
          layerCache.delete(name)
          delete (art.layers as Record<string, unknown>)[name]
        })
      },
      plugins: {} as Record<string, unknown>,
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        const handlers = artplayerMock.handlers.get(event) ?? []
        handlers.push(handler)
        artplayerMock.handlers.set(event, handlers)
      }),
      off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        const handlers = artplayerMock.handlers.get(event) ?? []
        artplayerMock.handlers.set(
          event,
          handlers.filter((registeredHandler) => registeredHandler !== handler)
        )
      }),
      emit: vi.fn(),
      destroy: vi.fn(() => cleanupEvents.push('destroy')),
      cleanupEvents,
      get fullscreenWeb() {
        return fullscreenWeb
      },
      set fullscreenWeb(value: boolean) {
        cleanupEvents.push(value ? 'enter-web-fullscreen' : 'exit-web-fullscreen')
        fullscreenWeb = value
        for (const handler of artplayerMock.handlers.get('fullscreenWeb') ?? []) {
          handler(value)
        }
      }
    }

    artplayerMock.constructor.mockImplementation(function ArtplayerMock(options: {
      container: HTMLElement
      plugins?: Array<(art: unknown) => { name?: string }>
    }) {
      const playerElement = document.createElement('div')
      playerElement.className = 'art-video-player'
      const layerElement = document.createElement('div')
      layerElement.className = 'art-layers'
      playerElement.append(layerElement)
      options.container.append(playerElement)
      art.template.$player = playerElement
      art.template.$layer = layerElement

      for (const plugin of options.plugins ?? []) {
        const pluginApi = plugin(art)
        if (pluginApi?.name) art.plugins[pluginApi.name] = pluginApi
      }

      return art
    })
    return art
  }

  function emitArtplayerEvent(event: string, ...args: unknown[]) {
    for (const handler of artplayerMock.handlers.get(event) ?? []) {
      handler(...args)
    }
  }

  it('disables Artplayer mobile video gestures so page scroll does not seek the video', async () => {
    setupArtplayerMock()

    render(<VideoPlayer src="/video.mp4" />)

    await waitFor(() => expect(artplayerMock.constructor).toHaveBeenCalled())
    expect(artplayerMock.constructor.mock.calls[0]?.[0]).toMatchObject({ gesture: false })
  })

  it('keeps the explicit control state when Artplayer attempts to auto-hide it', async () => {
    const art = setupArtplayerMock()

    render(<VideoPlayer src="/video.mp4" />)
    await waitFor(() => expect(artplayerMock.constructor).toHaveBeenCalled())
    act(() => emitArtplayerEvent('ready'))

    art.controls.show = false
    act(() => emitArtplayerEvent('control', false))

    expect(art.controls.show).toBe(true)
  })

  it('offers current-position and from-start recovery after a video error', async () => {
    setupArtplayerMock()

    render(<VideoPlayer src="/video.mp4" />)
    await waitFor(() => expect(artplayerMock.constructor).toHaveBeenCalledTimes(1))
    act(() => emitArtplayerEvent('video:error'))

    expect(screen.getByRole('button', { name: '重新加载' })).toBeDefined()
    expect(screen.getByRole('button', { name: '从头加载' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))

    await waitFor(() => expect(artplayerMock.constructor).toHaveBeenCalledTimes(2))
  })

  it('adds optional business actions to the native Artplayer settings menu', async () => {
    const art = setupArtplayerMock()
    const onClick = vi.fn()

    render(
      <VideoPlayer
        src="/video.mp4"
        settingActions={[{ name: 'video-streaming-optimization', label: '无损优化', tooltip: '执行', onClick }]}
      />
    )

    await waitFor(() => expect(artplayerMock.constructor).toHaveBeenCalled())
    const settings = artplayerMock.constructor.mock.calls[0]?.[0].settings
    expect(settings).toEqual([
      expect.objectContaining({ name: 'video-streaming-optimization', html: '无损优化', tooltip: '执行' })
    ])

    settings[0].onClick.call(art)
    expect(onClick).toHaveBeenCalledOnce()
    expect(art.setting.show).toBe(false)
  })

  it('does not autoplay and unmutes videos with an audio track when playback starts', async () => {
    const art = setupArtplayerMock()

    render(<VideoPlayer src="/video.mp4" hasAudio muted />)

    await waitFor(() => expect(artplayerMock.constructor).toHaveBeenCalled())
    expect(artplayerMock.constructor.mock.calls[0]?.[0]).toMatchObject({ autoplay: false, muted: true })

    act(() => emitArtplayerEvent('play'))

    expect(art).toMatchObject({ muted: false })
  })

  it('always shows chapter navigation controls and disables unavailable directions', async () => {
    videoChaptersMock.useVideoChapters.mockReturnValue({
      chapters: [
        { id: 'chapter-1', index: 1, title: 'Opening', start: 0, end: 10, duration: 10 },
        { id: 'chapter-2', index: 2, title: 'Middle', start: 20, end: 30, duration: 10 },
        { id: 'chapter-3', index: 3, title: 'Finale', start: 40, end: 50, duration: 10 }
      ],
      duration: 50,
      loading: false,
      error: null,
      reload: vi.fn()
    })
    const art = setupArtplayerMock()

    render(<VideoPlayer src="/video.mp4" />)

    await waitFor(() => {
      expect(art.controls.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'chapter-next' }))
    })

    const initialControls = art.controls.add.mock.calls.map(([control]) => control)
    const initialPreviousControl = initialControls.find((control) => control.name === 'chapter-previous')
    expect(initialPreviousControl).toMatchObject({ tooltip: '已经是第一章', index: 18 })
    const nextControl = initialControls.find((control) => control.name === 'chapter-next')
    expect(nextControl).toMatchObject({ tooltip: '下一章：Middle', index: 19 })

    act(() => nextControl.click(null, new Event('click')))
    expect(art.currentTime).toBe(20)

    art.currentTime = 25
    act(() => emitArtplayerEvent('video:timeupdate'))

    await waitFor(() => {
      expect(art.controls.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'chapter-previous' }))
    })

    const previousControl = art.controls.add.mock.calls
      .map(([control]) => control)
      .reverse()
      .find((control) => control.name === 'chapter-previous')
    expect(previousControl).toMatchObject({ tooltip: '上一章：Opening', index: 18 })

    act(() => previousControl.click(null, new Event('click')))
    expect(art.currentTime).toBe(0)
  })

  it('opens a mobile fullweb chapter rail, keeps playback running, and stays open after seeking', async () => {
    videoChaptersMock.useVideoChapters.mockReturnValue({
      chapters: [
        {
          id: 'chapter-1',
          index: 1,
          title: 'Opening',
          start: 0,
          end: 10,
          duration: 10,
          previewStatus: 'PENDING',
          previewUrl: null,
          previewCaptureTime: null,
          previewUpdatedAt: null
        },
        {
          id: 'chapter-2',
          index: 2,
          title: 'Middle',
          start: 20,
          end: 30,
          duration: 10,
          previewStatus: 'PENDING',
          previewUrl: null,
          previewCaptureTime: null,
          previewUpdatedAt: null
        }
      ],
      duration: 30,
      loading: false,
      error: null,
      reload: vi.fn()
    })
    const pause = vi.fn()
    const play = vi.fn().mockResolvedValue(undefined)
    const art = setupArtplayerMock({ paused: false, pause, play })
    const outerClick = vi.fn()

    const { unmount } = render(
      <div onClick={outerClick}>
        <VideoPlayer src="/video.mp4" />
      </div>
    )
    await waitFor(() => {
      expect(art.controls.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'chapter-entry' }))
    })
    const chapterControl = art.controls.add.mock.calls
      .map(([control]) => control)
      .find((control) => control.name === 'chapter-entry')

    act(() => chapterControl.click(null, new Event('click')))
    const dialog = await screen.findByRole('dialog', { name: '视频章节' })
    expect(dialog.closest('.art-video-player')).toBe(art.template.$player)
    expect(document.body.querySelector(':scope > [role="dialog"][aria-label="视频章节"]')).toBeNull()
    expect(pause).not.toHaveBeenCalled()
    expect(art.template.$player.classList.contains('pixishelf-chapter-rail-open')).toBe(true)

    document.body.append(art.template.$player)
    expect(screen.getByRole('dialog', { name: '视频章节' })).toBe(dialog)

    fireEvent.click(screen.getByRole('button', { name: /Middle/ }))

    expect(art.currentTime).toBe(20)
    expect(play).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '视频章节' })).toBeDefined()
    expect(outerClick).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '关闭章节列表并返回视频' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '视频章节' })).toBeNull())
    expect(art.template.$player.classList.contains('pixishelf-chapter-rail-open')).toBe(false)
    unmount()
  })

  it('opens a page-level mobile sheet outside fullweb and keeps it open after seeking', async () => {
    videoChaptersMock.useVideoChapters.mockReturnValue({
      chapters: [
        {
          id: 'chapter-1',
          index: 1,
          title: 'Opening',
          start: 0,
          end: 10,
          duration: 10,
          previewStatus: 'PENDING',
          previewUrl: null,
          previewCaptureTime: null,
          previewUpdatedAt: null
        },
        {
          id: 'chapter-2',
          index: 2,
          title: 'Middle',
          start: 20,
          end: 30,
          duration: 10,
          previewStatus: 'PENDING',
          previewUrl: null,
          previewCaptureTime: null,
          previewUpdatedAt: null
        }
      ],
      duration: 30,
      loading: false,
      error: null,
      reload: vi.fn()
    })
    const pause = vi.fn()
    const art = setupArtplayerMock({ paused: false, pause }, false)
    const { unmount } = render(<VideoPlayer src="/video.mp4" />)

    await waitFor(() => {
      expect(art.controls.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'chapter-entry' }))
    })
    const chapterControl = art.controls.add.mock.calls
      .map(([control]) => control)
      .find((control) => control.name === 'chapter-entry')

    act(() => chapterControl.click(null, new Event('click')))
    const dialog = await screen.findByRole('dialog', { name: /章节/ })

    expect(dialog.closest('.art-video-player')).toBeNull()
    expect(dialog.classList.contains('pixishelf-chapter-sheet')).toBe(true)
    expect(pause).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Middle/ }))

    expect(art.currentTime).toBe(20)
    expect(screen.getByRole('dialog', { name: /章节/ })).toBe(dialog)

    fireEvent.click(screen.getByRole('button', { name: '关闭章节列表' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /章节/ })).toBeNull())
    unmount()
  })

  it('opens a keyframe-only navigation sheet and keeps playback state after seeking', async () => {
    videoKeyframesMock.useVideoKeyframes.mockReturnValue({
      keyframes: [
        {
          id: 'frame-1',
          captureTime: 5,
          selectedOrder: 0,
          url: '/_video-keyframes/1/set-1/001.webp'
        },
        {
          id: 'frame-2',
          captureTime: 20,
          selectedOrder: 1,
          url: '/_video-keyframes/1/set-1/002.webp'
        }
      ],
      publishedAt: '2026-08-13T00:00:00.000Z',
      loading: false,
      loaded: true,
      error: null,
      reload: vi.fn()
    })
    const pause = vi.fn()
    const play = vi.fn().mockResolvedValue(undefined)
    const art = setupArtplayerMock({ paused: false, pause, play }, false)
    const { unmount } = render(<VideoPlayer src="/video.mp4" keyframesUrl="/api/v1/media/1/keyframes" />)

    await waitFor(() => {
      expect(art.controls.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'chapter-entry', tooltip: '画面' }))
    })
    const navigationControl = art.controls.add.mock.calls
      .map(([control]) => control)
      .reverse()
      .find((control) => control.name === 'chapter-entry')

    act(() => navigationControl.click(null, new Event('click')))
    const dialog = await screen.findByRole('dialog', { name: /画面/ })
    fireEvent.click(screen.getByRole('button', { name: '跳转到画面 00:20' }))

    expect(art.currentTime).toBe(20)
    expect(pause).not.toHaveBeenCalled()
    expect(play).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: /画面/ })).toBe(dialog)
    unmount()
  })

  it('keeps the desktop chapter layer open after seeking', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }))
    })
    videoChaptersMock.useVideoChapters.mockReturnValue({
      chapters: [
        {
          id: 'chapter-1',
          index: 1,
          title: 'Opening',
          start: 0,
          end: 10,
          duration: 10,
          previewStatus: 'PENDING',
          previewUrl: null,
          previewCaptureTime: null,
          previewUpdatedAt: null
        },
        {
          id: 'chapter-2',
          index: 2,
          title: 'Middle',
          start: 20,
          end: 30,
          duration: 10,
          previewStatus: 'PENDING',
          previewUrl: null,
          previewCaptureTime: null,
          previewUpdatedAt: null
        }
      ],
      duration: 30,
      loading: false,
      error: null,
      reload: vi.fn()
    })
    const art = setupArtplayerMock()

    const { unmount } = render(<VideoPlayer src="/video.mp4" />)
    await waitFor(() => {
      expect(art.controls.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'chapter-entry' }))
    })
    const chapterControl = art.controls.add.mock.calls
      .map(([control]) => control)
      .reverse()
      .find((control) => control.name === 'chapter-entry')

    act(() => chapterControl.click(null, new Event('click')))
    await screen.findByRole('dialog', { name: '视频章节' })
    fireEvent.click(screen.getByRole('button', { name: /Middle/ }))

    expect(art.currentTime).toBe(20)
    expect(screen.getByRole('dialog', { name: '视频章节' })).toBeDefined()
    unmount()
  })

  it('does not reopen the overlay on loadstart while the current video frame is still renderable', async () => {
    setupArtplayerMock()

    const { container } = render(<VideoPlayer src="/video.mp4" />)

    await waitFor(() => expect(artplayerMock.constructor).toHaveBeenCalled())
    act(() => emitArtplayerEvent('ready'))

    await waitFor(() => {
      expect(container.querySelector('.animate-spin')).toBeNull()
    })

    act(() => emitArtplayerEvent('video:loadstart'))

    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('exits web fullscreen, destroys the player HTML, and removes its pagehide listener on unmount', async () => {
    const art = setupArtplayerMock()
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    const { container, unmount } = render(<VideoPlayer src="/video.mp4" />)

    await waitFor(() => expect(artplayerMock.constructor).toHaveBeenCalled())
    const playerElement = container.querySelector<HTMLElement>('.art-video-player')
    expect(playerElement).not.toBeNull()

    unmount()

    expect(art.fullscreenWeb).toBe(false)
    expect(art.cleanupEvents).toEqual(['exit-web-fullscreen', 'destroy'])
    expect(art.destroy).toHaveBeenCalledWith(true)
    expect(container.querySelector('.art-video-player')).toBeNull()
    expect(addEventListener).toHaveBeenCalledWith('pagehide', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('pagehide', expect.any(Function))

    addEventListener.mockRestore()
    removeEventListener.mockRestore()
  })

  it('cleans a web-fullscreen player moved to body and does not destroy it twice', async () => {
    const art = setupArtplayerMock()
    const { container, unmount } = render(<VideoPlayer src="/video.mp4" />)

    await waitFor(() => expect(artplayerMock.constructor).toHaveBeenCalled())
    const playerElement = container.querySelector<HTMLElement>('.art-video-player')
    expect(playerElement).not.toBeNull()
    document.body.append(playerElement!)

    act(() => window.dispatchEvent(new Event('pagehide')))
    act(() => window.dispatchEvent(new Event('pagehide')))
    unmount()

    expect(art.fullscreenWeb).toBe(false)
    expect(art.destroy).toHaveBeenCalledTimes(1)
    expect(art.destroy).toHaveBeenCalledWith(true)
    expect(document.body.contains(playerElement!)).toBe(false)
  })

  it('uses a fullscreen history entry so the first browser back exits web fullscreen', async () => {
    const art = setupArtplayerMock()
    const { unmount } = render(<VideoPlayer src="/video.mp4" />)

    await waitFor(() => expect(artplayerMock.constructor).toHaveBeenCalled())
    const normalPageState = history.state

    act(() => emitArtplayerEvent('fullscreenWeb', true))

    expect(history.state).toMatchObject({ __artplayer_fullscreen_web__: expect.any(String) })

    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: normalPageState })))

    expect(art.fullscreenWeb).toBe(false)
    expect(art.cleanupEvents).toContain('exit-web-fullscreen')
    unmount()
  })

  it('removes a moved player root even if ArtPlayer destruction throws', async () => {
    const art = setupArtplayerMock()
    art.destroy.mockImplementation(() => {
      throw new Error('destroy failed')
    })
    const { container, unmount } = render(<VideoPlayer src="/video.mp4" />)

    await waitFor(() => expect(artplayerMock.constructor).toHaveBeenCalled())
    const playerElement = container.querySelector<HTMLElement>('.art-video-player')
    expect(playerElement).not.toBeNull()
    document.body.append(playerElement!)

    unmount()

    expect(art.destroy).toHaveBeenCalledWith(true)
    expect(document.body.contains(playerElement!)).toBe(false)
  })
})
