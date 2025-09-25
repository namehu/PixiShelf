import { NextRequest, NextResponse } from 'next/server'
import { artworkService } from '@/services/artworkService'
import type { EnhancedArtworksResponse } from '@/types'

/**
 * 获取推荐作品接口
 * GET /api/artworks/recommendations
 */
export async function GET(request: NextRequest): Promise<NextResponse<EnhancedArtworksResponse>> {
  try {
    // 1. 解析请求参数
    const { searchParams } = new URL(request.url)
    const pageSize = parseInt(searchParams.get('pageSize') || '10', 10)

    // 2. 调用 Service 层
    const result = await artworkService.getRecommendedArtworks({ pageSize })

    // 3. 返回响应
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching recommended artworks:', error)
    return NextResponse.json({ error: 'Failed to fetch recommended artworks' } as any, { status: 500 })
  }
}
