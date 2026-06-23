import { NextRequest } from 'next/server'
import { apiError, apiJson } from '@/lib/api-response'
import { getScanPath } from '@/services/setting.service'
import { getArtworkById } from '@/services/artwork-service'
import {
  handleImageReplaceSession,
  ImageReplaceActionType,
  ImageReplaceSessionError
} from '@/services/artwork-service/image-replace-session'

// API route 只负责参数/上下文/响应映射；init/commit/rollback 的三段业务注释保留在 service 中。

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
