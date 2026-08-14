import { initTRPC, TRPCError } from '@trpc/server'
import { type Context } from './context'
import { rateLimiter } from '@/lib/rate-limit'

// 不要导出完整的 t 对象（含义不直观）。
// 例如，很多 i18n 库都把“t”作为通用变量名，语义会冲突。
const t = initTRPC.context<Context>().create()

// 基础的 router/procedure 入口
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

/**
 * 管理面过程边界。
 *
 * PixiShelf 当前是单用户部署，已登录用户即是实例管理员；单独导出此过程，
 * 让后台任务等敏感接口不会散落使用普通认证入口，也便于未来在这里集中增加角色校验。
 */
export const adminProcedure = authProcedure
