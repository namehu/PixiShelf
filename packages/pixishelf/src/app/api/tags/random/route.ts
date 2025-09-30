import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// 查询参数验证schema
const queryParamsSchema = z.object({
  count: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val) : 10)),
  minCount: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val) : 0)),
  excludeEmpty: z
    .string()
    .optional()
    .transform((val) => val === 'true')
})

/**
 * GET /api/tags/random
 * 随机标签API
 *
 * 查询参数:
 * - count: 返回数量，默认10，最大50
 * - minCount: 最小作品数量，默认0
 * - excludeEmpty: 是否排除空标签(无作品)，默认false
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // 验证查询参数
    const validationResult = queryParamsSchema.safeParse({
      count: searchParams.get('count'),
      minCount: searchParams.get('minCount'),
      excludeEmpty: searchParams.get('excludeEmpty')
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

    const { count, minCount, excludeEmpty } = validationResult.data

    // 限制返回数量
    const actualCount = Math.min(count, 50)

    // 构建查询条件
    const whereCondition: any = {}

    if (excludeEmpty || minCount > 0) {
      whereCondition.artworkCount = {
        gte: Math.max(minCount, excludeEmpty ? 1 : 0)
      }
    }

    // 获取符合条件的标签总数
    const totalCount = await prisma.tag.count({
      where: whereCondition
    })

    if (totalCount === 0) {
      return NextResponse.json({
        success: true,
        data: {
          tags: [],
          stats: {
            totalAvailable: 0,
            requested: actualCount,
            returned: 0
          },
          query: {
            count: actualCount,
            minCount,
            excludeEmpty: excludeEmpty || false
          }
        }
      })
    }

    // 生成随机偏移量
    const randomOffsets = new Set<number>()
    const maxOffset = Math.max(0, totalCount - 1)

    // 生成不重复的随机偏移量
    while (randomOffsets.size < Math.min(actualCount, totalCount)) {
      const randomOffset = Math.floor(Math.random() * totalCount)
      randomOffsets.add(randomOffset)
    }

    // 批量查询随机标签
    const randomTagsPromises = Array.from(randomOffsets).map((offset) =>
      prisma.tag.findMany({
        where: whereCondition,
        skip: offset,
        take: 1,
        select: {
          id: true,
          name: true,
          name_zh: true,
          description: true,
          artworkCount: true,
          createdAt: true,
          updatedAt: true
        }
      })
    )

    const randomTagsResults = await Promise.all(randomTagsPromises)
    const randomTags = randomTagsResults.filter((result) => result.length > 0).map((result) => result[0])

    // 如果获取的标签数量不足，补充查询
    if (randomTags.length < actualCount && randomTags.length < totalCount) {
      const existingIds = randomTags.map((tag) => tag?.id)
      const additionalTags = await prisma.tag.findMany({
        where: {
          ...whereCondition,
          id: {
            notIn: existingIds
          }
        },
        take: actualCount - randomTags.length,
        orderBy: {
          createdAt: 'desc' // 按创建时间倒序作为备选
        },
        select: {
          id: true,
          name: true,
          name_zh: true,
          description: true,
          artworkCount: true,
          createdAt: true,
          updatedAt: true
        }
      })

      randomTags.push(...additionalTags)
    }

    // 打乱结果顺序
    for (let i = randomTags.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[randomTags[i], randomTags[j]] = [randomTags[j], randomTags[i]]
    }

    return NextResponse.json({
      success: true,
      data: {
        tags: randomTags,
        stats: {
          totalAvailable: totalCount,
          requested: actualCount,
          returned: randomTags.length
        },
        query: {
          count: actualCount,
          minCount,
          excludeEmpty: excludeEmpty || false
        }
      }
    })
  } catch (error) {
    console.error('随机标签API错误:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: '获取随机标签时发生错误'
      },
      { status: 500 }
    )
  }
}
