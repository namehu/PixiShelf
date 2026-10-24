import { z } from 'zod'

const decimal = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(20)
export const ContentWriteAuthorizationSchema = z.object({
  sessionId: z.string().uuid(),
  handle: z.object({
    writeId: z.string().min(1).max(100),
    directoryId: z.string().min(1).max(100),
    writeToken: z.string().uuid(),
    declarationVersion: decimal,
    scope: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('PATH'), relativePath: z.string().min(1).max(4096) }),
      z.object({ kind: z.literal('DIRECTORY') })
    ]),
    parentWriteId: z.string().max(100).nullable()
  })
})
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
export type ContentWriteAuthorization = z.infer<typeof ContentWriteAuthorizationSchema>
export type MediaUploadReceipt = z.infer<typeof MediaUploadReceiptSchema>
