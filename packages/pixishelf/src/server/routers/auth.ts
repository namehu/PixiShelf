import { authProcedure, router } from '@/server/trpc'

export const authRouter = router({
  me: authProcedure.query(async ({ ctx }) => {
    return {
      id: ctx.user.id,
      name: ctx.user.name,
      email: ctx.user.email
    }
  })
})
