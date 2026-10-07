import { ApiError, apiHandler } from '@/lib/api-handler'
import { runBackgroundTaskApi } from '@/services/background-task/api-error-mapping'
import { queuedSseResponse } from '@/services/background-task/queued-sse-response'
import { requireAdminRequest } from '@/services/background-task/request-auth'
import { enqueueCentralMigration } from '@/services/media-root-central-service'
import { z } from 'zod'
// 定义 Schema，支持 targetIds
const MigrationSchema = z.object({
  targetIds: z.array(z.number()).optional(),
  batchSize: z.number().int().min(1).max(1000).optional(),
  concurrency: z.number().int().min(1).max(10).optional(),
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
  exactMatch: z.boolean().optional(),
  transferMode: z.enum(['move', 'copy']).optional(),
  verifyAfterCopy: z.boolean().optional(),
  cleanupSource: z.boolean().optional()
})
export const POST = apiHandler(MigrationSchema, async (req, data) => {
  const { targetIds, batchSize, concurrency } = data
  const { userId } = await requireAdminRequest(req)
  {
    if (batchSize !== undefined || concurrency !== undefined) {
      throw new ApiError('batchSize and concurrency overrides are not supported by the central dispatcher', 400)
    }
    const queued = await runBackgroundTaskApi(() =>
      enqueueCentralMigration({
        requestedByUserId: userId,
        selectionInput: {
          targetIds,
          filters: {
            id: data.id ?? null,
            search: data.search ?? null,
            artistName: data.artistName ?? null,
            startDate: data.startDate ?? null,
            endDate: data.endDate ?? null,
            externalId: data.externalId ?? null,
            mediaTypes: data.mediaTypes ?? null,
            exactMatch: data.exactMatch ?? false
          }
        },
        safety: {
          transferMode: data.transferMode,
          verifyAfterCopy: data.verifyAfterCopy,
          cleanupSource: data.cleanupSource
        }
      })
    )
    return queuedSseResponse(queued)
  }
})
