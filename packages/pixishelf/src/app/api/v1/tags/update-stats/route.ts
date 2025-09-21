import { NextRequest, NextResponse } from 'next/server'
import { initializeTagArtworkCount } from '../../../../../../scripts/init-tag-artwork-count'

/**
 * POST /api/v1/tags/update-stats
 * 手动更新标签作品数量统计
 *
 * 需要管理员权限
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🚀 手动触发标签统计更新...')

    // 执行标签统计更新
    await initializeTagArtworkCount()

    return NextResponse.json({
      success: true,
      message: '标签统计更新完成',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('❌ 标签统计更新失败:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : '未知错误'
      },
      { status: 500 }
    )
  }
}
