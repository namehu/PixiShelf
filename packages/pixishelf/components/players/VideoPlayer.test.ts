import { describe, expect, it } from 'vitest'
import { shouldShowAudioControls, shouldSyncVideoTime, shouldShowVideoBuffering } from './VideoPlayer'

describe('VideoPlayer helpers', () => {
  it('does not show buffering while the current frame is still renderable', () => {
    const video = {
      ended: false,
      paused: false,
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA
    } as HTMLVideoElement

    expect(shouldShowVideoBuffering(video)).toBe(false)
  })

  it('shows buffering when playback has no current frame available', () => {
    const video = {
      ended: false,
      paused: false,
      readyState: HTMLMediaElement.HAVE_METADATA
    } as HTMLVideoElement

    expect(shouldShowVideoBuffering(video)).toBe(true)
  })

  it('syncs video time only for meaningful changes', () => {
    expect(shouldSyncVideoTime(10, 10.1)).toBe(false)
    expect(shouldSyncVideoTime(10, 10.25)).toBe(true)
  })

  it('shows audio controls only when metadata confirms an audio track', () => {
    expect(shouldShowAudioControls(true)).toBe(true)
    expect(shouldShowAudioControls(false)).toBe(false)
    expect(shouldShowAudioControls(null)).toBe(false)
    expect(shouldShowAudioControls(undefined)).toBe(false)
  })
})
