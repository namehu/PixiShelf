import logger from '@/lib/logger'
import { MediaDeleteInputSchema } from '@/schemas/artwork-delete.dto'
import { NextRequest, NextResponse } from 'next/server'
import { ApiError } from '@/lib/api-handler'
import { requireAdminRequest } from '@/services/background-task/request-auth'
import { clearChaptersForImage } from '@/services/artwork-service/image-manager'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ 'image-id': string }> }) {
  let userId: string
  try {
    userId = (await requireAdminRequest(req)).userId
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    throw error
  }

  try {
    const { 'image-id': imageId } = await params
    const parsedImageId = Number(imageId)
    const body = await req.json().catch(() => ({}))
    const parsed = MediaDeleteInputSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid deletion confirmation' }, { status: 400 })

    if (!Number.isInteger(parsedImageId) || parsedImageId <= 0) {
      return NextResponse.json({ error: 'Invalid imageId' }, { status: 400 })
    }

    await clearChaptersForImage({
      userId,
      imageId: parsedImageId,
      ...parsed.data
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'Image not found') {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 })
    }

    if (error instanceof Error && 'status' in error && error.status === 409) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    logger.error('Media chapter deletion failed', { error })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
