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
