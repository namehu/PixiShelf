import { z } from 'zod'
import { authProcedure, router } from '@/server/trpc'
import { TRPCError } from '@trpc/server'
import { precheckMigration } from '@/services/migration-service'
import * as JobService from '@/services/job-service'

const MigrationPrecheckSchema = z.object({
  targetIds: z.array(z.number()).optional(),
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
  exactMatch: z.boolean().optional()
})

const MigrationControlSchema = z.object({
  action: z.enum(['pause', 'resume', 'cancel']),
  jobId: z.string().optional()
})

const MigrationFailedSchema = z.object({
  jobId: z.string().optional()
})

export const migrationRouter = router({
  precheck: authProcedure.input(MigrationPrecheckSchema).query(async ({ input }) => {
    return precheckMigration({
      targetIds: input.targetIds,
      filters: {
        search: input.search ?? null,
        artistName: input.artistName ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        externalId: input.externalId ?? null,
        exactMatch: input.exactMatch ?? false
      }
    })
  }),
  control: authProcedure.input(MigrationControlSchema).mutation(async ({ input }) => {
    const job = input.jobId ? await JobService.getJob(input.jobId) : await JobService.getActiveMigrationJob()
    if (!job) {
      throw new TRPCError({ code: 'NOT_FOUND', message: '没有可控制的迁移任务' })
    }

    if (input.action === 'pause') {
      await JobService.pauseJob(job.id)
    } else if (input.action === 'resume') {
      await JobService.resumeJob(job.id)
    } else {
      await JobService.cancelJob(job.id)
    }

    const latest = await JobService.getJob(job.id)
    return { jobId: job.id, status: latest?.status }
  }),
  failed: authProcedure.input(MigrationFailedSchema).query(async ({ input }) => {
    const job = input.jobId ? await JobService.getJob(input.jobId) : await JobService.getLatestMigrationJob()
    if (!job || !job.result) {
      return { jobId: job?.id ?? null, items: [] }
    }

    const result = job.result as { failedItems?: any[] }
    return { jobId: job.id, items: result.failedItems ?? [] }
  })
})
