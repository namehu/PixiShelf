'use server'

import logger from '@/lib/logger'
import { initializeTagArtworkCount } from '../../scripts/init-tag-artwork-count'

/**
 * 手动更新标签作品数量统计
 * 需要管理员权限
 */
export async function updateTagStatsAction() {
  try {
    logger.info('🚀 手动触发标签统计更新...')

    // 执行标签统计更新
    await initializeTagArtworkCount()

    return {
      success: true,
      message: '标签统计更新完成',
      timestamp: new Date().toISOString()
    }
  } catch (error) {
    logger.error('❌ 标签统计更新失败:', error)

    return {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : '未知错误'
    }
  }
}
