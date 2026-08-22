import { z } from 'zod'
import { relativePathSchema, sha256DigestSchema } from './payloads.ts'

const boundedEvidenceIdSchema = z.string().trim().min(1).max(255)
const nonnegativeBigIntSchema = z.bigint().nonnegative()

export const auditApplyInputEvidenceSchema = z
  .object({
    ordinal: z.number().int().nonnegative(),
    sourceAuditItemId: z.string().trim().min(1).max(128),
    auditDifferenceKind: z.enum(['NEW', 'CHANGED']),
    relativePath: relativePathSchema,
    expectedExternalId: boundedEvidenceIdSchema,
    observedExternalId: boundedEvidenceIdSchema,
    expectedInventoryId: boundedEvidenceIdSchema.nullable(),
    expectedExternalRefId: boundedEvidenceIdSchema.nullable(),
    expectedArtworkId: z.number().int().positive().nullable(),
    observedContentHash: sha256DigestSchema,
    processedContentHash: sha256DigestSchema.nullable(),
    sizeBytes: nonnegativeBigIntSchema,
    mtimeMs: nonnegativeBigIntSchema,
    ctimeMs: nonnegativeBigIntSchema.nullable(),
    deviceId: nonnegativeBigIntSchema.nullable(),
    inode: nonnegativeBigIntSchema.nullable()
  })
  .strict()

export type AuditApplyInputEvidence = z.infer<typeof auditApplyInputEvidenceSchema>

const AUDIT_APPLY_INPUT_DOMAIN = 'pixishelf:audit-apply-inputs:v1'

/**
 * Produces the shared, deterministic preimage used by the App producer and Worker.
 * Hashing remains in their Node-only boundaries so this contract package stays runtime-neutral.
 */
export function canonicalizeAuditApplyInputs(auditRunId: string, rows: readonly AuditApplyInputEvidence[]): string {
  const parsedAuditRunId = z.string().trim().min(1).max(128).parse(auditRunId)
  const parsedRows = z.array(auditApplyInputEvidenceSchema).min(1).max(10_000).parse(rows)
  const sortedRows = [...parsedRows].sort((left, right) => left.ordinal - right.ordinal)
  const ordinals = new Set<number>()
  const auditItemIds = new Set<string>()
  for (const row of sortedRows) {
    if (ordinals.has(row.ordinal)) throw new Error('Expected unique audit apply input ordinals')
    if (auditItemIds.has(row.sourceAuditItemId)) throw new Error('Expected unique audit apply source item ids')
    ordinals.add(row.ordinal)
    auditItemIds.add(row.sourceAuditItemId)
  }
  if (sortedRows.some((row, index) => row.ordinal !== index)) {
    throw new Error('Expected contiguous audit apply input ordinals')
  }

  return JSON.stringify([
    AUDIT_APPLY_INPUT_DOMAIN,
    parsedAuditRunId,
    sortedRows.map((row) => [
      row.ordinal,
      row.sourceAuditItemId,
      row.auditDifferenceKind,
      row.relativePath,
      row.expectedExternalId,
      row.observedExternalId,
      row.expectedInventoryId,
      row.expectedExternalRefId,
      row.expectedArtworkId,
      row.observedContentHash,
      row.processedContentHash,
      row.sizeBytes.toString(10),
      row.mtimeMs.toString(10),
      row.ctimeMs?.toString(10) ?? null,
      row.deviceId?.toString(10) ?? null,
      row.inode?.toString(10) ?? null
    ])
  ])
}
