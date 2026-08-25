import { prisma } from '@/lib/prisma'
import { transformSingleArtwork } from '@/services/artwork-service/utils'
import { ARTIST_SELECT } from '@/schemas/models/artists'
import { resolveMediaCoverUrl, VIDEO_POSTER_METADATA_SELECT } from '@/lib/media-cover'

export async function getSeriesList(params: { page: number; pageSize: number; query?: string }) {
  const { page, pageSize, query } = params
  const skip = (page - 1) * pageSize

  const where: any = {}
  if (query) {
    where.title = { contains: query } // SQLite/Postgres compatible simple search
  }

  const [items, total] = await Promise.all([
    prisma.series.findMany({
      where,
      skip,
      take: pageSize,
      include: {
        _count: {
          select: { seriesArtworks: { where: { artwork: { deletedAt: null } } } }
        },
        // 获取系列顺序中的第一张作品作为封面兜底
        seriesArtworks: {
          where: { artwork: { deletedAt: null } },
          take: 1,
          orderBy: { sortOrder: 'asc' },
          include: {
            artwork: {
              include: {
                images: {
                  orderBy: { sortOrder: 'asc' },
                  include: { videoMetadata: { select: VIDEO_POSTER_METADATA_SELECT } }
                },
                artworkTags: { include: { tag: true } }
              }
            }
          }
        }
      },
      orderBy: { updatedAt: 'desc' }
    }),
    prisma.series.count({ where })
  ])

  // 用推导出的封面增强条目
  const enhancedItems = items.map((item) => {
    let derivedCover = null
    const firstSeriesArtwork = item.seriesArtworks[0]
    const seriesFields = stripSeriesListRelations(item)

    if (firstSeriesArtwork?.artwork) {
      const transformed = transformSingleArtwork({
        ...firstSeriesArtwork.artwork,
        _count: { images: firstSeriesArtwork.artwork.images.length }
      })

      if (transformed.images.length > 0) {
        const firstImg = transformed.images[0]
        derivedCover = resolveMediaCoverUrl(firstImg)
      }
    }

    return {
      ...seriesFields,
      coverImageUrl: resolveMediaCoverUrl(item.coverImageUrl ? { path: item.coverImageUrl } : null) || derivedCover,
      artworkCount: item._count.seriesArtworks
    }
  })

  return { items: enhancedItems, total }
}

export async function getSeriesDetail(id: number) {
  const series = await prisma.series.findUnique({
    where: { id },
    include: {
      seriesArtworks: {
        where: { artwork: { deletedAt: null } },
        include: {
          artwork: {
            include: {
              artist: { select: ARTIST_SELECT },
              images: {
                orderBy: { sortOrder: 'asc' },
                include: { videoMetadata: { select: VIDEO_POSTER_METADATA_SELECT } }
              },
              artworkTags: { include: { tag: true } }
            }
          }
        },
        orderBy: {
          sortOrder: 'asc'
        }
      }
    }
  })
  if (!series) return null
  const { seriesArtworks, ...seriesFields } = series

  // 将条目展平成有序作品列表
  const artworks = seriesArtworks.map((sa) => {
    const transformed = transformSingleArtwork({
      ...sa.artwork,
      _count: { images: sa.artwork.images.length }
    })

    return {
      ...transformed,
      seriesOrder: sa.sortOrder
    }
  })

  // 处理封面兜底
  let coverImageUrl = resolveMediaCoverUrl(series.coverImageUrl ? { path: series.coverImageUrl } : null)
  if (!coverImageUrl && artworks.length > 0) {
    const firstArtwork = artworks[0]
    if (firstArtwork.images && firstArtwork.images.length > 0) {
      const firstImg = firstArtwork.images[0]
      coverImageUrl = resolveMediaCoverUrl(firstImg)
    }
  }

  return { ...seriesFields, artworks, coverImageUrl }
}

function stripSeriesListRelations<T extends { _count: unknown; seriesArtworks: unknown }>(
  item: T
): Omit<T, '_count' | 'seriesArtworks'> {
  const copy = { ...item }
  delete copy._count
  delete copy.seriesArtworks
  return copy
}

export async function createSeries(data: { title: string; description?: string; coverImageUrl?: string }) {
  return prisma.series.create({ data })
}

export async function updateSeries(id: number, data: { title?: string; description?: string; coverImageUrl?: string }) {
  return prisma.series.update({
    where: { id },
    data
  })
}

export async function deleteSeries(id: number) {
  return prisma.$transaction(async (tx) => {
    // 取消作品关联（将 seriesId 置为 null）
    // 注意：SeriesArtwork 会因级联关系自动删除；若要保留作品本身，需手动更新 Artwork.seriesId
    await tx.artwork.updateMany({
      where: { seriesId: id },
      data: { seriesId: null }
    })
    return tx.series.delete({ where: { id } })
  })
}

export async function addArtworkToSeries(seriesId: number, artworkId: number) {
  return prisma.$transaction(async (tx) => {
    // 检查是否已存在
    const exists = await tx.seriesArtwork.findUnique({
      where: { seriesId_artworkId: { seriesId, artworkId } }
    })
    if (exists) return exists

    // 获取当前最大排序值
    const maxOrder = await tx.seriesArtwork.aggregate({
      where: { seriesId },
      _max: { sortOrder: true }
    })
    const nextOrder = (maxOrder._max.sortOrder ?? 0) + 1

    // 创建关系
    const sa = await tx.seriesArtwork.create({
      data: {
        seriesId,
        artworkId,
        sortOrder: nextOrder
      }
    })

    // 更新作品反范式字段
    await tx.artwork.update({
      where: { id: artworkId },
      data: { seriesId }
    })

    return sa
  })
}

export async function removeArtworkFromSeries(seriesId: number, artworkId: number) {
  return prisma.$transaction(async (tx) => {
    try {
      await tx.seriesArtwork.delete({
        where: { seriesId_artworkId: { seriesId, artworkId } }
      })
    } catch (_e) {
      // 未找到则跳过
    }
    await tx.artwork.update({
      where: { id: artworkId },
      data: { seriesId: null }
    })
  })
}

export async function reorderArtworks(seriesId: number, artworkIds: number[]) {
  // artworkIds 为新的排序顺序
  return prisma.$transaction(
    artworkIds.map((id, index) =>
      prisma.seriesArtwork.update({
        where: { seriesId_artworkId: { seriesId, artworkId: id } },
        data: { sortOrder: index + 1 }
      })
    )
  )
}
