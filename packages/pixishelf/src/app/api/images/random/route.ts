import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { RandomImageItem, RandomImagesResponse } from '@/types/images'
import { guid } from '@/utils/guid'
import { isVideoFile, MediaType } from '@/types'
import { combinationStaticAvatar } from '@/utils/combinationStatic'
import { sessionManager } from '@/lib/session'
import { likeService } from '@/services/likeService'
import { EMediaType } from '@/enums/EMediaType'
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '../../../../../lib/constant'

/**
 * Fisher-Yates (aka Knuth) Shuffle 算法。
 * 这是一个原地(in-place)打乱数组的优秀算法，比 sort + Math.random() 更随机、更高效。
 * @param array 需要打乱的数组
 */
function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = array[i]!
    array[i] = array[j]!
    array[j] = temp // 使用临时变量交换元素，避免解构赋值可能引发的类型错误
  }
  return array
}

const DEFAULT_MAX_IMAGE_COUNT = 8 // 默认图片最大数量

/**
 * 随机获取单张图片作品的API接口 (已优化为真随机)
 * GET /api/images/random?page=1&pageSize=20&count=8
 */
export async function GET(request: NextRequest): Promise<NextResponse<RandomImagesResponse>> {
  try {
    const { searchParams } = new URL(request.url)

    // 1. 获取当前用户信息（可选，未登录用户也可以访问）
    let { userId } = sessionManager.extractUserSessionFromRequest(request)

    // 2. 解析查询参数
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const pageSize = Math.min(Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)), 100)
    const skip = (page - 1) * pageSize

    // 解析count参数，设置默认值并验证范围
    const countParam = searchParams.get('count')
    const maxImageCount = countParam
      ? Math.min(Math.max(1, parseInt(countParam, 10)), 100) // 确保在1-100范围内
      : DEFAULT_MAX_IMAGE_COUNT

    // 新增：媒体类型筛选条件（all | image | video），默认 all
    const mediaTypeParamRaw = (searchParams.get('mediaType') || EMediaType.all).toLowerCase()
    const mediaTypeParam =
      mediaTypeParamRaw === EMediaType.image || mediaTypeParamRaw === EMediaType.video
        ? mediaTypeParamRaw
        : EMediaType.all

    // 构建 Prisma 过滤条件：基于文件扩展名进行过滤
    const buildMediaFilter = (type: EMediaType) => {
      if (type === EMediaType.all) return {}
      const exts = type === EMediaType.video ? VIDEO_EXTENSIONS : IMAGE_EXTENSIONS
      return {
        images: {
          some: {
            OR: exts.map((ext) => ({ path: { endsWith: ext, mode: 'insensitive' as const } }))
          }
        }
      }
    }

    // 3. 查询所有符合条件的 Artwork 的 ID
    // 只选择 id 字段，这样数据库查询非常快，内存占用也小
    const allArtworkIds = await prisma.artwork.findMany({
      where: {
        imageCount: { lte: maxImageCount },
        ...buildMediaFilter(mediaTypeParam)
      },
      select: { id: true },
      orderBy: {
        id: 'asc' // 排序有助于数据库缓存，但对逻辑无影响
      }
    })

    const total = allArtworkIds.length

    // 如果没有数据，返回空结果
    if (total === 0) {
      return NextResponse.json({
        items: [],
        total: 0,
        page,
        pageSize,
        nextPage: null
      })
    }

    // 4. 在应用层对所有 ID 进行随机排序
    const shuffledIds = shuffleArray(allArtworkIds.map((a) => a.id))

    // 5. 根据分页参数，从打乱后的 ID 数组中获取当前页的 ID
    const paginatedIds = shuffledIds.slice(skip, skip + pageSize)

    // 如果计算出的分页没有任何ID（比如请求了一个不存在的页码），则返回空
    if (paginatedIds.length === 0) {
      return NextResponse.json({
        items: [],
        total,
        page,
        pageSize,
        nextPage: null
      })
    }

    // 6. 使用获取到的 ID 去查询完整的 Artwork 数据
    const artworks = await prisma.artwork.findMany({
      where: {
        id: {
          in: paginatedIds
        },
        ...buildMediaFilter(mediaTypeParam)
      },
      include: {
        images: {
          take: maxImageCount,
          orderBy: { sortOrder: 'asc' }
        },
        artist: true,
        artworkTags: { include: { tag: true } }
      }
    })

    // 7. (重要) 保持随机顺序
    // prisma `findMany` with `in` 不保证返回顺序，我们需要根据 paginatedIds 的顺序重新排序
    const sortedArtworks = artworks.sort((a, b) => paginatedIds.indexOf(a.id) - paginatedIds.indexOf(b.id))

    // 8. 批量获取点赞状态（性能优化：单次查询）
    let likeStatusMap: Record<number, { likeCount: number; userLiked: boolean }> = {}
    try {
      likeStatusMap = await likeService.getBatchLikeStatus(userId, paginatedIds)
    } catch (error) {
      console.error('批量获取点赞状态失败:', error)
      // 如果获取点赞状态失败，继续执行，但所有 isLike 都为 false
    }

    // 9. 转换数据格式
    const items: RandomImageItem[] = sortedArtworks.map((artwork) => {
      const images = artwork.images
        .map((it) => (isVideoFile(it.path) ? `/api/v1/images/${it.path}` : it.path))
        .map((url) => ({ key: guid(), url }))

      const imageUrl = images[0]?.url ?? ''

      // 获取该作品的点赞状态，如果没有找到则默认为未点赞
      const likeStatus = likeStatusMap[artwork.id]
      const isLike = likeStatus ? likeStatus.userLiked : false

      return {
        id: artwork.id,
        key: guid(),
        title: artwork.title,
        description: artwork.description || '',
        imageUrl,
        mediaType: isVideoFile(imageUrl) ? MediaType.VIDEO : MediaType.IMAGE,
        images,
        author: artwork.artist
          ? {
              id: artwork.artist.id,
              userId: artwork.artist.userId || '',
              name: artwork.artist.name,
              avatar: combinationStaticAvatar(artwork.artist.userId, artwork.artist.avatar),
              username: artwork.artist.username || ''
            }
          : null,
        createdAt: artwork.createdAt.toISOString(),
        tags: artwork.artworkTags.map(({ tag }) => ({ id: tag.id, name: tag.name, name_zh: tag.name_zh })),
        isLike
      }
    })

    // 计算下一页
    const nextPage = skip + pageSize < total ? page + 1 : null

    const response: RandomImagesResponse = {
      items,
      total,
      page,
      pageSize,
      nextPage
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('获取随机图片失败:', error)

    // 详细的错误日志记录
    if (error instanceof Error) {
      console.error('错误详情:', {
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      })
    }

    // 返回标准错误响应
    return NextResponse.json(
      {
        error: '获取随机图片失败',
        message:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : '未知错误'
            : '服务器内部错误'
      } as any,
      { status: 500 }
    )
  }
}
