import { artworkService } from '@/services/artworkService'
import { artistService } from '@/services/artistService'
import { ArtistsResponse } from '@/types'
import type { EnhancedArtworksResponse } from '@/types'

/**
 * 获取推荐作品数据
 */
export async function getRecommendedArtworks(): Promise<EnhancedArtworksResponse> {
  // 直接调用 Service 层，避免代码重复
  return artworkService.getRecommendedArtworks({ pageSize: 10 })
}

/**
 * 获取最新作品数据
 */
export async function getRecentArtworks(): Promise<EnhancedArtworksResponse> {
  // 直接调用 Service 层，避免代码重复
  return artworkService.getRecentArtworks({ page: 1, pageSize: 10 })
}

/**
 * 获取热门艺术家数据
 */
export async function getRecentArtists(): Promise<ArtistsResponse> {
  // 直接调用 Service 层，避免代码重复
  return artistService.getRecentArtists({ page: 1, pageSize: 10 })
}