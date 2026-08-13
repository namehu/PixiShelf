import { NextResponse } from 'next/server'
import logger from '@/lib/logger'
import { getPlayableVideoKeyframesByImageId } from '@/services/video-keyframe-read-service'

/**
 * C-end video picture navigation.
 * GET /api/v1/media/:imageId/keyframes
 */
export async function GET(_request: Request, { params }: { params: Promise<{ 'image-id': string }> }) {
  try {
    const { 'image-id': imageId } = await params
    const parsedImageId = Number(imageId)

    if (!Number.isInteger(parsedImageId) || parsedImageId <= 0) {
      return NextResponse.json({ error: 'Invalid imageId' }, { status: 400 })
    }

    const manifest = await getPlayableVideoKeyframesByImageId(parsedImageId)
    if (!manifest) {
      return NextResponse.json({ error: 'Video keyframes not found' }, { status: 404 })
    }

    return NextResponse.json(manifest, {
      headers: { 'Cache-Control': 'private, no-cache' }
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Image not found') {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 })
    }
    if (error instanceof Error && error.message === 'Image is not a video') {
      return NextResponse.json({ error: 'Image is not a video' }, { status: 400 })
    }

    logger.error('Failed to get playable video keyframes:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
