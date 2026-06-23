import { NextRequest, NextResponse } from 'next/server'
import { getScanPath } from '@/services/setting.service'
import {
  MediaChapterUploadError,
  uploadMediaChapterManifest,
  validateMediaChapterUploadRequest
} from '@/services/artwork-service/media-chapter-upload'

export async function POST(_req: NextRequest) {
  try {
    const formData = await _req.formData()
    const artworkId = Number(formData.get('artworkId'))
    const imageIdValue = formData.get('imageId')
    const imageId = imageIdValue ? Number(imageIdValue) : null
    const videoPathValue = formData.get('videoPath')
    const file = formData.get('file')

    if (!artworkId || Number.isNaN(artworkId)) {
      return NextResponse.json({ error: 'Invalid artworkId' }, { status: 400 })
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 })
    }

    validateMediaChapterUploadRequest({
      artworkId,
      fileName: file.name,
      fileSize: file.size
    })

    const scanRoot = await getScanPath()
    if (!scanRoot) {
      return NextResponse.json({ error: 'SCAN_PATH not set' }, { status: 500 })
    }

    const meta = await uploadMediaChapterManifest({
      scanRoot,
      artworkId,
      imageId,
      videoPath: typeof videoPathValue === 'string' ? videoPathValue : '',
      manifestText: () => file.text()
    })

    return NextResponse.json({
      success: true,
      meta
    })
  } catch (error: any) {
    if (error instanceof MediaChapterUploadError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 })
  }
}
