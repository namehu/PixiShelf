import { z } from 'zod'
import { workerHealthDtoSchema } from './dtos.ts'

export const adminRealtimeResourceSchema = z.enum(['archiveInbox', 'jobDashboard'])
export type AdminRealtimeResource = z.infer<typeof adminRealtimeResourceSchema>

export const adminInvalidationSchema = z.object({
  version: z.literal(1),
  resources: z.array(adminRealtimeResourceSchema).min(1).max(2)
})
export type AdminInvalidation = z.infer<typeof adminInvalidationSchema>

export const workerSnapshotSchema = z.object({
  version: z.literal(1),
  sampledAt: z.iso.datetime(),
  workers: z.array(workerHealthDtoSchema)
})
export type WorkerSnapshot = z.infer<typeof workerSnapshotSchema>
