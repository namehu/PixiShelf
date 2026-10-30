import { TRPCError } from '@trpc/server'
import { authProcedure, router } from '@/server/trpc'
import {
  quickFilterAccountSchema,
  quickFilterCreateSchema,
  quickFilterUpdateSchema,
  quickFilterDeleteSchema,
  quickFilterSetNavigationSchema
} from '@/schemas/artwork-quick-filter.dto'
import {
  listQuickFilters,
  createQuickFilter,
  updateQuickFilter,
  deleteQuickFilter,
  setQuickFilterNavigation
} from '@/services/artwork-quick-filter-service'
const accountProcedure = authProcedure.input(quickFilterAccountSchema).use(({ ctx, input, next }) => {
  if (ctx.userId !== input.expectedUserId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '账户已切换，请重新打开快捷筛选' })
  }
  return next()
})
export const artworkQuickFilterRouter = router({
  list: accountProcedure.query(({ ctx, input }) => listQuickFilters(ctx.userId, input.scope)),
  create: accountProcedure
    .input(quickFilterCreateSchema)
    .mutation(({ ctx, input }) => createQuickFilter(ctx.userId, input)),
  update: accountProcedure
    .input(quickFilterUpdateSchema)
    .mutation(({ ctx, input }) => updateQuickFilter(ctx.userId, input)),
  delete: accountProcedure
    .input(quickFilterDeleteSchema)
    .mutation(({ ctx, input }) => deleteQuickFilter(ctx.userId, input)),
  setNavigation: accountProcedure
    .input(quickFilterSetNavigationSchema)
    .mutation(({ ctx, input }) => setQuickFilterNavigation(ctx.userId, input.navigation, input.scope))
})
