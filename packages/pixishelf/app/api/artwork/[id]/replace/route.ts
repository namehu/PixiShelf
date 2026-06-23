import { NextRequest, NextResponse } from 'next/server'
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
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
  }
  const scanRoot = await getScanPath()
  if (!scanRoot) return NextResponse.json({ error: 'No SCAN_ROOT' }, { status: 500 })

  const artwork = await getArtworkById(artworkId)
  if (!artwork) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const result = await handleImageReplaceSession({
      scanRoot,
      artworkId,
      artwork,
      action,
      readBody: () => req.json()
    })

    return NextResponse.json(result)
  } catch (error: any) {
    if (error instanceof ImageReplaceSessionError) {
      const payload =
        error.details === undefined ? { error: error.message } : { error: error.message, details: error.details }
      return NextResponse.json(payload, { status: error.status })
    }

    console.error('API Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
