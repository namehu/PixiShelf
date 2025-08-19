import { FastifyInstance } from 'fastify'
import { asApiResponse } from '../types/response'

export interface SearchSuggestion {
  type: 'artwork' | 'artist' | 'tag'
  value: string
  label: string
  metadata?: {
    artistName?: string
    imageCount?: number
    artworkCount?: number
  }
}

export interface SuggestionsResponse {
  suggestions: SearchSuggestion[]
}

export default async function suggestionsRoutes(server: FastifyInstance) {
  // GET /api/v1/suggestions - 获取搜索建议
  server.get('/api/v1/suggestions', async (req, reply) => {
    try {
      const q = req.query as any
      const query = (q.q as string)?.trim()
      const mode = (q.mode as string)?.trim() || 'normal' // 'normal' or 'tag'
      const limit = Math.min(10, Math.max(1, parseInt(q.limit) || 8))

      if (!query || query.length < 2) {
        return reply.send({ suggestions: [] })
      }

      const suggestions: SearchSuggestion[] = []

      // 如果是标签搜索模式，优先搜索标签
      if (mode === 'tag') {
        const tags = await server.prisma.tag.findMany({
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

        const response: SuggestionsResponse = asApiResponse({ suggestions })
        return reply.send(response)
      }

      // 搜索艺术家建议（限制前5个）
      const artists = await server.prisma.artist.findMany({
        where: {
          OR: [
            {
              name: {
                contains: query,
                mode: 'insensitive'
              }
            },
            {
              username: {
                contains: query,
                mode: 'insensitive'
              }
            }
          ]
        },
        select: {
          name: true,
          username: true,
          _count: {
            select: {
              artworks: true
            }
          }
        },
        orderBy: [
          {
            artworks: {
              _count: 'desc'
            }
          },
          {
            name: 'asc'
          }
        ],
        take: Math.min(5, limit)
      })

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

      // 搜索作品建议（剩余的限制数量）
      const remainingLimit = limit - suggestions.length
      if (remainingLimit > 0) {
        const artworks = await server.prisma.artwork.findMany({
          where: {
            OR: [
              {
                title: {
                  contains: query,
                  mode: 'insensitive'
                }
              },
              {
                description: {
                  contains: query,
                  mode: 'insensitive'
                }
              }
            ]
          },
          select: {
            title: true,
            artist: {
              select: {
                name: true
              }
            },
            _count: {
              select: {
                images: true
              }
            }
          },
          orderBy: [
            {
              images: {
                _count: 'desc'
              }
            },
            {
              createdAt: 'desc'
            }
          ],
          take: remainingLimit
        })

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

      const response: SuggestionsResponse = asApiResponse({ suggestions })
      return reply.send(response)
    } catch (error) {
      server.log.error({ error }, 'Error fetching search suggestions')
      return reply.code(500).send({ error: 'Failed to fetch suggestions' })
    }
  })
}
