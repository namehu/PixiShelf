import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api-response'
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
      return apiError('Invalid artworkId', { status: 400 })
    }

    if (!(file instanceof File)) {
      return apiError('Missing file', { status: 400 })
    }

    validateMediaChapterUploadRequest({
      artworkId,
      fileName: file.name,
      fileSize: file.size
    })

    const scanRoot = await getScanPath()
    if (!scanRoot) {
      return apiError('SCAN_PATH not set')
    }

    const meta = await uploadMediaChapterManifest({
      scanRoot,
      artworkId,
      imageId,
      videoPath: typeof videoPathValue === 'string' ? videoPathValue : '',
      manifestText: () => file.text()
    })

    return apiSuccess({ meta })
  } catch (error: any) {
    if (error instanceof MediaChapterUploadError) {
      return apiError(error.message, { status: error.status })
    }

    return apiError(error.message || 'Unknown error')
  }
}
