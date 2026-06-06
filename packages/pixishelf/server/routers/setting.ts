import { authProcedure, router } from '@/server/trpc'
import { getScanPath, getSystemSettings, setScanPath, upsertSystemSettings } from '@/services/setting.service'
import { systemSettingsResponseDTO, updateSystemSettingsSchema } from '@/schemas/system-setting.dto'
import z from 'zod'

export const settingRouter = router({
  /**
   * 健康检查
   */
  health: authProcedure.query(async () => {
    const scanPath = await getScanPath()
    return { status: scanPath ? 'ok' : 'error' }
  }),
  /**
   * 获取扫描路径
   */
  getScanPath: authProcedure.query(async () => {
    const data = await getScanPath()
    return { data: data }
  }),

  /**
   * 设置扫描路径
   */
  setScanPath: authProcedure.input(z.object({ value: z.string() })).mutation(async ({ input }) => {
    await setScanPath(input.value)
  }),

  getSystemSettings: authProcedure.query(async () => {
    const settings = await getSystemSettings()
    return systemSettingsResponseDTO.parse({ settings })
  }),

  updateSystemSettings: authProcedure.input(updateSystemSettingsSchema).mutation(async ({ input }) => {
    const settings = await upsertSystemSettings(input)
    return systemSettingsResponseDTO.parse({ settings })
  })
})
