import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { transformSingleArtwork } from '@/services/artwork-service/utils'
import { ARTIST_SELECT } from '@/schemas/models/artists'
import { resolveMediaCoverUrl, VIDEO_POSTER_METADATA_SELECT } from '@/lib/media-cover'

export async function getSeriesList(params: {
  page: number
  pageSize: number
  query?: string
  source?: 'ALL' | 'PIXIV' | 'LOCAL'
  pixivStatus?: 'UNCHECKED' | 'SUCCESS' | 'PARTIAL' | 'NO_DATA' | 'FAILED'
}) {
  const { page, pageSize, query, source = 'ALL', pixivStatus } = params
  const skip = (page - 1) * pageSize

  const where: Prisma.SeriesWhereInput = {}
  if (query) {
    where.title = { contains: query } // SQLite/Postgres compatible simple search
  }
  if (source === 'PIXIV') where.externalRefs = { some: { providerKey: 'pixiv' } }
  if (source === 'LOCAL') where.externalRefs = { none: { providerKey: 'pixiv' } }
  if (pixivStatus) {
    where.externalRefs = {
      some: {
        providerKey: 'pixiv',
        status: pixivStatus === 'UNCHECKED' ? null : pixivStatus
      }
    }
  }

  const [items, total] = await Promise.all([
    prisma.series.findMany({
      where,
      skip,
      take: pageSize,
      include: {
        externalRefs: {
          where: { providerKey: 'pixiv' },
          take: 1
        },
        _count: {
          select: { seriesArtworks: { where: { excludedAt: null, artwork: { deletedAt: null } } } }
        },
        // 获取系列顺序中的第一张作品作为封面兜底
        seriesArtworks: {
          where: { excludedAt: null, artwork: { deletedAt: null } },
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
    const pixivRef = item.externalRefs[0] ?? null

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
      sourceKind: pixivRef ? ('PIXIV' as const) : ('LOCAL' as const),
      pixivSource: pixivRef
        ? {
            externalId: pixivRef.externalId,
            sourceTitle: pixivRef.sourceTitle,
            status: pixivRef.status,
            lastAttemptAt: pixivRef.lastAttemptAt,
            lastError: pixivRef.lastError
          }
        : null,
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
        where: { excludedAt: null, artwork: { deletedAt: null } },
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
      seriesOrder: sa.sortOrder,
      seriesMembership: {
        provenance: sa.provenance,
        sourceOrder: sa.sourceOrder,
        orderOverridden: sa.orderOverridden
      }
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

function stripSeriesListRelations<T extends { _count: unknown; seriesArtworks: unknown; externalRefs: unknown }>(
  item: T
): Omit<T, '_count' | 'seriesArtworks' | 'externalRefs'> {
  const copy = { ...item }
  delete copy._count
  delete copy.seriesArtworks
  delete copy.externalRefs
  return copy
}

export async function createSeries(data: { title: string; description?: string; coverImageUrl?: string }) {
  return prisma.series.create({ data })
}

export async function updateSeries(id: number, data: { title?: string; description?: string; coverImageUrl?: string }) {
  const current = await prisma.series.findUniqueOrThrow({ where: { id } })
  const update: Prisma.SeriesUpdateInput = {}
  if (data.title !== undefined && data.title !== current.title) {
    update.title = data.title
    update.titleOverridden = true
  }
  if (data.description !== undefined && data.description !== current.description) {
    update.description = data.description
    update.descriptionOverridden = true
  }
  if (data.coverImageUrl !== undefined && data.coverImageUrl !== current.coverImageUrl) {
    update.coverImageUrl = data.coverImageUrl
  }
  return prisma.series.update({
    where: { id },
    data: update
  })
}

export async function deleteSeries(id: number) {
  return prisma.series.delete({ where: { id } })
}

export async function addArtworkToSeries(seriesId: number, artworkId: number) {
  return prisma.$transaction(async (tx) => {
    // 检查是否已存在
    const exists = await tx.seriesArtwork.findUnique({
      where: { seriesId_artworkId: { seriesId, artworkId } }
    })
    if (exists) {
      return exists.excludedAt
        ? tx.seriesArtwork.update({
            where: { seriesId_artworkId: { seriesId, artworkId } },
            data: { excludedAt: null }
          })
        : exists
    }

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
        sortOrder: nextOrder,
        provenance: 'MANUAL'
      }
    })
    return sa
  })
}

export async function removeArtworkFromSeries(seriesId: number, artworkId: number) {
  return prisma.$transaction(async (tx) => {
    const membership = await tx.seriesArtwork.findUnique({
      where: { seriesId_artworkId: { seriesId, artworkId } }
    })
    if (!membership) return
    if (membership.provenance === 'SOURCE') {
      await tx.seriesArtwork.update({
        where: { seriesId_artworkId: { seriesId, artworkId } },
        data: { excludedAt: new Date() }
      })
      return
    }
    await tx.seriesArtwork.delete({ where: { seriesId_artworkId: { seriesId, artworkId } } })
  })
}

export async function reorderArtworks(seriesId: number, artworkIds: number[]) {
  // artworkIds 为新的排序顺序
  return prisma.$transaction((tx) =>
    Promise.all(
      artworkIds.map((id, index) =>
        tx.seriesArtwork.update({
          where: { seriesId_artworkId: { seriesId, artworkId: id } },
          data: { sortOrder: index + 1, orderOverridden: true }
        })
      )
    )
  )
}
