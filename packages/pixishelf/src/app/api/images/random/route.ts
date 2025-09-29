import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { RandomImageItem, RandomImagesResponse } from '@/types/images'
import imgproxyLoader from '../../../../../lib/image-loader'
import { guid } from '@/utils/guid'
import { isVideoFile, MediaType } from '@/types'

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

const MAX_IMAGE_COUNT = 10 // 图片最大数量

/**
 * 随机获取单张图片作品的API接口 (已优化为真随机)
 * GET /api/images/random
 */
export async function GET(request: NextRequest): Promise<NextResponse<RandomImagesResponse>> {
  try {
    const { searchParams } = new URL(request.url)

    // 1. 解析查询参数
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const pageSize = Math.min(Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)), 100)
    const skip = (page - 1) * pageSize

    // 2. 查询所有符合条件的 Artwork 的 ID
    // 只选择 id 字段，这样数据库查询非常快，内存占用也小
    const allArtworkIds = await prisma.artwork.findMany({
      where: {
        imageCount: { lte: MAX_IMAGE_COUNT }
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

    // 3. 在应用层对所有 ID 进行随机排序
    const shuffledIds = shuffleArray(allArtworkIds.map((a) => a.id))

    // 4. 根据分页参数，从打乱后的 ID 数组中获取当前页的 ID
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

    // 5. 使用获取到的 ID 去查询完整的 Artwork 数据
    const artworks = await prisma.artwork.findMany({
      where: {
        id: {
          in: paginatedIds
        }
      },
      include: {
        images: {
          take: MAX_IMAGE_COUNT,
          orderBy: { sortOrder: 'asc' }
        },
        artist: true,
        artworkTags: { include: { tag: true } }
      }
    })

    // 6. (重要) 保持随机顺序
    // prisma `findMany` with `in` 不保证返回顺序，我们需要根据 paginatedIds 的顺序重新排序
    const sortedArtworks = artworks.sort((a, b) => paginatedIds.indexOf(a.id) - paginatedIds.indexOf(b.id))

    // 7. 转换数据格式
    const items: RandomImageItem[] = sortedArtworks.map((artwork) => {
      const images = artwork.images
        .map((it) =>
          isVideoFile(it.path)
            ? `/api/v1/images/${it.path}`
            : imgproxyLoader({ src: it.path, width: 375, quality: 100 })
        )
        .map((url) => ({ key: guid(), url }))

      const imageUrl = images[0]?.url ?? ''

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
              name: artwork.artist.name,
              username: artwork.artist.username || ''
            }
          : null,
        createdAt: artwork.createdAt.toISOString(),
        tags: artwork.artworkTags.map(({ tag }) => ({ id: tag.id, name: tag.name }))
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
    console.error('Error fetching random images:', error)
    return NextResponse.json({ error: 'Failed to fetch random images' } as any, { status: 500 })
  }
}
