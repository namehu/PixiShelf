import { initTRPC, TRPCError } from '@trpc/server'
import { type Context } from './context'

// Avoid exporting the entire t-object
// since it's not very descriptive.
// For instance, the use of a t variable
// is common in i18n libraries.
const t = initTRPC.context<Context>().create()

// Base router and procedure helpers
export const router = t.router

/**
 * 公共过程
 */
export const publicProcedure = t.procedure

/**
 *受保护的过程
 */
export const authProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session || !ctx.session.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return next({
    ctx: {
      session: ctx.session,
      userId: Number(ctx.session.userId)
    }
  })
})
