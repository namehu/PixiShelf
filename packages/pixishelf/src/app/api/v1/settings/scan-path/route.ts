import { NextRequest, NextResponse } from 'next/server'
import { ScanPathRequest, ScanPathResponse, SettingsUpdateResponse } from '@/types'
import { getSettingService } from '@/lib/services/setting'

/**
 * 获取扫描路径设置接口
 * GET /api/v1/settings/scan-path
 */
export async function GET(request: NextRequest): Promise<NextResponse<ScanPathResponse>> {
  try {
    const settingService = getSettingService()
    const scanPath = await settingService.getScanPath()

    const response: ScanPathResponse = { scanPath }
    return NextResponse.json(response)
  } catch (error) {
    console.error('Failed to get scan path:', error)

    return NextResponse.json({ error: 'Failed to get scan path' } as any, { status: 500 })
  }
}

/**
 * 设置扫描路径接口
 * PUT /api/v1/settings/scan-path
 */
export async function PUT(request: NextRequest): Promise<NextResponse<SettingsUpdateResponse>> {
  try {
    const body = (await request.json()) as ScanPathRequest
    const scanPath = body?.scanPath?.trim()

    if (!scanPath) {
      return NextResponse.json({ error: 'scanPath is required' } as any, { status: 400 })
    }

    const settingService = getSettingService()
    await settingService.setScanPath(scanPath)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to set scan path:', error)

    return NextResponse.json({ error: 'Failed to set scan path' } as any, { status: 500 })
  }
}
