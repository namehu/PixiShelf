import { z } from 'zod'

/**
 * Request body for scan stream
 */
export const ScanStreamSchema = z
  .object({
    type: z.enum(['full', 'list']).default('full'),
    force: z.boolean().optional().default(false),
    metadataList: z.array(z.string()).optional().default([])
  })
  .refine(
    (data) => {
      if (data.type === 'list' && data.metadataList.length === 0) {
        return false
      }
      return true
    },
    {
      message: 'metadataList is required for list scan',
      path: ['metadataList']
    }
  )

export type ScanStreamSchema = z.infer<typeof ScanStreamSchema>

/**
 * Request body for rescan stream
 */
export const ScanRescanSchema = z.object({
  artworkId: z.string()
})

export type ScanRescanSchema = z.infer<typeof ScanRescanSchema>
