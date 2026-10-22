'use server'

import { ActionError, authActionClient } from '@/lib/safe-action'
import { toggleLike } from '@/services/like-service'
import z from 'zod'

/**
 * 切换点赞状态操作
 */
export const toggleLikeAction = authActionClient
  .inputSchema(
    z.object({
      artworkId: z.number().int().positive(),
      expectedUserId: z.string().min(1)
    })
  )
  .action(async ({ parsedInput: { artworkId, expectedUserId }, ctx: { userId } }) => {
    if (expectedUserId !== userId) throw new ActionError('账户已切换，请刷新后重试。')
    const result = await toggleLike(userId, artworkId)
    return result
  })
