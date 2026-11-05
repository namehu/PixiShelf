import { z } from 'zod'

/** Classification rules are versioned independently of the saved evidence format. */
export const ARCHIVE_QUALITY_DEFINITION_VERSION = 3 as const
export const ARCHIVE_QUALITY_AUDIT_JOB_TYPE = 'ARCHIVE_QUALITY_AUDIT' as const
export const archivePageQualitySchema = z.enum(['ORIGINAL', 'DISPLAY', 'UNKNOWN'])
export const archiveQualityStatusSchema = z.enum(['ORIGINAL', 'DISPLAY', 'MIXED', 'UNKNOWN'])
const archiveOriginalClaimSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mimeType: z.string().optional(),
  minBytes: z.number().int().positive(),
  maxBytes: z.number().int().positive()
})
const archiveSourceOriginalClaimSchema = archiveOriginalClaimSchema.refine((claim) => claim.minBytes <= claim.maxBytes)
export const archivePageQualityEvidenceSchema = z.object({
  imageId: z.number().int().positive(),
  index: z.number().int().nonnegative(),
  path: z.string().min(1),
  size: z.string().regex(/^\d+$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourcePageUrl: z.string().nullable(),
  quality: archivePageQualitySchema,
  reason: z.string().min(1),
  evidence: z
    .object({
      archiveImportId: z.string().optional(),
      attempt: z.number().int().positive().optional(),
      downloadUrl: z.string().optional(),
      actualSha1: z.string().optional(),
      originalResponse: z.boolean().optional(),
      responseMimeType: z.string().nullable().optional(),
      originalClaim: archiveOriginalClaimSchema.optional(),
      sourceOriginalClaim: archiveSourceOriginalClaimSchema.optional(),
      inheritedFromRevisionId: z.string().optional()
    })
    .optional()
})
export const archiveDeliveryEvidenceSchema = z.object({
  version: z.literal(1),
  quality: archivePageQualitySchema,
  reason: z.string(),
  sha256: z.string(),
  byteCount: z.string(),
  attempt: z.number().int().positive(),
  downloadUrl: z.string(),
  originalResponse: z.boolean().optional(),
  responseMimeType: z.string().nullable().optional(),
  actualSha1: z.string().optional(),
  originalClaim: archiveOriginalClaimSchema.optional(),
  sourceOriginalClaim: archiveSourceOriginalClaimSchema.optional()
})
export const archiveQualityEvidenceSchema = z.object({
  version: z.literal(1),
  reason: z.string().optional(),
  unresolvedPageCount: z.number().int().nonnegative().optional(),
  pages: z.array(archivePageQualityEvidenceSchema)
})
export type ArchivePageQualityEvidence = z.infer<typeof archivePageQualityEvidenceSchema>
export type ArchiveQualityEvidence = z.infer<typeof archiveQualityEvidenceSchema>
export type ArchiveQualityStatus = z.infer<typeof archiveQualityStatusSchema>

export interface ArchiveQualitySummary {
  status: ArchiveQualityStatus
  originalCount: number
  displayCount: number
  unknownCount: number
  verifiedAt: string | Date | null
}

const mediaIdentitySchema = archivePageQualityEvidenceSchema.pick({
  imageId: true,
  index: true,
  path: true,
  size: true,
  sha256: true
})

/** A reader must match frozen identities before treating a page as reusable original media. */
export function getVerifiedOriginalPages(revision: { qualityEvidence: unknown; mediaSnapshot: unknown }) {
  const evidence = archiveQualityEvidenceSchema.safeParse(revision.qualityEvidence)
  const media = z.array(mediaIdentitySchema).safeParse(revision.mediaSnapshot)
  const verified = new Map<number, ArchivePageQualityEvidence>()
  if (!evidence.success || !media.success) return verified
  for (const page of evidence.data.pages) {
    const frozen = media.data.find((entry) => entry.index === page.index)
    if (
      page.quality === 'ORIGINAL' &&
      frozen &&
      frozen.imageId === page.imageId &&
      frozen.path === page.path &&
      frozen.size === page.size &&
      frozen.sha256 === page.sha256 &&
      evidence.data.pages.filter((entry) => entry.index === page.index).length === 1 &&
      media.data.filter((entry) => entry.index === page.index).length === 1
    )
      verified.set(page.index, page)
  }
  return verified
}

export const archiveQualityAuditPayloadSchema = z
  .object({
    targetMaxArtworkId: z.number().int().nonnegative(),
    targetArtworkCount: z.number().int().nonnegative()
  })
  .strict()
export type ArchiveQualityAuditPayload = z.infer<typeof archiveQualityAuditPayloadSchema>
export const archiveQualityAuditCheckpointSchema = z.object({
  kind: z.enum(['CHECKPOINT', 'COMPLETED']),
  afterArtworkId: z.number().int().nonnegative(),
  processedArtworks: z.number().int().nonnegative(),
  originalPages: z.number().int().nonnegative(),
  displayPages: z.number().int().nonnegative(),
  unknownPages: z.number().int().nonnegative()
})
export type ArchiveQualityAuditCheckpoint = z.infer<typeof archiveQualityAuditCheckpointSchema>
