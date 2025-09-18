import { NextResponse } from 'next/server'
import { getAppStateService } from '@/lib/services/app-state'

/**
 * 获取扫描状态接口
 * GET /api/v1/scan/status
 */
export async function GET(): Promise<NextResponse> {
  try {
    const appStateService = getAppStateService()
    const state = appStateService.getState()
    
    return NextResponse.json({
      scanning: state.scanning,
      message: state.lastProgressMessage
    })
  } catch (error) {
    console.error('Failed to get scan status:', error)
    
    return NextResponse.json(
      { error: 'Failed to get scan status' },
      { status: 500 }
    )
  }
}