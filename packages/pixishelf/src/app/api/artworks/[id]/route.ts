import { NextRequest, NextResponse } from 'next/server'
import { getArtworkById } from '@/services/artwork-service'
import logger from '@/lib/logger'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> } // Next.js 15+ params 是 Promise
) {
  // 1. 解析参数 (Controller 职责)
  const { id } = await params
  const artworkId = Number(id)

  // 2. 校验参数 (Controller 职责)
  if (!Number.isFinite(artworkId)) {
    return NextResponse.json({ error: 'Invalid artwork ID' }, { status: 400 })
  }

  try {
    // 3. 调用业务逻辑 (Service 职责)
    const data = await getArtworkById(artworkId)

    // 4. 处理业务结果 (Controller 职责)
    if (!data) {
      return NextResponse.json({ statusCode: 404, error: 'Not Found', message: 'Artwork not found' }, { status: 404 })
    }

    // 5. 返回成功响应
    return NextResponse.json(data)
  } catch (error) {
    // 6. 统一错误处理与日志 (Controller 职责)
    logger.error(`[API] Get Artwork Failed (id:${artworkId}):`, error)

    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
