import { z } from 'zod'
import { ApiError } from '@/lib/api-handler'
import { requireAdminRequest } from '@/services/background-task/request-auth'
import { getVideoPlaybackSource, videoPlaybackHeaders } from '@/services/video-playback-service'

export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ 'image-id': string }> }) {
  try {
    await requireAdminRequest(request)
    const id = z.coerce
      .number()
      .int()
      .positive()
      .parse((await context.params)['image-id'])
    return Response.json(await getVideoPlaybackSource(id), { headers: videoPlaybackHeaders })
  } catch (error) {
    const status = error instanceof ApiError ? error.statusCode : error instanceof z.ZodError ? 400 : 500
    return Response.json(
      { error: status === 401 ? '请先登录' : '无法读取视频播放源' },
      { status, headers: videoPlaybackHeaders }
    )
  }
}
