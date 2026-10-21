import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaType } from '@/types'
import { SingleImage } from '../image-slide'

vi.mock('next/image', () => ({ default: () => null }))

describe('viewer video lifecycle', () => {
  it('distinguishes metadata from playback and publishes seeks for reading completion', () => {
    const onReadingProgress = vi.fn()
    const view = render(
      <SingleImage
        media={{
          id: 1,
          key: 'video-1',
          url: '/video.mp4',
          updatedAt: '2026-10-18T00:00:00Z',
          mediaType: MediaType.VIDEO,
          animationMetadata: null
        }}
        retryKey={0}
        onRetry={vi.fn()}
        audioPreference={{ muted: true, volume: 1 }}
        isActiveMedia
        onReadingProgress={onReadingProgress}
      />
    )
    const video = view.container.querySelector('video')!
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 })
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    fireEvent.loadedMetadata(video)
    expect(onReadingProgress).toHaveBeenLastCalledWith(expect.objectContaining({ started: false }))
    fireEvent.playing(video)
    expect(onReadingProgress).toHaveBeenLastCalledWith(expect.objectContaining({ started: true, playing: true }))
    video.currentTime = 90
    fireEvent.seeked(video)
    expect(onReadingProgress).toHaveBeenLastCalledWith(expect.objectContaining({ currentTime: 90, duration: 100 }))
  })
  const play = vi.fn().mockResolvedValue(undefined)
  const pause = vi.fn()

  beforeEach(() => {
    play.mockClear()
    pause.mockClear()
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play })
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: pause })
  })

  afterEach(() => cleanup())

  it('plays only while active and pauses when the media becomes inactive', () => {
    const commonProps = {
      media: {
        id: 1,
        key: 'video-1',
        url: '/video.mp4',
        updatedAt: '2026-08-11T00:00:00.000Z',
        mediaType: MediaType.VIDEO,
        hasAudio: true,
        animationMetadata: null
      },
      retryKey: 0,
      onRetry: vi.fn(),
      audioPreference: { muted: true, volume: 0.5 }
    }
    const view = render(<SingleImage {...commonProps} isActiveMedia />)

    expect(play).toHaveBeenCalled()
    const video = view.container.querySelector('video')
    expect(video?.muted).toBe(true)
    expect(video?.volume).toBe(0.5)

    view.rerender(<SingleImage {...commonProps} isActiveMedia={false} />)
    expect(pause).toHaveBeenCalled()
  })

  it('does not restart an active video when its saved position bookkeeping changes', () => {
    const commonProps = {
      media: {
        id: 4,
        key: 'video-4',
        url: '/video-4.mp4',
        updatedAt: '2026-08-11T00:00:00.000Z',
        mediaType: MediaType.VIDEO,
        hasAudio: true,
        animationMetadata: null
      },
      retryKey: 0,
      onRetry: vi.fn(),
      audioPreference: { muted: true, volume: 1 },
      isActiveMedia: true
    }
    const view = render(<SingleImage {...commonProps} savedPlaybackPosition={10} />)
    expect(play).toHaveBeenCalledTimes(1)

    view.rerender(<SingleImage {...commonProps} savedPlaybackPosition={11} />)
    expect(play).toHaveBeenCalledTimes(1)
    const video = view.container.querySelector('video')
    pause.mockClear()
    view.rerender(<SingleImage {...commonProps} savedPlaybackPosition={11} chromeHidden />)
    expect(view.container.querySelector('video')).toBe(video)
    expect(play).toHaveBeenCalledTimes(1)
    expect(pause).not.toHaveBeenCalled()
  })

  it.each([true, false])('changes speed without restarting or seeking (playing=%s)', (playing) => {
    const props = {
      media: {
        id: 5,
        key: 'rate-video',
        url: '/rate.mp4',
        updatedAt: '2026-10-21',
        mediaType: MediaType.VIDEO,
        animationMetadata: null
      },
      retryKey: 0,
      onRetry: vi.fn(),
      audioPreference: { muted: false, volume: 0.5 },
      isActiveMedia: true
    }
    const view = render(<SingleImage {...props} playbackRate={1.5} />)
    const video = view.container.querySelector('video')!
    expect(video.playbackRate).toBe(1.5)
    expect(video.defaultPlaybackRate).toBe(1.5)
    Object.defineProperty(video, 'paused', { configurable: true, value: !playing })
    video.currentTime = 27
    play.mockClear()
    pause.mockClear()
    view.rerender(<SingleImage {...props} playbackRate={2} />)
    expect(video.playbackRate).toBe(2)
    expect(video.defaultPlaybackRate).toBe(2)
    expect(video.currentTime).toBe(27)
    expect(video.paused).toBe(!playing)
    expect(video.volume).toBe(0.5)
    expect(video.muted).toBe(false)
    expect(play).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
    view.rerender(<SingleImage {...props} playbackRate={2} retryKey={1} />)
    const replacement = view.container.querySelector('video')!
    expect(replacement).not.toBe(video)
    expect(replacement.playbackRate).toBe(2)
    replacement.playbackRate = 1
    fireEvent.loadedMetadata(replacement)
    expect(replacement.playbackRate).toBe(2)
  })

  it('falls back to muted playback when unmuted autoplay is rejected', async () => {
    play.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError')).mockResolvedValue(undefined)
    const onFallback = vi.fn()

    const view = render(
      <SingleImage
        media={{
          id: 2,
          key: 'video-2',
          url: '/video-2.mp4',
          updatedAt: '2026-08-11T00:00:00.000Z',
          mediaType: MediaType.VIDEO,
          hasAudio: true,
          animationMetadata: null
        }}
        retryKey={0}
        onRetry={vi.fn()}
        audioPreference={{ muted: false, volume: 1 }}
        isActiveMedia
        onAutoplayMutedFallback={onFallback}
      />
    )

    await vi.waitFor(() => expect(onFallback).toHaveBeenCalledOnce())
    expect(view.container.querySelector('video')?.muted).toBe(true)
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('uses metadata-only preloading for an inactive neighboring video', () => {
    const view = render(
      <SingleImage
        media={{
          id: 3,
          key: 'video-3',
          url: '/video-3.mp4',
          updatedAt: '2026-08-11T00:00:00.000Z',
          mediaType: MediaType.VIDEO,
          animationMetadata: null
        }}
        retryKey={0}
        onRetry={vi.fn()}
        audioPreference={{ muted: true, volume: 1 }}
        preloadMode="metadata"
      />
    )

    expect(view.container.querySelector('video')?.preload).toBe('metadata')
    expect(play).not.toHaveBeenCalled()
  })
})
