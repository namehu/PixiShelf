import { userSettingsResponseDTO } from '@/schemas/user-setting.dto'
import { getUserSettings } from '@/services/user-setting-service'
import { authProcedure, router } from '@/server/trpc'

export const userSettingRouter = router({
  getMySettings: authProcedure.query(async ({ ctx: { userId } }) => {
    const settings = await getUserSettings(userId)
    return userSettingsResponseDTO.parse({ settings })
  })
})
