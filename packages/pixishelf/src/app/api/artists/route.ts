import { NextRequest, NextResponse } from 'next/server'
import { artistService } from '@/services/artistService'
import { ArtistsQuery } from '@/types'

/**
 * 获取艺术家列表接口
 * GET /api/artists
 */
export async function GET(request: NextRequest) {
  try {
    // 1. 解析请求参数
    const { searchParams } = new URL(request.url)
    const query: ArtistsQuery = {
      page: searchParams.get('page') || undefined,
      pageSize: searchParams.get('pageSize') || undefined,
      search: searchParams.get('search') || undefined,
      sortBy: (searchParams.get('sortBy') as ArtistsQuery['sortBy']) || undefined
    }

    // 2. 验证查询参数
    const validatedQuery = artistService.validateArtistsQuery(query)

    // 3. 调用 Service 层
    const result = await artistService.getArtists(validatedQuery)

    // 4. 返回响应
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching artists:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
