'use server'

import { authActionClient } from '@/lib/safe-action'
import { toggleLike } from '@/services/like-service'
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
    const result = await toggleLike(userId!, artworkId)
    return {
      data: result
    }
  })
