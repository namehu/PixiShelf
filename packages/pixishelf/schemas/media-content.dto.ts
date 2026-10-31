import { z } from 'zod'
import { ContentWriteAuthorizationSchema } from '@pixishelf/job-contracts'
export { ContentWriteAuthorizationSchema, type ContentWriteAuthorization } from '@pixishelf/job-contracts'
const decimal = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(20)
export const ContentChunkReceiptSchema = z.object({
  requestId: z.string().uuid(),
  chunkIndex: z.number().int().nonnegative(),
  offset: decimal,
  byteLength: decimal,
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
})
export const MediaUploadReceiptSchema = z.object({
  authorization: ContentWriteAuthorizationSchema,
  receipt: ContentChunkReceiptSchema,
  expectedUserId: z.string().min(1).max(200)
})
export type MediaUploadReceipt = z.infer<typeof MediaUploadReceiptSchema>
