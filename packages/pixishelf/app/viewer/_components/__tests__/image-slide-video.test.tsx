import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaType } from '@/types'
import { SingleImage } from '../image-slide'

vi.mock('next/image', () => ({ default: () => null }))

describe('viewer video lifecycle', () => {
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
        key: 'video-1',
        url: '/video.mp4',
        mediaType: MediaType.VIDEO,
        hasAudio: true
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

  it('falls back to muted playback when unmuted autoplay is rejected', async () => {
    play.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError')).mockResolvedValue(undefined)
    const onFallback = vi.fn()

    const view = render(
      <SingleImage
        media={{ key: 'video-2', url: '/video-2.mp4', mediaType: MediaType.VIDEO, hasAudio: true }}
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
})
