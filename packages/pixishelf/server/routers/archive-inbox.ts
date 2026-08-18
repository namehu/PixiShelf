import { adminProcedure, authProcedure, router } from '@/server/trpc'
import {
  archiveIntakeListSchema,
  archiveIntakeManySchema,
  cancelArchiveIntakeMany,
  createArchiveIntakeSchema,
  createArchiveIntakeSubmission,
  getArchiveIntakeSummary,
  listArchiveIntakeItems,
  replaceArchiveIntakeItem,
  replaceArchiveIntakeSchema,
  retryArchiveIntakeMany,
  setArchiveIntakePaused
} from '@/services/archive-intake/archive-intake-service'
import {
  enqueueArchiveIntakeMany,
  enqueueArchiveIntakeManySchema
} from '@/services/archive-intake/archive-intake-enqueue-service'
import { runArchiveOperation } from './archive'

/**
 * 持久归档收件箱边界。读取沿用单信任域会话，所有状态变更保留显式管理员语义。
 */
export const archiveInboxRouter = router({
  create: adminProcedure
    .input(createArchiveIntakeSchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => createArchiveIntakeSubmission(input, ctx.userId))),

  replace: adminProcedure
    .input(replaceArchiveIntakeSchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => replaceArchiveIntakeItem(input, ctx.userId))),

  list: authProcedure
    .input(archiveIntakeListSchema)
    .query(({ input }) => runArchiveOperation(() => listArchiveIntakeItems(input))),

  summary: authProcedure.query(() => runArchiveOperation(() => getArchiveIntakeSummary())),

  pause: adminProcedure.mutation(({ ctx }) => runArchiveOperation(() => setArchiveIntakePaused(true, ctx.userId))),

  resume: adminProcedure.mutation(({ ctx }) => runArchiveOperation(() => setArchiveIntakePaused(false, ctx.userId))),

  cancelMany: adminProcedure
    .input(archiveIntakeManySchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => cancelArchiveIntakeMany(input, ctx.userId))),

  retryMany: adminProcedure
    .input(archiveIntakeManySchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => retryArchiveIntakeMany(input, ctx.userId))),

  enqueueMany: adminProcedure
    .input(enqueueArchiveIntakeManySchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => enqueueArchiveIntakeMany(input, ctx.userId)))
})
