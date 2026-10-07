import { apiHandler } from '@/lib/api-handler'
import { ScanStreamSchema } from '@/schemas/scan.dto'
import { runBackgroundTaskApi } from '@/services/background-task/api-error-mapping'
import { queuedSseResponse } from '@/services/background-task/queued-sse-response'
import { requireAdminRequest } from '@/services/background-task/request-auth'
import { enqueueCentralScan } from '@/services/media-root-central-service'
import 'server-only'
/**
 * POST /api/scan/stream
 * 统一扫描流式入口，支持增量/全量/列表扫描
 */
export const POST = apiHandler(
  ScanStreamSchema,
  async (req, data) => {
    const { type, metadataList } = data
    const { userId } = await requireAdminRequest(req)
    {
      const queued = await runBackgroundTaskApi(() =>
        enqueueCentralScan({
          requestedByUserId: userId,
          type: type === 'list' ? 'list' : 'all',
          metadataList
        })
      )
      return queuedSseResponse(queued)
    }
  },
  { responseContract: 'canonical' }
)
