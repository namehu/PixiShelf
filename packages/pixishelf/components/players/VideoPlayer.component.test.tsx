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
      emit: vi.fn(),
      destroy: vi.fn()
    }

    artplayerMock.constructor.mockImplementation(function ArtplayerMock() {
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
})
