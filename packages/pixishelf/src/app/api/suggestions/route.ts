import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { SearchSuggestion, SuggestionsResponse } from '@/types'

/**
 * GET /api/suggestions - 获取搜索建议
 *
 * 查询参数:
 * - q: 搜索关键词 (必需，至少2个字符)
 * - mode: 搜索模式 ('normal' | 'tag'，默认 'normal')
 * - limit: 返回结果数量限制 (1-10，默认8)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')?.trim()
    const mode = searchParams.get('mode')?.trim() || 'normal' // 'normal' or 'tag'
    const limit = Math.min(10, Math.max(1, parseInt(searchParams.get('limit') || '8')))

    if (!query || query.length < 2) {
      return NextResponse.json({ suggestions: [] })
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
          name: true,
          _count: {
            select: {
              artworkTags: true
            }
          }
        },
        orderBy: [
          {
            artworkTags: {
              _count: 'desc'
            }
          },
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
            artworkCount: tag._count.artworkTags
          }
        })
      })

      const response: SuggestionsResponse = { suggestions }
      return NextResponse.json(response)
    }

    // 搜索艺术家建议（限制前5个）- 使用Trigram索引
    const searchPattern = `%${query}%`
    const artistLimit = Math.min(5, limit)

    const artistsQuery = `
      SELECT
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

    const rawArtists = (await prisma.$queryRawUnsafe(artistsQuery, searchPattern, searchPattern, artistLimit)) as any[]

    const artists = rawArtists.map((artist) => ({
      name: artist.name,
      username: artist.username,
      _count: {
        artworks: parseInt(artist.artwork_count) || 0
      }
    }))

    // 添加艺术家建议
    artists.forEach((artist) => {
      suggestions.push({
        type: 'artist',
        value: artist.name,
        label: artist.name,
        metadata: {
          imageCount: artist._count.artworks
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
          COUNT(i.id) as image_count
        FROM "Artwork" aw
        LEFT JOIN "Artist" a ON aw."artistId" = a.id
        LEFT JOIN "Image" i ON aw.id = i."artworkId"
        WHERE (aw.title || ' ' || COALESCE(aw.description, '')) ILIKE $1
        GROUP BY aw.id, aw.title, aw."createdAt", a.name
        ORDER BY image_count DESC, aw."createdAt" DESC
        LIMIT $2
      `

      const rawArtworks = (await prisma.$queryRawUnsafe(artworksQuery, searchPattern, remainingLimit)) as any[]

      const artworks = rawArtworks.map((artwork) => ({
        title: artwork.title,
        artist: artwork.artist_name ? { name: artwork.artist_name } : null,
        _count: {
          images: parseInt(artwork.image_count) || 0
        }
      }))

      // 添加作品建议
      artworks.forEach((artwork) => {
        suggestions.push({
          type: 'artwork',
          value: artwork.title,
          label: artwork.title,
          metadata: {
            artistName: artwork.artist?.name,
            imageCount: artwork._count.images
          }
        })
      })
    }

    const response: SuggestionsResponse = { suggestions }
    return NextResponse.json(response)
  } catch (error) {
    console.error('Error fetching search suggestions:', error)
    return NextResponse.json({ error: 'Failed to fetch suggestions' }, { status: 500 })
  }
}
