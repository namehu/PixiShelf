import { z } from 'zod'
import { ContentWriteAuthorizationSchema } from '@/schemas/media-content.dto'
import logger from '@/lib/logger'
import { NextRequest } from 'next/server'
import { apiError, apiJson } from '@/lib/api-response'
import { ApiError } from '@/lib/api-handler'
import { getScanPath } from '@/services/setting.service'
import { getArtworkById } from '@/services/artwork-service'
import { ensureManualArtworkStorage } from '@/services/artwork-service/manual-storage'
import { requireAdminRequest } from '@/services/background-task/request-auth'
import {
  handleImageReplaceSession,
  ImageReplaceActionType,
  ImageReplaceSessionError
} from '@/services/artwork-service/image-replace-session'

// API 路由只负责参数、上下文和响应映射；初始化、提交、回滚三段业务注释保留在服务层中。

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string
  try {
    userId = (await requireAdminRequest(req)).userId
  } catch (error) {
    if (error instanceof ApiError) return apiError(error.message, { status: error.statusCode })
    throw error
  }

  const { id } = await params
  const artworkId = Number(id)
  const searchParams = req.nextUrl.searchParams
  const action = (searchParams.get('action') as ImageReplaceActionType) || 'init'

  // 1. 基础校验
  if (!artworkId || isNaN(artworkId)) {
    return apiError('Invalid ID', { status: 400 })
  }
  try {
    const protocol = z
      .object({
        sessionId: z.string().uuid(),
        writeToken: z.string().uuid(),
        expectedUserId: z.string().min(1),
        authorization: ContentWriteAuthorizationSchema.optional()
      })
      .parse({
        sessionId: req.headers.get('x-replace-session-id'),
        writeToken: req.headers.get('x-replace-token'),
        expectedUserId: req.headers.get('x-expected-user-id'),
        authorization: req.headers.get('x-replace-authorization')
          ? JSON.parse(req.headers.get('x-replace-authorization')!)
          : undefined
      })
    if (protocol.expectedUserId !== userId) return apiError('Account changed', { status: 409 })
    const scanRoot = await getScanPath()
    if (!scanRoot) return apiError('No SCAN_ROOT')
    if (action === 'init') await ensureManualArtworkStorage(artworkId)
    const artwork = await getArtworkById(artworkId)
    if (!artwork) return apiError('Not found', { status: 404 })
    const result = await handleImageReplaceSession({
      ...protocol,
      userId,
      scanRoot,
      artworkId,
      artwork,
      action,
      readBody: () => req.json()
    })

    return apiJson(result)
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return apiError('Invalid replacement session', { status: 400 })
    }
    if (error instanceof ImageReplaceSessionError) {
      return apiError(error.message, { status: error.status, details: error.details })
    }

    if (error instanceof Error && 'status' in error && error.status === 409) {
      return apiError(error.message, { status: 409 })
    }
    logger.error('Media replacement failed', { error })
    return apiError('Internal Server Error')
  }
}
