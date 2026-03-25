'use server'

import { authActionClient } from '@/lib/safe-action'
import { updateProfileSchema, updateUserSettingSchema } from '@/schemas/user-setting.dto'
import { upsertUserSettings, updateUserProfile } from '@/services/user-setting-service'

export const updateProfileAction = authActionClient
  .inputSchema(updateProfileSchema)
  .action(async ({ parsedInput, ctx: { userId } }) => {
    return updateUserProfile(userId, parsedInput)
  })

export const updateUserSettingAction = authActionClient
  .inputSchema(updateUserSettingSchema)
  .action(async ({ parsedInput, ctx: { userId } }) => {
    await upsertUserSettings(userId, parsedInput.settings)
    return { success: true }
  })
