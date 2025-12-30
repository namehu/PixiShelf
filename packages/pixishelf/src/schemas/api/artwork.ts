import z from 'zod'

/**
 * 推荐作品接口参数验证 Schema
 */
export const RecommendationsGetSchema = z.object({
  /** 每页数量 */
  pageSize: z.coerce.number().int().positive().default(10)
})

export type RecommendationsGetSchema = z.infer<typeof RecommendationsGetSchema>
