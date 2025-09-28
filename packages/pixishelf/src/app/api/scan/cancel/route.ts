import { NextResponse } from 'next/server'
import { getAppStateService } from '@/lib/services/app-state'

/**
 * 取消扫描接口
 * POST /api/scan/cancel
 */
export async function POST(): Promise<NextResponse> {
  try {
    const appStateService = getAppStateService()
    const state = appStateService.getState()

    if (!state.scanning) {
      return NextResponse.json({
        success: true,
        cancelled: false
      })
    }

    // 设置取消请求标志
    appStateService.setCancelRequested(true)

    return NextResponse.json({
      success: true,
      cancelled: true
    })
  } catch (error) {
    console.error('Failed to cancel scan:', error)

    return NextResponse.json({ error: 'Failed to cancel scan' }, { status: 500 })
  }
}
