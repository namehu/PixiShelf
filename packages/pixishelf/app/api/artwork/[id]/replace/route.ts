import { NextRequest } from 'next/server'
import { apiError, apiJson } from '@/lib/api-response'
import { ApiError } from '@/lib/api-handler'
import { getScanPath } from '@/services/setting.service'
import { getArtworkById } from '@/services/artwork-service'
import { requireAdminRequest } from '@/services/background-task/request-auth'
import {
  handleImageReplaceSession,
  ImageReplaceActionType,
  ImageReplaceSessionError
} from '@/services/artwork-service/image-replace-session'

// API 路由只负责参数、上下文和响应映射；初始化、提交、回滚三段业务注释保留在服务层中。

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminRequest(req)
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
  const scanRoot = await getScanPath()
  if (!scanRoot) return apiError('No SCAN_ROOT')

  const artwork = await getArtworkById(artworkId)
  if (!artwork) return apiError('Not found', { status: 404 })

  try {
    const result = await handleImageReplaceSession({
      scanRoot,
      artworkId,
      artwork,
      action,
      readBody: () => req.json()
    })

    return apiJson(result)
  } catch (error: any) {
    if (error instanceof ImageReplaceSessionError) {
      return apiError(error.message, { status: error.status, details: error.details })
    }

    console.error('API Error:', error)
    return apiError(error.message)
  }
}
