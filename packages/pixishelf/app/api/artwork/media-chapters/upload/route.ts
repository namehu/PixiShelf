import { z } from 'zod'
import { ContentWriteAuthorizationSchema } from '@/schemas/media-content.dto'
import logger from '@/lib/logger'
import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api-response'
import { ApiError } from '@/lib/api-handler'
import { getScanPath } from '@/services/setting.service'
import { requireAdminRequest } from '@/services/background-task/request-auth'
import {
  MediaChapterUploadError,
  uploadMediaChapterManifest,
  validateMediaChapterUploadRequest
} from '@/services/artwork-service/media-chapter-upload'

export async function POST(_req: NextRequest) {
  let userId: string
  try {
    userId = (await requireAdminRequest(_req)).userId
  } catch (error) {
    if (error instanceof ApiError) return apiError(error.message, { status: error.statusCode })
    throw error
  }

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

    const authValue = formData.get('authorization')
    const authorization =
      typeof authValue === 'string' ? ContentWriteAuthorizationSchema.parse(JSON.parse(authValue)) : undefined
    const upload = z
      .object({
        uploadSessionId: z.string().uuid(),
        uploadToken: z.string().uuid(),
        uploadRequestId: z.string().uuid(),
        uploadAuthorization: ContentWriteAuthorizationSchema.optional()
      })
      .parse({
        uploadSessionId: formData.get('uploadSessionId'),
        uploadToken: formData.get('uploadToken'),
        uploadRequestId: formData.get('uploadRequestId'),
        uploadAuthorization:
          typeof formData.get('uploadAuthorization') === 'string'
            ? JSON.parse(String(formData.get('uploadAuthorization')))
            : undefined
      })
    const meta = await uploadMediaChapterManifest({
      ...upload,
      userId,
      expectedUserId: String(formData.get('expectedUserId') ?? ''),
      authorization,
      scanRoot,
      artworkId,
      imageId,
      videoPath: typeof videoPathValue === 'string' ? videoPathValue : '',
      manifestText: () => file.text()
    })

    return apiSuccess({ meta })
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return apiError('Invalid upload session', { status: 400 })
    }
    if (error instanceof MediaChapterUploadError) {
      return apiError(error.message, { status: error.status })
    }

    if (error instanceof Error && 'status' in error && error.status === 409) {
      return apiError(error.message, { status: 409 })
    }
    logger.error('Media chapter upload failed', { error })
    return apiError('Internal Server Error')
  }
}
