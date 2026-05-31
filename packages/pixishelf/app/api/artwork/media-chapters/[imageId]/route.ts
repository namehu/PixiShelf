import { NextRequest, NextResponse } from 'next/server'
import { clearChaptersForImage } from '@/services/artwork-service/image-manager'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ imageId: string }> }) {
  try {
    const { imageId } = await params
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
