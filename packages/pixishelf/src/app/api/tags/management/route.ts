/**
 * 标签管理API - 获取标签管理列表
 * GET /api/tags/management
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { TagManagementParams, TagManagementResponse, TagManagementStats } from '@/types/tags'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // 解析查询参数
    const params: TagManagementParams = {
      page: parseInt(searchParams.get('page') || '1'),
      limit: Math.min(parseInt(searchParams.get('limit') || '30'), 100),
      search: searchParams.get('search') || undefined,
      filter: (searchParams.get('filter') as 'all' | 'translated' | 'untranslated') || 'all',
      sort: (searchParams.get('sort') as any) || 'artworkCount',
      order: (searchParams.get('order') as 'asc' | 'desc') || 'desc'
    }

    // 构建where条件
    const whereConditions: any = {}

    // 搜索条件
    if (params.search) {
      whereConditions.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { name_zh: { contains: params.search, mode: 'insensitive' } }
      ]
    }

    // 筛选条件
    if (params.filter === 'translated') {
      whereConditions.name_zh = { not: null }
    } else if (params.filter === 'untranslated') {
      whereConditions.name_zh = null
    }

    // 计算偏移量
    const skip = (params.page! - 1) * params.limit!

    // 构建排序条件
    const orderBy: any = {}
    if (params.sort) {
      orderBy[params.sort] = params.order
    }

    // 获取标签列表
    const [tags, totalCount] = await Promise.all([
      prisma.tag.findMany({
        where: whereConditions,
        orderBy,
        skip,
        take: params.limit!,
        select: {
          id: true,
          name: true,
          name_zh: true,
          description: true,
          artworkCount: true,
          createdAt: true,
          updatedAt: true
        }
      }),
      prisma.tag.count({ where: whereConditions })
    ])

    // 获取统计信息
    const stats: TagManagementStats = await getTagManagementStats()

    // 计算分页信息
    const totalPages = Math.ceil(totalCount / params.limit!)
    const hasNextPage = params.page! < totalPages
    const hasPrevPage = params.page! > 1

    const response: TagManagementResponse = {
      success: true,
      data: {
        tags: tags.map((tag) => ({
          ...tag,
          createdAt: tag.createdAt.toISOString(),
          updatedAt: tag.updatedAt.toISOString()
        })),
        pagination: {
          page: params.page!,
          limit: params.limit!,
          totalCount,
          totalPages,
          hasNextPage,
          hasPrevPage
        },
        stats,
        query: params
      }
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Tag management API error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

/**
 * 获取标签管理统计信息
 */
async function getTagManagementStats(): Promise<TagManagementStats> {
  const [totalTags, translatedTags] = await Promise.all([
    prisma.tag.count(),
    prisma.tag.count({ where: { name_zh: { not: null } } })
  ])

  const untranslatedTags = totalTags - translatedTags
  const translationRate = totalTags > 0 ? (translatedTags / totalTags) * 100 : 0

  return {
    totalTags,
    translatedTags,
    untranslatedTags,
    translationRate: Math.round(translationRate * 100) / 100 // 保留两位小数
  }
}
