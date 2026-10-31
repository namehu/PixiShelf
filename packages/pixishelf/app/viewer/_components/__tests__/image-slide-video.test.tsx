import { cleanup, fireEvent, waitFor, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaType } from '@/types'
import { SingleImage } from '../image-slide'

vi.mock('next/image', () => ({ default: () => null }))

describe('viewer video lifecycle', () => {
  it('continues the original when the copy fails before the first playing event', async () => {
    const onPlaybackError = vi.fn()
    let rejectPlay!: (reason: Error) => void
    play.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectPlay = reject
        })
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          status: 'READY',
          originalUrl: `/api/v1/media/7/playback?original=${'a'.repeat(24)}`,
          playbackUrl: '/api/v1/media/7/playback?generation=11111111-1111-4111-8111-111111111111'
        })
      )
    )
    const view = render(
      <SingleImage
        media={{
          id: 7,
          key: 'media-7',
          url: '/video.mp4',
          updatedAt: '2026-10-31',
          mediaType: MediaType.VIDEO,
          animationMetadata: null
        }}
        retryKey={0}
        onRetry={vi.fn()}
        isActiveMedia
        onPlaybackError={onPlaybackError}
        audioPreference={{ muted: true, volume: 0.4 }}
      />
    )
    const video = view.container.querySelector('video')!
    await waitFor(() => expect(video.src).toContain('generation='))
    fireEvent.play(video)
    Object.defineProperty(video, 'error', { configurable: true, value: { code: 4 } })
    rejectPlay(new Error('The element has no supported sources'))
    fireEvent.pause(video)
    fireEvent.error(video)
    await waitFor(() => expect(video.src).toContain('original='))
    Object.defineProperty(video, 'error', { configurable: true, value: null })
    play.mockClear()
    pause.mockClear()
    fireEvent.loadedMetadata(video)
    expect(play).toHaveBeenCalledTimes(1)
    expect(pause).not.toHaveBeenCalled()
    expect(onPlaybackError).not.toHaveBeenCalled()
  })

  it('switches a copy to the original without changing reading identity or paused state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          status: 'READY',
          originalUrl: `/api/v1/media/7/playback?original=${'a'.repeat(24)}`,
          playbackUrl: '/api/v1/media/7/playback?generation=11111111-1111-4111-8111-111111111111'
        })
      )
    )
    const onReadingProgress = vi.fn()
    const view = render(
      <SingleImage
        media={{
          id: 7,
          key: 'media-7',
          url: '/video.mp4',
          updatedAt: '2026-10-31',
          mediaType: MediaType.VIDEO,
          animationMetadata: null
        }}
        retryKey={0}
        onRetry={vi.fn()}
        isActiveMedia
        playbackRate={1.5}
        audioPreference={{ muted: true, volume: 0.4 }}
        onReadingProgress={onReadingProgress}
      />
    )
    const video = view.container.querySelector('video')!
    await waitFor(() => expect(video.src).toContain('generation='))
    video.currentTime = 27
    Object.defineProperties(video, {
      duration: { configurable: true, value: 60 },
      paused: { configurable: true, value: true }
    })
    play.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '切换到原片' }))
    expect(video.src).toContain('original=')
    video.currentTime = 0
    fireEvent.loadedMetadata(video)
    expect(video).toMatchObject({ currentTime: 27, volume: 0.4, muted: true, playbackRate: 1.5 })
    expect(play).not.toHaveBeenCalled()
    expect(pause).toHaveBeenCalled()
    expect(view.container.querySelector('video')).toBe(video)
    expect(onReadingProgress).not.toHaveBeenCalledWith(expect.objectContaining({ ended: true }))
  })

  it('zooms only the video without remounting, seeking or changing playback', () => {
    const props = {
      media: {
        id: 1,
        key: 'zoom-video',
        url: '/video.mp4',
        updatedAt: '2026-10-24',
        mediaType: MediaType.VIDEO,
        animationMetadata: null
      },
      retryKey: 0,
      onRetry: vi.fn(),
      audioPreference: { muted: true, volume: 0.5 },
      isActiveMedia: true
    }
    const view = render(<SingleImage {...props} />)
    const video = view.container.querySelector('video')!
    expect(video.style.scale).toBe('1')
    video.currentTime = 42
    play.mockClear()
    pause.mockClear()
    view.rerender(<SingleImage {...props} videoZoom={2.5} chromeHidden />)
    expect(view.container.querySelector('video')).toBe(video)
    expect(video.style.scale).toBe('2.5')
    expect(video.parentElement?.classList.contains('overflow-hidden')).toBe(true)
    expect(video.currentTime).toBe(42)
    expect(video.muted).toBe(true)
    expect(video.volume).toBe(0.5)
    expect(play).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
    view.rerender(<SingleImage {...props} />)
    expect(video.style.scale).toBe('1')
  })

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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const id = /media\/(\d+)\//.exec(url)?.[1] ?? '1'
        return Promise.resolve(
          Response.json({
            status: 'READY',
            originalUrl: `/api/v1/media/${id}/playback?original=${'a'.repeat(24)}`,
            playbackUrl: null
          })
        )
      })
    )

    play.mockClear()
    pause.mockClear()
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play })
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: pause })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('plays only while active and pauses when the media becomes inactive', async () => {
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

    await waitFor(() => expect(play).toHaveBeenCalled())
    const video = view.container.querySelector('video')
    expect(video?.muted).toBe(true)
    expect(video?.volume).toBe(0.5)

    view.rerender(<SingleImage {...commonProps} isActiveMedia={false} />)
    expect(pause).toHaveBeenCalled()
  })

  it('does not restart an active video when its saved position bookkeeping changes', async () => {
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
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1))

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
