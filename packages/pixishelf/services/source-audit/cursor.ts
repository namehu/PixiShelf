import { z } from 'zod'

const cursorPayloadSchema = z
  .object({
    version: z.literal(1),
    auditRunId: z.string().min(1).max(128),
    classification: z.enum(['NEW', 'CHANGED', 'MISSING', 'INVALID', 'IDENTITY_CONFLICT']).nullable(),
    ordinal: z.number().int().nonnegative(),
    id: z.string().min(1).max(128)
  })
  .strict()

export type SourceAuditCursor = z.infer<typeof cursorPayloadSchema>

export function encodeSourceAuditCursor(cursor: SourceAuditCursor): string {
  return Buffer.from(JSON.stringify(cursorPayloadSchema.parse(cursor)), 'utf8').toString('base64url')
}

export function decodeSourceAuditCursor(value: string): SourceAuditCursor {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid source audit cursor')
  try {
    return cursorPayloadSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
  } catch {
    throw new Error('Invalid source audit cursor')
  }
}
