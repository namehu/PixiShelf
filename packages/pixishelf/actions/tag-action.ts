'use server'

import logger from '@/lib/logger'
import { authActionClient } from '@/lib/safe-action'
import { rebuildTagArtworkCounts } from '@/services/tag-count-service'

/**
 * 手动更新标签作品数量统计
 * 需要管理员权限
 */
export const updateTagStatsAction = authActionClient.action(async () => {
  try {
    logger.info('🚀 手动触发标签统计更新...')

    // 执行标签统计更新
    const result = await rebuildTagArtworkCounts()

    return {
      success: true,
      message: `标签统计更新完成，共修正 ${result.updatedTags} 个标签`,
      updatedTags: result.updatedTags,
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
})
