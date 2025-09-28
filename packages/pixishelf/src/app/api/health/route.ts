import { NextResponse } from 'next/server'
import { HealthResponse } from '@/types'
import { getSettingService } from '@/lib/services/setting'

/**
 * 健康检查接口
 * GET /api/v1/health
 */
export async function GET(): Promise<NextResponse<HealthResponse>> {
  try {
    const settingService = getSettingService()
    const scanPath = await settingService.getScanPath()

    const response: HealthResponse = {
      status: 'ok',
      scanPath
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Health check failed:', error)

    const response: HealthResponse = {
      status: 'error',
      scanPath: null
    }

    return NextResponse.json(response, { status: 500 })
  }
}
