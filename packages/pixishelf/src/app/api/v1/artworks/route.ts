import { NextRequest, NextResponse } from 'next/server'
import { EnhancedArtworksResponse, SortOption, MediaTypeFilter, getMediaType, MediaFile } from '@/types'
import { prisma } from '@/lib/prisma'

// 排序选项映射（与原始文件保持一致）
function mapSortOption(sortBy: SortOption): any {
  switch (sortBy) {
    case 'title_asc':
      return { title: 'asc' }
    case 'title_desc':
      return { title: 'desc' }
    case 'artist_asc':
      return { artist: { name: 'asc' } }
    case 'artist_desc':
      return { artist: { name: 'desc' } }
    case 'images_desc':
      return { imageCount: 'desc' }
    case 'images_asc':
      return { imageCount: 'asc' }
    case 'source_date_asc':
      return { directoryCreatedAt: 'asc' }
    case 'source_date_desc':
    default:
      return { directoryCreatedAt: 'desc' }
  }
}

function getSafeSortOption(sortBy: string | null): SortOption {
  const validOptions: SortOption[] = [
    'title_asc',
    'title_desc',
    'artist_asc',
    'artist_desc',
    'images_desc',
    'images_asc',
    'source_date_desc',
    'source_date_asc'
  ]
  return validOptions.includes(sortBy as SortOption) ? (sortBy as SortOption) : 'source_date_desc'
}

/**
 * 获取作品列表接口
 * GET /api/v1/artworks
 */
export async function GET(request: NextRequest): Promise<NextResponse<EnhancedArtworksResponse>> {
  try {
    const { searchParams } = new URL(request.url)

    // 解析查询参数（与原始文件保持一致）
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const pageSize = Math.min(Math.max(1, parseInt(searchParams.get('pageSize') || '24', 10)), 100)
    const tags = searchParams.get('tags')?.split(',').filter(Boolean) || []
    const search = searchParams.get('search')?.trim() || ''
    const artistId = searchParams.get('artistId') ? parseInt(searchParams.get('artistId')!, 10) : undefined
    const tagId = searchParams.get('tagId') ? parseInt(searchParams.get('tagId')!, 10) : undefined
    const sortBy = getSafeSortOption(searchParams.get('sortBy'))
    const mediaType = (searchParams.get('mediaType') as MediaTypeFilter) || 'all'

    // 构建基础查询条件
    const whereClause: any = {}

    // 艺术家筛选
    if (artistId && Number.isFinite(artistId)) {
      whereClause.artistId = artistId
    }

    // 标签筛选
    if (tags.length > 0) {
      whereClause.artworkTags = {
        some: {
          tag: {
            name: { in: tags }
          }
        }
      }
    }

    // 标签ID筛选
    if (tagId && Number.isFinite(tagId)) {
      whereClause.artworkTags = {
        some: {
          tagId: tagId
        }
      }
    }

    // 媒体类型筛选
    if (mediaType === 'video') {
      whereClause.images = {
        some: {
          OR: [
            { path: { endsWith: '.mp4', mode: 'insensitive' } },
            { path: { endsWith: '.avi', mode: 'insensitive' } },
            { path: { endsWith: '.mov', mode: 'insensitive' } },
            { path: { endsWith: '.wmv', mode: 'insensitive' } },
            { path: { endsWith: '.flv', mode: 'insensitive' } },
            { path: { endsWith: '.webm', mode: 'insensitive' } },
            { path: { endsWith: '.mkv', mode: 'insensitive' } },
            { path: { endsWith: '.m4v', mode: 'insensitive' } }
          ]
        }
      }
    } else if (mediaType === 'image') {
      whereClause.NOT = {
        images: {
          some: {
            OR: [
              { path: { endsWith: '.mp4', mode: 'insensitive' } },
              { path: { endsWith: '.avi', mode: 'insensitive' } },
              { path: { endsWith: '.mov', mode: 'insensitive' } },
              { path: { endsWith: '.wmv', mode: 'insensitive' } },
              { path: { endsWith: '.flv', mode: 'insensitive' } },
              { path: { endsWith: '.webm', mode: 'insensitive' } },
              { path: { endsWith: '.mkv', mode: 'insensitive' } },
              { path: { endsWith: '.m4v', mode: 'insensitive' } }
            ]
          }
        }
      }
    }

    // 排序条件
    const orderBy = mapSortOption(sortBy)
    const skip = (page - 1) * pageSize

    let total: number
    let artworks: any[]

    if (search) {
      // 有搜索词时使用原生SQL查询（与原始文件保持一致的Trigram搜索逻辑）
      const searchCondition = `%${search}%`

      // 构建WHERE子句
      let whereSQL = 'WHERE 1=1'
      const params: any[] = []
      let paramIndex = 1

      if (artistId && Number.isFinite(artistId)) {
        whereSQL += ` AND a."artistId" = $${paramIndex}`
        params.push(artistId)
        paramIndex++
      }

      if (tags.length > 0) {
        whereSQL += ` AND EXISTS (
          SELECT 1 FROM "ArtworkTag" at2
          JOIN "Tag" t2 ON at2."tagId" = t2.id
          WHERE at2."artworkId" = a.id AND t2.name = ANY($${paramIndex})
        )`
        params.push(tags)
        paramIndex++
      }

      if (tagId && Number.isFinite(tagId)) {
        whereSQL += ` AND EXISTS (
          SELECT 1 FROM "ArtworkTag" at3
          WHERE at3."artworkId" = a.id AND at3."tagId" = $${paramIndex}
        )`
        params.push(tagId)
        paramIndex++
      }

      // 搜索条件（使用Trigram索引）
      whereSQL += ` AND (
        a.title ILIKE $${paramIndex} OR
        a.description ILIKE $${paramIndex} OR
        artist.name ILIKE $${paramIndex}
      )`
      params.push(searchCondition)
      paramIndex++

      // 媒体类型筛选
      if (mediaType === 'video') {
        whereSQL += ` AND EXISTS (
          SELECT 1 FROM "Image" i
          WHERE i."artworkId" = a.id AND (
            LOWER(i.path) LIKE '%.mp4' OR
            LOWER(i.path) LIKE '%.avi' OR
            LOWER(i.path) LIKE '%.mov' OR
            LOWER(i.path) LIKE '%.wmv' OR
            LOWER(i.path) LIKE '%.flv' OR
            LOWER(i.path) LIKE '%.webm' OR
            LOWER(i.path) LIKE '%.mkv' OR
            LOWER(i.path) LIKE '%.m4v'
          )
        )`
      } else if (mediaType === 'image') {
        whereSQL += ` AND NOT EXISTS (
          SELECT 1 FROM "Image" i
          WHERE i."artworkId" = a.id AND (
            LOWER(i.path) LIKE '%.mp4' OR
            LOWER(i.path) LIKE '%.avi' OR
            LOWER(i.path) LIKE '%.mov' OR
            LOWER(i.path) LIKE '%.wmv' OR
            LOWER(i.path) LIKE '%.flv' OR
            LOWER(i.path) LIKE '%.webm' OR
            LOWER(i.path) LIKE '%.mkv' OR
            LOWER(i.path) LIKE '%.m4v'
          )
        )`
      }

      // 构建排序子句
      let orderBySQL = ''
      switch (sortBy) {
        case 'title_asc':
          orderBySQL = 'ORDER BY a.title ASC'
          break
        case 'title_desc':
          orderBySQL = 'ORDER BY a.title DESC'
          break
        case 'artist_asc':
          orderBySQL = 'ORDER BY artist.name ASC'
          break
        case 'artist_desc':
          orderBySQL = 'ORDER BY artist.name DESC'
          break
        case 'images_desc':
          orderBySQL = 'ORDER BY a."imageCount" DESC'
          break
        case 'images_asc':
          orderBySQL = 'ORDER BY a."imageCount" ASC'
          break
        case 'source_date_asc':
          orderBySQL = 'ORDER BY a."directoryCreatedAt" ASC'
          break
        case 'source_date_desc':
        default:
          orderBySQL = 'ORDER BY a."directoryCreatedAt" DESC'
          break
      }

      // 查询总数
      const countQuery = `
        SELECT COUNT(*) as count
        FROM "Artwork" a
        LEFT JOIN "Artist" artist ON a."artistId" = artist.id
        ${whereSQL}
      `
      const countResult = await prisma.$queryRawUnsafe(countQuery, ...params)
      total = Number((countResult as any)[0].count)

      // 查询作品数据
      const artworksQuery = `
        SELECT
          a.*,
          artist.id as artist_id,
          artist.name as artist_name,
          artist.username as artist_username,
          artist."userId" as artist_userId,
          artist.bio as artist_bio,
          artist."createdAt" as artist_createdAt,
          artist."updatedAt" as artist_updatedAt
        FROM "Artwork" a
        LEFT JOIN "Artist" artist ON a."artistId" = artist.id
        ${whereSQL}
        ${orderBySQL}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `
      params.push(pageSize, skip)

      const rawArtworks = await prisma.$queryRawUnsafe(artworksQuery, ...params)

      // 获取图片数据
      const artworkIds = (rawArtworks as any[]).map((a) => a.id)
      const images =
        artworkIds.length > 0
          ? await prisma.image.findMany({
              where: { artworkId: { in: artworkIds } },
              orderBy: { sortOrder: 'asc' },
              take: artworkIds.length // 每个作品只取第一张图片
            })
          : []

      // 获取标签数据
      const artworkTags =
        artworkIds.length > 0
          ? await prisma.artworkTag.findMany({
              where: { artworkId: { in: artworkIds } },
              include: { tag: true }
            })
          : []

      // 获取图片计数
      const imageCounts =
        artworkIds.length > 0
          ? await prisma.image.groupBy({
              by: ['artworkId'],
              where: { artworkId: { in: artworkIds } },
              _count: { id: true }
            })
          : []

      // 组装最终结果
      artworks = (rawArtworks as any[]).map((rawArtwork) => {
        const artworkImages = images.filter((img) => img.artworkId === rawArtwork.id).slice(0, 1)
        const tags = artworkTags.filter((at) => at.artworkId === rawArtwork.id)
        const imageCount = imageCounts.find((ic) => ic.artworkId === rawArtwork.id)?._count.id || 0

        return {
          ...rawArtwork,
          artist: rawArtwork.artist_id
            ? {
                id: rawArtwork.artist_id,
                name: rawArtwork.artist_name,
                username: rawArtwork.artist_username,
                userId: rawArtwork.artist_userId,
                bio: rawArtwork.artist_bio,
                createdAt: rawArtwork.artist_createdAt,
                updatedAt: rawArtwork.artist_updatedAt
              }
            : null,
          images: artworkImages,
          artworkTags: tags,
          _count: { images: imageCount }
        }
      })
    } else {
      // 没有搜索词时使用标准Prisma查询
      total = await prisma.artwork.count({ where: whereClause })

      artworks = await prisma.artwork.findMany({
        where: whereClause,
        include: {
          images: { take: 1, orderBy: { sortOrder: 'asc' } },
          artist: true,
          artworkTags: { include: { tag: true } },
          _count: { select: { images: true } }
        },
        orderBy,
        skip,
        take: pageSize
      })
    }

    // 转换数据格式，将多对多关系的标签转换为字符串数组，并添加媒体类型信息
    const items = artworks.map((artwork) => {
      // 为每个图片添加mediaType字段
      const enhancedImages: MediaFile[] = artwork.images.map((image: any) => ({
        ...image,
        mediaType: getMediaType(image.path) as 'image' | 'video',
        sortOrder: image.sortOrder || 0,
        createdAt: image.createdAt.toISOString(),
        updatedAt: image.updatedAt.toISOString()
      }))

      // 计算视频统计信息
      const videoCount = enhancedImages.filter((img) => img.mediaType === 'video').length
      const totalMediaSize = videoCount ? enhancedImages.reduce((sum, img) => sum + (img.size || 0), 0) : 0 // 只统计视频大小

      const result = {
        ...artwork,
        images: enhancedImages,
        tags: artwork.artworkTags?.map((at: any) => at.tag.name) || [],
        imageCount: videoCount > 0 ? 0 : artwork._count?.images || artwork.imageCount || 0,
        videoCount,
        totalMediaSize,
        descriptionLength: artwork.descriptionLength || artwork.description?.length || 0,
        directoryCreatedAt: artwork.directoryCreatedAt?.toISOString() || null,
        createdAt: artwork.createdAt.toISOString(),
        updatedAt: artwork.updatedAt.toISOString(),
        artist: artwork.artist
          ? {
              ...artwork.artist,
              artworksCount: 0, // 这里可以根据需要查询实际数量
              createdAt: artwork.artist.createdAt?.toISOString(),
              updatedAt: artwork.artist.updatedAt?.toISOString()
            }
          : null,
        artworkTags: undefined as any,
        _count: undefined as any
      }
      // 删除undefined字段
      delete result.artworkTags
      delete result._count
      return result
    })

    const response: EnhancedArtworksResponse = { items, total, page, pageSize }
    return NextResponse.json(response)
  } catch (error) {
    console.error('Error fetching artworks:', error)
    return NextResponse.json({ error: 'Failed to fetch artworks' } as any, { status: 500 })
  }
}
