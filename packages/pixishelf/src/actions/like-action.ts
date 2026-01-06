'use server'

import { authActionClient } from '@/lib/safe-action'
import { likeService } from '@/services/like-service'
import z from 'zod'

/**
 * 切换点赞状态操作
 */
export const toggleLikeAction = authActionClient
  .inputSchema(
    z.object({
      artworkId: z.number().int().positive()
    })
  )
  .action(async ({ parsedInput: { artworkId }, ctx: { userId } }) => {
    const result = await likeService.toggleLike(userId!, artworkId)
    return {
      data: result
    }
  })
