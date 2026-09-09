import { z } from 'zod'
import { creatorMaintenanceInputSchema } from '@pixishelf/job-contracts'
import { adminProcedure, router } from '@/server/trpc'
import {
  getCreatorMapping,
  getCreatorMaintenance,
  listCreatorMaintenance,
  listCreatorMappings,
  prepareCreatorMaintenance,
  startCreatorMaintenance
} from '@/services/creator-maintenance-service'

export const creatorRouter = router({
  prepare: adminProcedure
    .input(creatorMaintenanceInputSchema)
    .mutation(({ input, ctx }) => prepareCreatorMaintenance(ctx.userId, input)),
  start: adminProcedure
    .input(z.object({ planId: z.string().min(1).max(128), fingerprint: z.string().length(64) }))
    .mutation(({ input, ctx }) => startCreatorMaintenance(ctx.userId, input.planId, input.fingerprint)),
  status: adminProcedure
    .input(z.object({ planId: z.string().min(1).max(128), afterId: z.number().int().nonnegative().default(0) }))
    .query(({ input }) => getCreatorMaintenance(input.planId, input.afterId)),
  mapping: adminProcedure
    .input(z.object({ id: z.string().min(1).max(128) }))
    .query(({ input }) => getCreatorMapping(input.id)),
  history: adminProcedure.query(() => listCreatorMaintenance()),
  mappings: adminProcedure
    .input(z.object({ search: z.string().max(200).default(''), cursor: z.string().max(128).optional() }))
    .query(({ input }) => listCreatorMappings(input.search, input.cursor))
})
