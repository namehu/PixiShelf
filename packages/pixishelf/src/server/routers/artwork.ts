import { authProcedure, publicProcedure, router } from '@/server/trpc'
import { z } from 'zod'
import {
  ArtworksInfiniteQuerySchema,
  NeighboringArtworksGetSchema,
  RandomArtworksGetSchema,
  RecommendationsGetSchema
} from '@/schemas/artwork.dto'
import {
  getArtworksList,
  getNeighboringArtworks,
  getRecommendedArtworks,
  getRandomArtworks,
  deleteArtwork,
  updateArtwork,
  getArtworkById,
  createArtwork
} from '@/services/artwork-service'
import logger from '@/lib/logger'
import { TRPCError } from '@trpc/server'

/**
 * 作品路由
 */
export const artworkRouter = router({
  /**
   * 获取作品详情
   */
  getById: publicProcedure.input(z.number()).query(async ({ input }) => {
    return getArtworkById(input)
  }),

  /**
   * 获取作品列表 (无限加载)
   */
  list: publicProcedure.input(ArtworksInfiniteQuerySchema).query(async ({ input }) => {
    const page = input.cursor ?? 1
    const result = await getArtworksList(input)
    const totalPages = Math.ceil(result.total / result.pageSize)
    return {
      items: result.items,
      nextCursor: page < totalPages ? page + 1 : undefined,
      total: result.total
    }
  }),

  /**
   * 创建作品
   */
  create: authProcedure
    .input(
      z.object({
        title: z.string().min(1, '标题不能为空'),
        description: z.string().optional(),
        artistId: z.number('请选择艺术家'),
        tags: z.array(z.number()).optional()
      })
    )
    .mutation(async ({ input }) => {
      return createArtwork(input)
    }),

  /**
   * 更新作品
   */
  update: authProcedure
    .input(
      z.object({
        id: z.number(),
        data: z.object({
          title: z.string().optional(),
          description: z.string().optional(),
          artistId: z.number('请选择艺术家'),
          tags: z.array(z.number()).optional()
        })
      })
    )
    .mutation(async ({ input }) => {
      return updateArtwork(input.id, input.data)
    }),

  /**
   * 删除作品
   */
  delete: authProcedure.input(z.number()).mutation(async ({ input }) => {
    return deleteArtwork(input)
  }),

  /**
   * 获取邻近作品（前后作品）
   */
  getNeighbors: publicProcedure.input(NeighboringArtworksGetSchema).query(async ({ input }) => {
    return await getNeighboringArtworks(input)
  }),

  /**
   * 获取推荐作品
   */
  queryRecommendPage: authProcedure.input(RecommendationsGetSchema).query(async ({ input }) => {
    return getRecommendedArtworks({
      pageSize: input.pageSize,
      cursor: input.cursor ?? undefined
    })
  }),

  /**
   * 随机获取单张图片作品的API接口 (已优化为真随机)
   */
  random: authProcedure.input(RandomArtworksGetSchema).query(async ({ input, ctx }) => {
    try {
      return getRandomArtworks({
        ...input,
        userId: ctx.userId!
      })
    } catch (error) {
      logger.error('获取随机图片失败:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: '获取随机图片失败',
        cause: error
      })
    }
  })
})
