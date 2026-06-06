import { z } from 'zod'

export const SYSTEM_SETTING_KEYS = {
  replaceDefaultTagIds: 'replace_default_tag_ids'
} as const

export const systemSettingsSchema = z.object({
  replace_default_tag_ids: z.array(z.coerce.number().int().positive()).optional()
})

export const systemSettingsWithDefaultsSchema = systemSettingsSchema.default({}).transform((settings) => ({
  replace_default_tag_ids: settings.replace_default_tag_ids ?? []
}))

export const updateSystemSettingsSchema = z.object({
  replace_default_tag_ids: z.array(z.number().int().positive()).default([])
})

export const systemSettingsResponseDTO = z.object({
  settings: systemSettingsWithDefaultsSchema
})

export type SystemSettings = z.infer<typeof systemSettingsSchema>
export type SystemSettingsWithDefaults = z.infer<typeof systemSettingsWithDefaultsSchema>
export type UpdateSystemSettingsDTO = z.infer<typeof updateSystemSettingsSchema>
export type SystemSettingsResponseDTO = z.infer<typeof systemSettingsResponseDTO>
