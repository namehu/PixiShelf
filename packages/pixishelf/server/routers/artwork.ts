import 'server-only'
import { revalidatePath } from 'next/cache'
import { adminProcedure, authProcedure, router } from '@/server/trpc'
import path from 'path'
import { z } from 'zod'
import {
  ArtworksInfiniteQuerySchema,
  NeighboringArtworksGetSchema,
  RandomArtworksGetSchema,
  RecommendationsGetSchema,
  ViewerFeedQuerySchema
} from '@/schemas/artwork.dto'
import {
  getArtworkCardsPage,
  getArtworksList,
  getNeighboringArtworks,
  getRecommendedArtworks,
  getRandomArtworks,
  getViewerFeed,
  deleteArtwork,
  updateArtwork,
  getArtworkById,
  createArtwork
} from '@/services/artwork-service'
import logger from '@/lib/logger'
import { TRPCError } from '@trpc/server'
import {
  ArtworkImageOrderError,
  addImageWithChapters,
  deleteImage,
  reorderArtworkImages
} from '@/services/artwork-service/image-manager'
import { getScanPath } from '@/services/setting.service'
import { reprobeVideoMediaByImageId, resolveVideoImageForReprobeId } from '@/services/video-media-probe-service'
import { enqueueCentralVideoMediaReprobe } from '@/services/video-media-central-service'
import { isCentralDispatcherCutoverEnabled } from '@/services/background-task/dispatcher-cutover'
import { BackgroundTaskError } from '@/services/background-task/background-task-error'
import { determineArtworkRelDir } from '@/services/artwork-service/utils'
import { ArtworkSourceEnum } from '@/schemas/models'

/**
 * 作品路由
 */
export const artworkRouter = router({
  /**
   * 获取作品详情
   */
  getById: authProcedure.input(z.number()).query(async ({ input }) => {
    return getArtworkById(input)
  }),

  /**
   * 获取作品列表 (无限加载)
   */
  list: authProcedure.input(ArtworksInfiniteQuerySchema).query(async ({ input }) => {
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
   * 获取作品卡片列表；仅第一页返回精确总数，后续页通过多取一条判断是否还有下一页。
   */
  cardList: authProcedure.input(ArtworksInfiniteQuerySchema).query(async ({ input }) => {
    const page = input.cursor ?? 1
    const result = await getArtworkCardsPage(input)
    return {
      items: result.items,
      nextCursor: result.hasNextPage ? page + 1 : undefined,
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
        tags: z.array(z.number()).optional(),
        source: ArtworkSourceEnum.optional(),
        sourceDate: z.date().or(z.string())
      })
    )
    .mutation(({ input }) => {
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
          tags: z.array(z.number()).optional(),
          sourceDate: z.date().or(z.string())
        })
      })
    )
    .mutation(async ({ input }) => {
      return updateArtwork(input.id, input.data)
    }),

  /**
   * 删除作品
   */
  delete: adminProcedure.input(z.number()).mutation(async ({ input, ctx }) => {
    return deleteArtwork(input, { requestedByUserId: ctx.userId })
  }),

  /**
   * 删除图片
   */
  deleteImage: authProcedure
    .input(
      z.object({
        id: z.number(),
        deleteFile: z.boolean().default(false)
      })
    )
    .mutation(async ({ input }) => {
      return deleteImage(input.id, input.deleteFile)
    }),

  /**
   * 新增图片
   */
  addImage: authProcedure
    .input(
      z.object({
        artworkId: z.number(),
        file: z.object({
          fileName: z.string(),
          order: z.number(),
          width: z.number(),
          height: z.number(),
          size: z.number(),
          path: z.string()
        }),
        chaptersMeta: z
          .object({
            chaptersPath: z.string(),
            chaptersCount: z.number().int().min(0),
            chaptersDuration: z.number().positive(),
            chaptersHash: z.string()
          })
          .optional()
      })
    )
    .mutation(async ({ input }) => {
      return addImageWithChapters(input.artworkId, input.file, input.chaptersMeta)
    }),

  reorderImages: authProcedure
    .input(
      z.object({
        artworkId: z.number().int().positive(),
        imageIds: z.array(z.number().int().positive()).min(2).max(10000),
        expectedImageIds: z.array(z.number().int().positive()).min(2).max(10000)
      })
    )
    .mutation(async ({ input }) => {
      // 变更图片顺序后会同步刷新多个 Next.js 缓存路径（详情页/列表/控制台），
      // 以确保同一次重排对前端全局可见且无需等待分页刷新。
      try {
        const result = await reorderArtworkImages(input)
        revalidatePath(`/artworks/${input.artworkId}`)
        revalidatePath('/artworks')
        revalidatePath('/dashboard')
        return result
      } catch (error) {
        if (error instanceof ArtworkImageOrderError) {
          if (error.code === 'NOT_FOUND') {
            throw new TRPCError({ code: 'NOT_FOUND', message: error.message })
          }
          if (error.code === 'CONFLICT') {
            throw new TRPCError({ code: 'CONFLICT', message: error.message })
          }
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message })
        }
        throw error
      }
    }),

  // 仅在有扫描根目录时才能重探测视频元信息；服务内部不允许越权访问 scan root 外路径，
  // 所以此处把“路径逃逸/非视频文件”等错误统一转为 BAD_REQUEST。
  reprobeVideoMedia: adminProcedure
    .input(z.object({ imageId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const scanPath = await getScanPath()
      if (!scanPath) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Scan path is not configured' })
      }

      try {
        if (isCentralDispatcherCutoverEnabled()) {
          const image = await resolveVideoImageForReprobeId(input.imageId, scanPath)
          const queued = await enqueueCentralVideoMediaReprobe({
            imageId: image.id,
            requestedByUserId: ctx.userId
          })
          return { mode: 'QUEUED' as const, ...queued }
        }
        const metadata = await reprobeVideoMediaByImageId(input.imageId, scanPath)
        return { mode: 'COMPLETED' as const, metadata }
      } catch (error) {
        if (error instanceof BackgroundTaskError && error.code === 'ACTIVE_JOB_CONFLICT') {
          throw new TRPCError({ code: 'CONFLICT', message: error.message })
        }
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message === 'Image not found' || message === 'Video image not found') {
          throw new TRPCError({ code: 'NOT_FOUND', message })
        }
        if (message === 'Image is not a video' || message.startsWith('Path escapes scan root')) {
          throw new TRPCError({ code: 'BAD_REQUEST', message })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message })
      }
    }),

  /**
   * 获取上传路径
   */
  getUploadPath: authProcedure.input(z.number()).query(async ({ input }) => {
    // 返回“相对路径”和“绝对路径”双重信息，便于前端拼接表单上传目标；
    // 其中 targetRelDir 由作品元数据推导，若无法判定则直接拒绝，避免上传落到无效目录。
    const artwork = await getArtworkById(input)
    if (!artwork) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Artwork not found' })
    }

    const scanPath = await getScanPath()
    if (!scanPath) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'SCAN_PATH not set' })
    }

    const targetRelDir = determineArtworkRelDir(artwork)

    if (!targetRelDir) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot determine upload path' })
    }

    const targetDir = path.join(scanPath, targetRelDir)

    return { targetDir, targetRelDir }
  }),

  /**
   * 获取邻近作品（前后作品）
   */
  getNeighbors: authProcedure.input(NeighboringArtworksGetSchema).query(async ({ input }) => {
    return await getNeighboringArtworks(input)
  }),

  /**
   * 获取推荐作品
   */
  queryRecommendPage: authProcedure.input(RecommendationsGetSchema).query(async ({ input }) => {
    return getRecommendedArtworks({
      pageSize: input.pageSize,
      cursor: input.cursor ?? undefined,
      tagNames: input.tagNames
    })
  }),

  /**
   * 随机获取单张图片作品的API接口 (已优化为真随机)
   */
  random: authProcedure.input(RandomArtworksGetSchema).query(async ({ input, ctx }) => {
    try {
      return getRandomArtworks({
        ...input,
        userId: ctx.userId
      })
    } catch (error) {
      logger.error('获取随机图片失败:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: '获取随机图片失败',
        cause: error
      })
    }
  }),

  /**
   * 获取沉浸浏览 Feed
   */
  viewerFeed: authProcedure.input(ViewerFeedQuerySchema).query(async ({ input, ctx }) => {
    try {
      return getViewerFeed({
        ...input,
        userId: ctx.userId
      })
    } catch (error) {
      logger.error('获取沉浸浏览 Feed 失败:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: '获取沉浸浏览 Feed 失败',
        cause: error
      })
    }
  })
})
