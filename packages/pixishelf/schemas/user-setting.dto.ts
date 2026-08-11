import { z } from 'zod'

export const settingTypeSchema = z.enum(['string', 'boolean', 'number', 'json'])
export const artworkDisplayModeSchema = z.enum(['card', 'minimal'])
export const videoLongPressPlaybackRateSchema = z.union([z.literal(2), z.literal(3)])
export const videoSeekStepSecondsSchema = z.union([z.literal(5), z.literal(10), z.literal(15)])
export const artworkMediaAnchorIntervalSchema = z.union([
  z.literal(0),
  z.literal(10),
  z.literal(20),
  z.literal(30),
  z.literal(40),
  z.literal(50),
  z.literal(100)
])
export const userSettingsSchema = z.object({
  artwork_display_mode: artworkDisplayModeSchema.optional(),
  preferred_tags: z.array(z.string()).optional(),
  artwork_media_anchor_interval: artworkMediaAnchorIntervalSchema.optional(),
  media_privacy_mode: z.boolean().optional(),
  video_long_press_playback_rate: videoLongPressPlaybackRateSchema.optional(),
  video_seek_step_seconds: videoSeekStepSecondsSchema.optional()
})
export const userSettingsWithDefaultsSchema = userSettingsSchema.default({}).transform((settings) => ({
  artwork_display_mode: settings.artwork_display_mode ?? 'card',
  preferred_tags: settings.preferred_tags ?? [],
  artwork_media_anchor_interval: settings.artwork_media_anchor_interval ?? 50,
  media_privacy_mode: settings.media_privacy_mode ?? false,
  video_long_press_playback_rate: settings.video_long_press_playback_rate ?? 3,
  video_seek_step_seconds: settings.video_seek_step_seconds ?? 10
}))

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, '昵称不能为空').max(64, '昵称长度不能超过64个字符').optional(),
  image: z.string().url('头像地址格式不正确').optional().nullable()
})

export const updateUserSettingItemSchema = z.object({
  key: z.string().trim().min(1, '配置项键不能为空').max(120, '配置项键过长'),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.record(z.string(), z.unknown()),
    z.array(z.unknown()),
    z.null()
  ]),
  type: settingTypeSchema.optional()
})

export const updateUserSettingSchema = z.object({
  settings: z.array(updateUserSettingItemSchema).min(1, '至少需要一个配置项')
})

export const userSettingsResponseDTO = z.object({
  settings: userSettingsSchema
})

export type SettingType = z.infer<typeof settingTypeSchema>
export type ArtworkDisplayMode = z.infer<typeof artworkDisplayModeSchema>
export type ArtworkMediaAnchorInterval = z.infer<typeof artworkMediaAnchorIntervalSchema>
export type VideoLongPressPlaybackRate = z.infer<typeof videoLongPressPlaybackRateSchema>
export type VideoSeekStepSeconds = z.infer<typeof videoSeekStepSecondsSchema>
export type UserSettings = z.infer<typeof userSettingsSchema>
export type UserSettingsWithDefaults = z.infer<typeof userSettingsWithDefaultsSchema>
export type UpdateProfileDTO = z.infer<typeof updateProfileSchema>
export type UpdateUserSettingDTO = z.infer<typeof updateUserSettingItemSchema>
export type UpdateUserSettingsDTO = z.infer<typeof updateUserSettingSchema>
export type UserSettingsResponseDTO = z.infer<typeof userSettingsResponseDTO>
