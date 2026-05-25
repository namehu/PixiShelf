import { prisma } from '@/lib/prisma'
import { transformSingleArtwork } from '@/services/artwork-service/utils'
import { combinationApiResource } from '@/utils/combinationStatic'

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
          select: { seriesArtworks: true }
        },
        // Get the first artwork in series order to use as cover fallback
        seriesArtworks: {
          take: 1,
          orderBy: { sortOrder: 'asc' },
          include: {
            artwork: {
              include: {
                images: { orderBy: { sortOrder: 'asc' } },
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

  // Enhance items with derived cover
  const enhancedItems = items.map((item) => {
    let derivedCover = null
    const firstSeriesArtwork = item.seriesArtworks[0]

    if (firstSeriesArtwork?.artwork) {
      const transformed = transformSingleArtwork({
        ...firstSeriesArtwork.artwork,
        _count: { images: firstSeriesArtwork.artwork.images.length }
      })

      if (transformed.images.length > 0) {
        const firstImg = transformed.images[0]
        derivedCover = firstImg.mediaType === 'video' ? combinationApiResource(firstImg.path) : firstImg.path
      }
    }

    return {
      ...item,
      coverImageUrl: item.coverImageUrl || derivedCover || null,
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
        include: {
          artwork: {
            include: {
              artist: true,
              images: { orderBy: { sortOrder: 'asc' } },
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

  // Transform to flat artworks list with order
  const artworks = series.seriesArtworks.map((sa) => {
    const transformed = transformSingleArtwork({
      ...sa.artwork,
      _count: { images: sa.artwork.images.length }
    })

    return {
      ...transformed,
      seriesOrder: sa.sortOrder
    }
  })

  // Handle Cover Fallback
  let coverImageUrl = series.coverImageUrl
  if (!coverImageUrl && artworks.length > 0) {
    const firstArtwork = artworks[0]
    if (firstArtwork.images && firstArtwork.images.length > 0) {
      const firstImg = firstArtwork.images[0]
      // @ts-ignore - transformSingleArtwork result type might not be fully inferred here
      coverImageUrl = firstImg.mediaType === 'video' ? combinationApiResource(firstImg.path) : firstImg.path
    }
  }

  return { ...series, artworks, coverImageUrl }
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
    // Unlink artworks (set seriesId to null)
    // Note: SeriesArtwork will be auto-deleted due to Cascade, but Artwork.seriesId needs manual update if we want to keep artworks
    await tx.artwork.updateMany({
      where: { seriesId: id },
      data: { seriesId: null }
    })
    return tx.series.delete({ where: { id } })
  })
}

export async function addArtworkToSeries(seriesId: number, artworkId: number) {
  return prisma.$transaction(async (tx) => {
    // Check if already exists
    const exists = await tx.seriesArtwork.findUnique({
      where: { seriesId_artworkId: { seriesId, artworkId } }
    })
    if (exists) return exists

    // Get max order
    const maxOrder = await tx.seriesArtwork.aggregate({
      where: { seriesId },
      _max: { sortOrder: true }
    })
    const nextOrder = (maxOrder._max.sortOrder ?? 0) + 1

    // Create relation
    const sa = await tx.seriesArtwork.create({
      data: {
        seriesId,
        artworkId,
        sortOrder: nextOrder
      }
    })

    // Update artwork denormalized field
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
    } catch (e) {
      // Ignore if not found
    }
    await tx.artwork.update({
      where: { id: artworkId },
      data: { seriesId: null }
    })
  })
}

export async function reorderArtworks(seriesId: number, artworkIds: number[]) {
  // artworkIds is the new order
  return prisma.$transaction(
    artworkIds.map((id, index) =>
      prisma.seriesArtwork.update({
        where: { seriesId_artworkId: { seriesId, artworkId: id } },
        data: { sortOrder: index + 1 }
      })
    )
  )
}
