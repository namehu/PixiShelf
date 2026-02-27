import { initTRPC, TRPCError } from '@trpc/server'
import { type Context } from './context'
import { rateLimiter } from '@/lib/rate-limit'

// Avoid exporting the entire t-object
// since it's not very descriptive.
// For instance, the use of a t variable
// is common in i18n libraries.
const t = initTRPC.context<Context>().create()

// Base router and procedure helpers
export const router = t.router

const rateLimitMiddleware = t.middleware(({ ctx, next }) => {
  const ip = ctx.headers.get('x-forwarded-for') || 'unknown'
  const isAllowed = rateLimiter.check(300, `trpc:${ip}`) // 300 requests per minute

  if (!isAllowed) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Rate limit exceeded'
    })
  }
  return next()
})

/**
 * 公共过程
 */
export const publicProcedure = t.procedure.use(rateLimitMiddleware)

/**
 *受保护的过程
 */
export const authProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.session || !ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return next({
    ctx: {
      session: ctx.session,
      user: ctx.user,
      userId: ctx.user.id
    }
  })
})
