'use server'

import logger from '@/lib/logger'
import { getNoSeriesArtworkExternalIds } from '@/services/artwork-service'

/**
 * 导出无系列作品的 External ID
 * 返回 ID 列表
 */
export async function exportNoSeriesArtworksAction() {
  try {
    const data = await getNoSeriesArtworkExternalIds()
    return {
      data,
      success: true
    }
  } catch (error) {
    logger.error('❌ 导出无系列作品失败:', error)
    return {
      success: false,
      error: '导出失败',
      message: error instanceof Error ? error.message : '未知错误'
    }
  }
}
