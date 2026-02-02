'use server'

import { authActionClient } from '@/lib/safe-action'
import { BatchCreateArtworkSchema, BatchRegisterImageSchema } from '@/schemas/artwork.dto'
import { batchCreateArtworksService, batchRegisterImagesService } from '@/services/batch-import-service'
import { revalidatePath } from 'next/cache'

/**
 * 批量创建作品
 */
export const batchCreateArtworksAction = authActionClient
  .inputSchema(BatchCreateArtworkSchema)
  .action(async ({ parsedInput }) => {
    const results = await batchCreateArtworksService(parsedInput)
    revalidatePath('/admin/artworks')
    return results
  })

/**
 * 批量注册图片
 */
export const batchRegisterImagesAction = authActionClient
  .inputSchema(BatchRegisterImageSchema)
  .action(async ({ parsedInput }) => {
    const result = await batchRegisterImagesService(parsedInput)
    revalidatePath('/admin/artworks')
    return result
  })
