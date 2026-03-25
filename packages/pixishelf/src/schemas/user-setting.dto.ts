import { z } from 'zod'

export const settingTypeSchema = z.enum(['string', 'boolean', 'number', 'json'])

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, '昵称不能为空').max(64, '昵称长度不能超过64个字符').optional(),
  image: z.string().url('头像地址格式不正确').optional().nullable()
})

export const updateUserSettingItemSchema = z.object({
  key: z.string().trim().min(1, '配置项键不能为空').max(120, '配置项键过长'),
  value: z.union([z.string(), z.number(), z.boolean(), z.record(z.string(), z.unknown()), z.array(z.unknown()), z.null()]),
  type: settingTypeSchema.optional()
})

export const updateUserSettingSchema = z.object({
  settings: z.array(updateUserSettingItemSchema).min(1, '至少需要一个配置项')
})

export const userSettingsResponseDTO = z.object({
  settings: z.record(z.string(), z.unknown())
})

export type SettingType = z.infer<typeof settingTypeSchema>
export type UpdateProfileDTO = z.infer<typeof updateProfileSchema>
export type UpdateUserSettingDTO = z.infer<typeof updateUserSettingItemSchema>
export type UpdateUserSettingsDTO = z.infer<typeof updateUserSettingSchema>
export type UserSettingsResponseDTO = z.infer<typeof userSettingsResponseDTO>
