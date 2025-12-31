import { HealthResponse } from '@/types'
import { getSettingService } from '@/lib/services/setting'
import { apiHandler } from '@/lib/api-handler'
import z from 'zod'
import { HealthResponseSchema } from '@/schemas/health.dto'

/**
 * 健康检查接口
 * GET /api/health
 */
export const GET = apiHandler(z.object(), async () => {
  const settingService = getSettingService()
  const scanPath = await settingService.getScanPath()

  const response: HealthResponse = {
    status: 'ok',
    scanPath
  }

  return HealthResponseSchema.parse(response)
})
