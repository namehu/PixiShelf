import { describe, expect, it } from 'vitest'
import {
  artworkMediaAnchorIntervalSchema,
  userSettingsSchema,
  userSettingsWithDefaultsSchema
} from './user-setting.dto'

describe('artwork media anchor interval settings', () => {
  it('defaults the interval to 50', () => {
    expect(userSettingsWithDefaultsSchema.parse({}).artwork_media_anchor_interval).toBe(50)
  })

  it('accepts disabled and configured intervals', () => {
    expect(artworkMediaAnchorIntervalSchema.parse(0)).toBe(0)
    expect(userSettingsSchema.parse({ artwork_media_anchor_interval: 20 })).toEqual({
      artwork_media_anchor_interval: 20
    })
  })

  it('rejects unsupported intervals', () => {
    expect(() => artworkMediaAnchorIntervalSchema.parse(25)).toThrow()
  })
})

describe('media privacy settings', () => {
  it('defaults media privacy mode to disabled', () => {
    expect(userSettingsWithDefaultsSchema.parse({}).media_privacy_mode).toBe(false)
  })

  it('accepts persisted media privacy mode values', () => {
    expect(userSettingsSchema.parse({ media_privacy_mode: true })).toEqual({
      media_privacy_mode: true
    })
    expect(userSettingsWithDefaultsSchema.parse({ media_privacy_mode: true }).media_privacy_mode).toBe(true)
  })
})

describe('video interaction settings', () => {
  it('uses stable defaults for video gestures', () => {
    const settings = userSettingsWithDefaultsSchema.parse({})

    expect(settings.video_long_press_playback_rate).toBe(3)
    expect(settings.video_seek_step_seconds).toBe(10)
  })

  it('accepts only the supported video gesture choices', () => {
    expect(userSettingsSchema.parse({ video_long_press_playback_rate: 2, video_seek_step_seconds: 15 })).toMatchObject({
      video_long_press_playback_rate: 2,
      video_seek_step_seconds: 15
    })
    expect(() => userSettingsSchema.parse({ video_long_press_playback_rate: 5 })).toThrow()
    expect(() => userSettingsSchema.parse({ video_seek_step_seconds: 30 })).toThrow()
  })
})
