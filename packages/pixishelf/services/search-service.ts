'use server'

import { prisma } from '@/lib/prisma'
import { SearchSuggestion, SearchSuggestionsResponse, SearchSuggestionsSchema } from '@/schemas/search.dto'

interface RawArtistSuggestion {
  id: number
  name: string
  username: string | null
  artwork_count: number | bigint | string
}

interface RawArtworkSuggestion {
  title: string
  artist_name: string | null
  image_count: number
}

/**
 * 获取搜索建议
 */
export async function getSearchSuggestions(options: SearchSuggestionsSchema): Promise<SearchSuggestionsResponse> {
  const { q: query, mode = 'normal', limit = 8 } = options

  if (!query || query.length < 2) {
    return { suggestions: [] }
  }

  const suggestions: SearchSuggestion[] = []

  // 如果是标签搜索模式，优先搜索标签
  if (mode === 'tag') {
    const tags = await prisma.tag.findMany({
      where: {
        name: {
          contains: query,
          mode: 'insensitive'
        }
      },
      select: {
        id: true,
        name: true,
        artworkCount: true
      },
      orderBy: [
        { artworkCount: 'desc' },
        {
          name: 'asc'
        }
      ],
      take: limit
    })

    // 添加标签建议
    tags.forEach((tag) => {
      suggestions.push({
        type: 'tag',
        value: tag.name,
        label: `#${tag.name}`,
        metadata: {
          id: tag.id,
          artworkCount: tag.artworkCount
        }
      })
    })

    return { suggestions }
  }

  // 搜索艺术家建议（限制前5个）- 使用Trigram索引
  const searchPattern = `%${query}%`
  const artistLimit = Math.min(5, limit)

  const artistsQuery = `
    SELECT
      a.id,
      a.name,
      a.username,
      COUNT(aw.id) as artwork_count
    FROM "Artist" a
    LEFT JOIN "Artwork" aw ON a.id = aw."artistId"
    WHERE (a.name ILIKE $1 OR a.username ILIKE $2)
    GROUP BY a.id, a.name, a.username
    ORDER BY artwork_count DESC, a.name ASC
    LIMIT $3
  `

  const rawArtists = await prisma.$queryRawUnsafe<RawArtistSuggestion[]>(
    artistsQuery,
    searchPattern,
    searchPattern,
    artistLimit
  )

  const artists = rawArtists.map((artist) => ({
    id: Number(artist.id),
    name: artist.name,
    username: artist.username,
    artworkCount: Number(artist.artwork_count) || 0
  }))

  // 添加艺术家建议
  artists.forEach((artist) => {
    suggestions.push({
      type: 'artist',
      value: artist.name,
      label: artist.name,
      metadata: {
        id: artist.id,
        imageCount: artist.artworkCount
      }
    })
  })

  // 搜索作品建议（剩余的限制数量）- 使用Trigram索引
  const remainingLimit = limit - suggestions.length
  if (remainingLimit > 0) {
    const artworksQuery = `
      SELECT
        aw.title,
        a.name as artist_name,
        aw."imageCount" as image_count
      FROM "Artwork" aw
      LEFT JOIN "Artist" a ON aw."artistId" = a.id
      WHERE (aw.title ILIKE $1 OR aw.description ILIKE $1)
      ORDER BY aw."imageCount" DESC, aw."createdAt" DESC
      LIMIT $2
    `

    const rawArtworks = await prisma.$queryRawUnsafe<RawArtworkSuggestion[]>(
      artworksQuery,
      searchPattern,
      remainingLimit
    )

    const artworks = rawArtworks.map((artwork) => ({
      title: artwork.title,
      artist: artwork.artist_name ? { name: artwork.artist_name } : null,
      imageCount: Number(artwork.image_count) || 0
    }))

    // 添加作品建议
    artworks.forEach((artwork) => {
      suggestions.push({
        type: 'artwork',
        value: artwork.title,
        label: artwork.title,
        metadata: {
          artistName: artwork.artist?.name,
          imageCount: artwork.imageCount
        }
      })
    })
  }

  return { suggestions }
}
