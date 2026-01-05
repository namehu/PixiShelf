import { AuthMeResponseDTO } from '@/schemas/auth.dto'
import { authProcedure, router } from '@/server/trpc'

export const authRouter = router({
  /**
   * 获取当前用户信息
   */
  me: authProcedure.query(async ({ ctx }) => {
    return AuthMeResponseDTO.parse({
      id: Number(ctx.session.userId),
      username: ctx.session.username
    })
  })
})
