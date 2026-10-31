import { z } from 'zod'
import { ApiError } from '@/lib/api-handler'
import { VideoPlaybackUnavailable } from '@pixishelf/job-executors/media-content'
import { requireAdminRequest } from '@/services/background-task/request-auth'
import { openVideoPlayback, videoPlaybackHeaders } from '@/services/video-playback-service'

export const dynamic = 'force-dynamic'
const variantSchema = z.union([
  z.object({ generation: z.string().uuid() }).strict(),
  z.object({ original: z.string().regex(/^[a-f0-9]{24}$/) }).strict()
])
export async function GET(request: Request, context: { params: Promise<{ 'image-id': string }> }) {
  try {
    await requireAdminRequest(request)
    const id = z.coerce
      .number()
      .int()
      .positive()
      .parse((await context.params)['image-id'])
    const variant = variantSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    return await openVideoPlayback(id, variant, request.headers.get('range'), request.signal)
  } catch (error) {
    const status =
      error instanceof ApiError
        ? error.statusCode
        : error instanceof z.ZodError
          ? 400
          : error instanceof VideoPlaybackUnavailable
            ? error.reason === 'MISSING'
              ? 404
              : 409
            : 500
    return Response.json(
      {
        error: error instanceof VideoPlaybackUnavailable ? error.message : status === 401 ? '请先登录' : '无法读取视频'
      },
      { status, headers: videoPlaybackHeaders }
    )
  }
}
