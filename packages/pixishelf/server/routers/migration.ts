import { z } from 'zod'
import { adminProcedure, authProcedure, router } from '@/server/trpc'
import { TRPCError } from '@trpc/server'
import { precheckMigration } from '@/services/migration-service'
import * as JobService from '@/services/job-service'
import { isCentralDispatcherCutoverEnabled } from '@/services/background-task/dispatcher-cutover'
import {
  cancelJobCommand,
  pauseJobCommand,
  resumeJobCommand,
  retryJobCommand
} from '@/services/background-task/job-command-service'
import { BackgroundTaskError } from '@/services/background-task/background-task-error'
import { JOB_DEFINITION_VERSION, parseJobPayload } from '@pixishelf/job-contracts'

const MigrationPrecheckSchema = z.object({
  targetIds: z.array(z.number()).optional(),
  id: z.number().int().positive().nullish().optional(),
  search: z.string().nullish().optional(),
  artistName: z.string().nullish().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullish(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullish(),
  externalId: z.string().nullish().optional(),
  mediaTypes: z.string().nullish().optional(),
  exactMatch: z.boolean().optional()
})

const MigrationControlSchema = z.object({
  action: z.enum(['pause', 'resume', 'cancel', 'retry']),
  jobId: z.string().optional()
})

const MigrationFailedSchema = z.object({
  jobId: z.string().optional()
})

export const migrationRouter = router({
  /**
   * 预检查路由不会执行迁移，仅返回会影响筛选范围的候选数据（含默认值规范化）。
   */
  precheck: authProcedure.input(MigrationPrecheckSchema).query(async ({ input }) => {
    return precheckMigration({
      targetIds: input.targetIds,
      filters: {
        id: input.id ?? null,
        search: input.search ?? null,
        artistName: input.artistName ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        externalId: input.externalId ?? null,
        mediaTypes: input.mediaTypes ?? null,
        exactMatch: input.exactMatch ?? false
      }
    })
  }),
  /**
   * 控制路由用于对当前活跃迁移执行 pause / resume / cancel。
   * 若未显式传入 jobId，则默认操作最近一条活跃任务；找不到任务时返回 404。
   */
  control: adminProcedure.input(MigrationControlSchema).mutation(async ({ input, ctx }) => {
    const job = input.jobId ? await JobService.getJob(input.jobId) : await JobService.getActiveMigrationJob()
    if (!job) {
      throw new TRPCError({ code: 'NOT_FOUND', message: '没有可控制的迁移任务' })
    }

    if (isCentralDispatcherCutoverEnabled()) {
      if (job.type !== 'MIGRATION') {
        throw new TRPCError({ code: 'NOT_FOUND', message: '指定任务不是迁移任务' })
      }
      if (job.definitionVersion !== JOB_DEFINITION_VERSION) {
        throw new TRPCError({ code: 'CONFLICT', message: '迁移任务定义版本不受支持' })
      }
      try {
        parseJobPayload('MIGRATION', job.payload ?? {})
      } catch {
        throw new TRPCError({ code: 'CONFLICT', message: '迁移任务载荷无效' })
      }
      try {
        const updated =
          input.action === 'pause'
            ? await pauseJobCommand({ jobId: job.id })
            : input.action === 'resume'
              ? await resumeJobCommand({ jobId: job.id })
              : input.action === 'retry'
                ? await retryJobCommand({ jobId: job.id, requestedByUserId: ctx.userId })
                : await cancelJobCommand({ jobId: job.id })
        return { jobId: updated.id, status: updated.status }
      } catch (error) {
        if (error instanceof BackgroundTaskError) {
          throw new TRPCError({
            code: error.code === 'JOB_NOT_FOUND' ? 'NOT_FOUND' : 'CONFLICT',
            message: error.message
          })
        }
        throw error
      }
    }

    if (input.action === 'pause') {
      await JobService.pauseJob(job.id)
    } else if (input.action === 'resume') {
      await JobService.resumeJob(job.id)
    } else if (input.action === 'retry') {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Retry requires the central dispatcher' })
    } else {
      await JobService.cancelJob(job.id)
    }

    const latest = await JobService.getJob(job.id)
    return { jobId: job.id, status: latest?.status }
  }),
  /**
   * 查询迁移失败项：若目标 job 不存在或未写入 result 则返回空列表，避免 500 中断前端展示。
   */
  failed: authProcedure.input(MigrationFailedSchema).query(async ({ input }) => {
    const job = input.jobId ? await JobService.getJob(input.jobId) : await JobService.getLatestMigrationJob()
    if (!job || !job.result) {
      return { jobId: job?.id ?? null, items: [] }
    }

    const result = job.result as { failedItems?: any[] }
    return { jobId: job.id, items: result.failedItems ?? [] }
  })
})
