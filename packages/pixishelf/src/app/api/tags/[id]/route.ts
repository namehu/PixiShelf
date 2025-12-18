import { apiHandler } from '@/lib/api-handler'
import { getById } from '@/services/tag-service'
import { ApiError } from '@/lib/errors'
import { z } from 'zod'

// 定义 Schema：这里可以混合定义 Path 参数和 Query 参数
const GetTagSchema = z.object({
  /** 标签ID 路径参数*/
  id: z.coerce.number().positive()
})

/**
 * GET /api/tags/[id]
 * 获取单个标签详情
 */
export const GET = apiHandler(GetTagSchema, async (req, data) => {
  const tag = await getById(data.id)

  if (!tag) {
    throw new ApiError('Tag not found', 404)
  }

  return tag // 直接返回数据对象
})
