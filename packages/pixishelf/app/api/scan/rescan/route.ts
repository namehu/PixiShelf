import { ApiError, apiHandler } from '@/lib/api-handler'
import { prisma } from '@/lib/prisma'
import { ScanRescanSchema } from '@/schemas/scan.dto'
import { runBackgroundTaskApi } from '@/services/background-task/api-error-mapping'
import { queuedSseResponse } from '@/services/background-task/queued-sse-response'
import { requireAdminRequest } from '@/services/background-task/request-auth'
import { enqueueCentralArtworkRescan } from '@/services/media-root-central-service'
import 'server-only'
/**
 * POST /api/scan/rescan
 * 按作品重扫：优先按本地目录作品来源走本地重扫，兜底按历史 Pixiv 引用重扫
 */
export const POST = apiHandler(
  ScanRescanSchema,
  async (req, data) => {
    const { artworkId, externalId } = data
    const { userId } = await requireAdminRequest(req)
    {
      const target = await prisma.artwork.findUnique({
        where: artworkId !== undefined ? { id: artworkId } : { externalId: externalId! },
        select: { id: true }
      })
      if (!target) throw new ApiError('Artwork not found', 404)
      const queued = await runBackgroundTaskApi(() =>
        enqueueCentralArtworkRescan({ artworkId: target.id, requestedByUserId: userId })
      )
      return queuedSseResponse(queued)
    }
  },
  { responseContract: 'canonical' }
)
