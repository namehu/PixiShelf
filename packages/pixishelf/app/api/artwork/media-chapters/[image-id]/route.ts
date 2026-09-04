import { NextRequest, NextResponse } from 'next/server'
import { ApiError } from '@/lib/api-handler'
import { requireAdminRequest } from '@/services/background-task/request-auth'
import { clearChaptersForImage } from '@/services/artwork-service/image-manager'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ 'image-id': string }> }) {
  try {
    await requireAdminRequest(req)
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
    const deleteFile = Boolean(body?.deleteFile)

    if (!Number.isInteger(parsedImageId) || parsedImageId <= 0) {
      return NextResponse.json({ error: 'Invalid imageId' }, { status: 400 })
    }

    await clearChaptersForImage({
      imageId: parsedImageId,
      deleteFile
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error?.message === 'Image not found') {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 })
    }

    return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 })
  }
}
