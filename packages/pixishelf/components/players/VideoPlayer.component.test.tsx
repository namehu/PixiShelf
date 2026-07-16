import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VideoPlayer from './VideoPlayer'

const artplayerMock = vi.hoisted(() => ({
  constructor: vi.fn(),
  handlers: new Map<string, Array<(...args: unknown[]) => void>>()
}))

vi.mock('artplayer', () => ({
  default: artplayerMock.constructor
}))

describe('VideoPlayer component behavior', () => {
  afterEach(() => {
    artplayerMock.constructor.mockReset()
    artplayerMock.handlers.clear()
    history.replaceState(null, '', window.location.href)
  })

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }))
    })
  })

  function setupArtplayerMock(videoOverrides: Partial<HTMLVideoElement> = {}) {
    const video = {
      ended: false,
      paused: false,
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1280,
      videoHeight: 720,
      duration: 60,
      ...videoOverrides
    } as HTMLVideoElement

    let fullscreenWeb = true
    const cleanupEvents: string[] = []
    const art = {
      currentTime: 0,
      duration: 60,
      video,
      template: {
        $video: video,
        $progress: document.createElement('div'),
        $player: document.createElement('div')
      },
      controls: {
        show: true,
        add: vi.fn(),
        remove: vi.fn()
      },
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

    artplayerMock.constructor.mockImplementation(function ArtplayerMock(options: { container: HTMLElement }) {
      const playerElement = document.createElement('div')
      playerElement.className = 'art-video-player'
      options.container.append(playerElement)
      art.template.$player = playerElement
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
