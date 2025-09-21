import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// 查询参数验证schema
const queryParamsSchema = z.object({
  limit: z.string().optional().transform(val => val ? parseInt(val) : 50),
  minCount: z.string().optional().transform(val => val ? parseInt(val) : 1)
})

/**
 * GET /api/v1/tags/popular
 * 热门标签API
 * 
 * 查询参数:
 * - limit: 返回数量，默认50，最大200
 * - minCount: 最小作品数量，默认1
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    
    // 验证查询参数
    const validationResult = queryParamsSchema.safeParse({
      limit: searchParams.get('limit'),
      minCount: searchParams.get('minCount')
    })
    
    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid parameters',
          details: validationResult.error.issues
        },
        { status: 400 }
      )
    }
    
    const { limit, minCount } = validationResult.data
    
    // 限制返回数量
    const actualLimit = Math.min(limit, 200)
    
    // 查询热门标签
    const popularTags = await prisma.tag.findMany({
      where: {
        artworkCount: {
          gte: minCount
        }
      },
      orderBy: [
        {
          artworkCount: 'desc'
        },
        {
          name: 'asc' // 相同作品数量时按名称排序
        }
      ],
      take: actualLimit,
      select: {
        id: true,
        name: true,
        description: true,
        artworkCount: true,
        createdAt: true,
        updatedAt: true
      }
    })
    
    // 获取统计信息
    const stats = await prisma.tag.aggregate({
      where: {
        artworkCount: {
          gte: minCount
        }
      },
      _count: {
        id: true
      },
      _sum: {
        artworkCount: true
      },
      _avg: {
        artworkCount: true
      },
      _max: {
        artworkCount: true
      }
    })
    
    return NextResponse.json({
      success: true,
      data: {
        tags: popularTags,
        stats: {
          totalTags: stats._count.id,
          totalArtworks: stats._sum.artworkCount || 0,
          averageArtworkCount: Math.round((stats._avg.artworkCount || 0) * 100) / 100,
          maxArtworkCount: stats._max.artworkCount || 0,
          returnedCount: popularTags.length
        },
        query: {
          limit: actualLimit,
          minCount
        }
      }
    })
    
  } catch (error) {
    console.error('热门标签API错误:', error)
    
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: '获取热门标签时发生错误'
      },
      { status: 500 }
    )
  }
}