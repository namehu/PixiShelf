import { NextResponse } from 'next/server'
import logger from '@/lib/logger'
import { getVideoChapterManifestByImageId } from '@/services/artwork-service/video-chapters'

/**
 * 视频章节业务接口
 * GET /api/v1/media/:imageId/chapters
 */
export async function GET(_request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  try {
    const { imageId } = await params
    const parsedImageId = Number(imageId)

    if (!Number.isInteger(parsedImageId) || parsedImageId <= 0) {
      return NextResponse.json({ error: 'Invalid imageId' }, { status: 400 })
    }

    const manifest = await getVideoChapterManifestByImageId(parsedImageId)
    if (!manifest) {
      return NextResponse.json({ error: 'Chapter manifest not found' }, { status: 404 })
    }

    return NextResponse.json(manifest)
  } catch (error: any) {
    if (error?.message === 'Image not found') {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 })
    }

    if (error?.message === 'Image is not a video') {
      return NextResponse.json({ error: 'Image is not a video' }, { status: 400 })
    }

    logger.error('Failed to get video chapters:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
