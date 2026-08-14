import { z } from 'zod'

/**
 * 扫描流请求体
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
 * 请求体：重新扫描指定作品
 */
export const ScanRescanSchema = z
  .object({
    artworkId: z.number().int().positive().optional(),
    externalId: z.string().min(1).optional()
  })
  .refine((value) => value.artworkId !== undefined || value.externalId !== undefined, {
    message: 'artworkId or externalId is required'
  })

export type ScanRescanSchema = z.infer<typeof ScanRescanSchema>
