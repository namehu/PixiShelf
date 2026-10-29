import { z } from 'zod'

const id = z.string().trim().min(1).max(128)
const positive = z.number().int().positive().safe()
const count = z.number().int().nonnegative().safe()
const bytes = z.string().regex(/^\d+$/)
const date = z.string().nullable()
const cursor = z.string().min(1).max(2000)
const pageSize = z.number().int().min(1).max(100).default(20)
const identity = { expectedUserId: id }
const command = { ...identity, operationId: id, expectedVersion: positive, idempotencyKey: id }
const ids = z
  .array(id)
  .max(1000)
  .refine((values) => new Set(values).size === values.length, 'Duplicate ID')
const itemIds = z
  .array(positive)
  .min(1)
  .max(100)
  .refine((values) => new Set(values).size === values.length, 'Duplicate item')
export const ARTWORK_DEDUP_RELEASE_STAGE: number = 3
/** Independent release decision; never inferred from the legacy stage or client input. */
export const ARTWORK_DEDUP_DIRECT_DELETE_ENABLED: boolean = true
export const ARTWORK_DEDUP_DIRECT_DELETE_PROTOCOL = 1 as const
export const ARTWORK_DEDUP_DIRECT_DELETE_DEFINITION_VERSION = 5 as const
export const artworkDedupMaintenanceModeSchema = z.enum(['PREPARE', 'ISOLATE', 'RESTORE', 'PURGE', 'DIRECT_DELETE'])
export type ArtworkDedupMaintenanceMode = z.infer<typeof artworkDedupMaintenanceModeSchema>
export function isArtworkDedupMaintenanceModeEnabled(
  mode: ArtworkDedupMaintenanceMode,
  purpose: 'ISOLATION' | 'PURGE' | 'DIRECT_DELETE' = 'ISOLATION'
) {
  if (mode === 'DIRECT_DELETE' || purpose === 'DIRECT_DELETE') return ARTWORK_DEDUP_DIRECT_DELETE_ENABLED
  return ARTWORK_DEDUP_RELEASE_STAGE >= (mode === 'PURGE' || purpose === 'PURGE' ? 5 : mode === 'PREPARE' ? 3 : 4)
}
export function assertArtworkDedupMaintenanceModeEnabled(
  mode: ArtworkDedupMaintenanceMode,
  purpose: 'ISOLATION' | 'PURGE' | 'DIRECT_DELETE' = 'ISOLATION'
) {
  if (!isArtworkDedupMaintenanceModeEnabled(mode, purpose)) throw new Error('ARTWORK_DEDUP_MODE_DISABLED')
}
const maintenanceIdentity = { operationId: id, executionVersion: positive }
export const artworkDedupMaintenanceV1PayloadSchema = z
  .object({ ...maintenanceIdentity, mode: z.enum(['PREPARE', 'ISOLATE', 'RESTORE', 'PURGE']) })
  .strict()
export const artworkDedupMaintenanceV2PayloadSchema = z.discriminatedUnion('mode', [
  z
    .object({
      ...maintenanceIdentity,
      mode: z.literal('PREPARE'),
      purpose: z.literal('DIRECT_DELETE'),
      protocolVersion: z.literal(1)
    })
    .strict(),
  z.object({ ...maintenanceIdentity, mode: z.literal('DIRECT_DELETE') }).strict()
])
export const artworkDedupMaintenanceV3PayloadSchema = z.discriminatedUnion('mode', [
  z.object({ ...maintenanceIdentity, mode: z.literal('PREPARE'), purpose: z.literal('DIRECT_DELETE'),
    protocolVersion: z.union([z.literal(1), z.literal(2)]) }).strict(),
  z.object({ ...maintenanceIdentity, mode: z.literal('DIRECT_DELETE') }).strict()
])
export const artworkDedupMaintenanceV4PayloadSchema = z.discriminatedUnion('mode', [
  z.object({ ...maintenanceIdentity, mode: z.literal('PREPARE'), purpose: z.literal('DIRECT_DELETE'),
    protocolVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]) }).strict(),
  z.object({ ...maintenanceIdentity, mode: z.literal('DIRECT_DELETE') }).strict()
])
export const artworkDedupMaintenanceV5PayloadSchema = z.discriminatedUnion('mode', [
  z.object({ ...maintenanceIdentity, mode: z.literal('PREPARE'), purpose: z.literal('DIRECT_DELETE'),
    protocolVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) }).strict(),
  z.object({ ...maintenanceIdentity, mode: z.literal('DIRECT_DELETE') }).strict()
])
export const artworkDedupMaintenancePayloadSchema = z.union([
  artworkDedupMaintenanceV1PayloadSchema,
  artworkDedupMaintenanceV2PayloadSchema,
  artworkDedupMaintenanceV3PayloadSchema,
  artworkDedupMaintenanceV4PayloadSchema,
  artworkDedupMaintenanceV5PayloadSchema
])
export type ArtworkDedupMaintenancePayload = z.infer<typeof artworkDedupMaintenancePayloadSchema>
export const artworkDedupOperationStatusSchema = z.enum([
  'DRAINING',
  'VERIFYING',
  'DELETING',
  'DELETED',
  'STOPPED',
  'BUILDING',
  'READY',
  'STALE',
  'FAILED',
  'ISOLATING',
  'ISOLATED',
  'RESTORING',
  'RESTORED',
  'PURGING',
  'PURGED',
  'RECOVERY_REQUIRED',
  'CANCELLED'
])
export const artworkDedupOperationActionSchema = z.enum([
  'DIRECT_DELETE',
  'ISOLATE',
  'RESTORE',
  'PREPARE_PURGE',
  'PURGE',
  'RETRY_PREPARE',
  'RETRY_OPERATION',
  'REPREPARE',
  'CANCEL',
  'STOP',
  'ALLOW_REIMPORT'
])
export const artworkDedupFileRoleSchema = z.enum(['MEDIA', 'CHAPTER', 'SOURCE_FILE', 'ATTACHMENT', 'UNKNOWN'])
export const artworkDedupReviewDtoSchema = z.object({ groupId: id, keeperArtworkId: positive, reviewVersion: positive })
export type ArtworkDedupReviewDto = z.infer<typeof artworkDedupReviewDtoSchema>
export const artworkDedupMemberDtoSchema = z.object({
  artworkId: positive,
  title: z.string(),
  thumbnailUrl: z.string().nullable(),
  sourceLabel: z.string(),
  createdAt: z.string(),
  ownOrganization: z.object({
    rating: z.number().int().min(1).max(4).nullable(),
    bookmarks: z.object({ available: count, unavailable: count }),
    likes: z.object({ available: count, unavailable: count })
  }),
  ownReading: z.object({ lastViewedAt: date, seenCount: count, totalCount: count, stateVersion: count }).nullable(),
  otherAccountHasOrganization: z.boolean()
})
export type ArtworkDedupMemberDto = z.infer<typeof artworkDedupMemberDtoSchema>
export const artworkDedupVisualSummarySchema = z.object({
  evidenceVersion: id, leftArtworkId: positive, rightArtworkId: positive,
  leftFileCount: bytes, rightFileCount: bytes, pairedCount: bytes, exactCount: bytes, similarCount: bytes,
  leftUnmatchedCount: bytes, rightUnmatchedCount: bytes, leftUncheckedCount: bytes, rightUncheckedCount: bytes
})
export type ArtworkDedupVisualSummary = z.infer<typeof artworkDedupVisualSummarySchema>
export const artworkDedupListComparisonsInputSchema = z.object({
  ...identity, runId: id, groupId: id, filter: z.enum(['ALL', 'DIFFERENT', 'PAIRED', 'UNMATCHED', 'UNCHECKED']).default('DIFFERENT'),
  cursor: cursor.optional(), limit: z.number().int().min(1).max(50).default(20)
}).strict()
const comparisonMedia = z.object({ artworkId: positive, imageId: positive, index: count, thumbnailUrl: z.string().nullable() })
export const artworkDedupListComparisonsDtoSchema = z.object({
  runId: id, groupId: id, visual: artworkDedupVisualSummarySchema,
  items: z.array(z.object({ id: positive, kind: z.enum(['EXACT', 'SIMILAR', 'UNMATCHED', 'UNCHECKED']), left: comparisonMedia.nullable(), right: comparisonMedia.nullable() })),
  nextCursor: z.string().nullable()
})
export type ArtworkDedupListComparisonsDto = z.infer<typeof artworkDedupListComparisonsDtoSchema>
export const artworkDedupGroupDtoSchema = z.object({
  relationKind: z.enum(['EXACT', 'CONTAINS', 'VISUAL', 'PARTIAL']).default('EXACT'),
  visual: artworkDedupVisualSummarySchema.nullable().default(null),
  containedArtworkId: positive.nullable().default(null),
  containerArtworkId: positive.nullable().default(null),
  containedFileCount: bytes.nullable().default(null),
  containerFileCount: bytes.nullable().default(null),
  extraFileCount: bytes.nullable().default(null),
  groupId: id,
  memberCount: count,
  fileCount: bytes,
  previewMembers: z.array(artworkDedupMemberDtoSchema).max(3),
  keeper: artworkDedupMemberDtoSchema.nullable().default(null),
  recommendedKeeperArtworkId: positive.nullable(),
  recommendationReason: z.enum(['ORGANIZATION', 'LAST_VIEWED', 'CREATED', 'SAVED', 'NEEDS_CHOICE', 'UNAVAILABLE']),
  savedReview: artworkDedupReviewDtoSchema.nullable(),
  reviewVersion: count,
  needsExplicitChoice: z.boolean(),
  eligibility: z.enum(['ELIGIBLE', 'NEEDS_CHOICE', 'STALE', 'BLOCKED']),
  reasons: z.array(z.string())
})
export type ArtworkDedupGroupDto = z.infer<typeof artworkDedupGroupDtoSchema>
export const artworkDedupReviewListGroupsInputSchema = z.union([
  z.object({ ...identity, runId: id, cursor: cursor.optional(), limit: pageSize }).strict(),
  z.object({ ...identity, runId: id, groupId: id, memberCursor: cursor.optional(), limit: pageSize }).strict()
])
const groupPage = {
  runId: id,
  runVersion: positive,
  reviewRevision: count,
  allowedActions: z.array(z.enum(['SAVE_REVIEW', 'PREPARE_CLEANUP']))
}
export const artworkDedupListGroupsDtoSchema = z.discriminatedUnion('kind', [
  z.object({
    ...groupPage,
    kind: z.literal('GROUPS'),
    items: z.array(artworkDedupGroupDtoSchema),
    nextCursor: z.string().nullable(),
    totalGroups: count,
    recommendedGroupCount: count
  }),
  z.object({
    ...groupPage,
    kind: z.literal('MEMBERS'),
    group: artworkDedupGroupDtoSchema,
    keeper: artworkDedupMemberDtoSchema.nullable(),
    items: z.array(artworkDedupMemberDtoSchema),
    nextMemberCursor: z.string().nullable()
  })
])
export type ArtworkDedupListGroupsDto = z.infer<typeof artworkDedupListGroupsDtoSchema>
export const artworkDedupSaveReviewInputSchema = z
  .object({
    ...identity,
    runId: id,
    groupId: id,
    keeperArtworkId: positive,
    expectedRunVersion: positive,
    expectedReviewVersion: count,
    idempotencyKey: id
  })
  .strict()
export const artworkDedupSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('EXPLICIT'), groupIds: ids.refine((v) => v.length > 0, 'Select a group') }).strict(),
  z.object({ kind: z.literal('ALL_RECOMMENDED'), excludedGroupIds: ids.default([]) }).strict()
])
export const artworkDedupPrepareCleanupInputSchema = z.union([
  z
    .object({
      ...identity,
      runId: id,
      expectedRunVersion: positive,
      expectedReviewRevision: count,
      selection: artworkDedupSelectionSchema,
      idempotencyKey: id
    })
    .strict(),
  z.object({ ...identity, sourceOperationId: id, expectedOperationVersion: positive, idempotencyKey: id }).strict()
])
export const artworkDedupPrepareDirectDeleteInputSchema = z.union([
  z
    .object({
      ...identity,
      purpose: z.literal('DIRECT_DELETE'),
      protocolVersion: z.literal(1),
      runId: id,
      expectedRunVersion: positive,
      expectedReviewRevision: count,
      selection: artworkDedupSelectionSchema,
      idempotencyKey: id
    })
    .strict(),
  z
    .object({
      ...identity,
      purpose: z.literal('DIRECT_DELETE'),
      protocolVersion: z.literal(1),
      sourceOperationId: id,
      expectedOperationVersion: positive,
      idempotencyKey: id
    })
    .strict()
])
export const artworkDedupItemSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ALL') }).strict(),
  z.object({ kind: z.literal('EXPLICIT'), itemIds }).strict()
])
const recoveryConfirmation = {
  externalWritesStopped: z.literal(true),
  backupCheckpointConfirmed: z.literal(true),
  backupCheckpointRef: z.string().trim().min(1).max(200)
}
export const artworkDedupDirectDeleteInputSchema = z
  .object({
    ...command,
    purpose: z.literal('DIRECT_DELETE'),
    protocolVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    differentContentLossConfirmed: z.literal(true).optional(),
    scopeDigest: z.string().regex(/^[a-f0-9]{64}$/),
    externalWritesStopped: z.literal(true),
    permanentDeleteConfirmed: z.literal(true),
    organizationImpactConfirmed: z.literal(true)
  })
  .strict()
  .refine(value => ![3, 4].includes(value.protocolVersion) || value.differentContentLossConfirmed === true, 'Different content loss confirmation required')
export type ArtworkDedupDirectDeleteInput = z.infer<typeof artworkDedupDirectDeleteInputSchema>
export const artworkDedupDirectDeleteRetryInputSchema = z.object(command).strict()
export const artworkDedupIsolateInputSchema = z
  .object({ ...command, ...recoveryConfirmation, organizationImpactConfirmed: z.boolean().default(false) })
  .strict()
export const artworkDedupRestoreInputSchema = z
  .object({ ...command, selection: artworkDedupItemSelectionSchema })
  .strict()
export const artworkDedupPreparePurgeInputSchema = z
  .object({ ...command, selection: artworkDedupItemSelectionSchema })
  .strict()
export const artworkDedupPurgeInputSchema = z
  .object({
    ...command,
    ...recoveryConfirmation,
    selection: artworkDedupItemSelectionSchema,
    permanentDeleteConfirmed: z.literal(true),
    expectedPurgePreviewVersion: positive
  })
  .strict()
export const artworkDedupRetryOperationInputSchema = z.object({ ...command, itemIds: itemIds.optional() }).strict()
export const artworkDedupCancelOperationInputSchema = z.object(command).strict()
export const artworkDedupAllowReimportInputSchema = z
  .object({
    ...command,
    sources: z
      .array(z.object({ sourceId: id, expectedGeneration: bytes }).strict())
      .min(1)
      .max(100)
      .refine((values) => new Set(values.map((value) => value.sourceId)).size === values.length, 'Duplicate source')
  })
  .strict()
export const artworkDedupGetOperationInputSchema = z
  .object({
    ...identity,
    operationId: id,
    preview: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('ARTWORKS'), cursor: z.string().max(2000).optional(), limit: pageSize }).strict(),
        z
          .object({
            kind: z.literal('FILES'),
            artworkId: positive.optional(),
            cursor: z.string().max(2000).optional(),
            limit: pageSize
          })
          .strict()
      ])
      .optional()
  })
  .strict()
export const artworkDedupListOperationsInputSchema = z
  .object({ ...identity, artistId: positive.optional(), cursor: z.string().max(2000).optional(), limit: pageSize })
  .strict()
export const artworkDedupOperationDtoSchema = z.object({
  operationId: id,
  artistId: positive,
  runId: id,
  runVersion: positive,
  version: positive,
  executionVersion: positive,
  jobId: id.nullable(),
  mode: artworkDedupMaintenanceModeSchema,
  originalAction: artworkDedupMaintenanceModeSchema,
  preparePurpose: z.enum(['ISOLATION', 'PURGE', 'DIRECT_DELETE']),
  protocolVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable().default(null),
  scopeDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable()
    .default(null),
  status: artworkDedupOperationStatusSchema,
  stage: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  validatedAt: date,
  deleteStartedAt: date.default(null),
  stopRequested: z.boolean().default(false),
  counts: z.object({
    selectedGroups: count,
    excludedGroups: count,
    blockedGroups: count,
    keepers: count,
    copies: count,
    preparedArtworks: count,
    preparedFiles: bytes,
    logicalBytes: bytes.nullable(),
    movedFiles: bytes,
    restoredFiles: bytes,
    deletedFiles: bytes,
    completedCopies: count.default(0),
    remainingCopies: count.default(0),
    blockedCopies: count.default(0),
    remainingFiles: bytes.default('0'),
    deleteIntentFiles: bytes.default('0')
  }),
  requiresOrganizationConfirmation: z.boolean(),
  backupCheckpointRef: z.string().nullable(),
  purgePreview: z
    .object({ status: z.enum(['BUILDING', 'READY', 'STALE', 'FAILED']), version: positive, validatedAt: date })
    .nullable(),
  allowedActions: z.array(artworkDedupOperationActionSchema),
  failure: z.object({ code: z.string(), message: z.string() }).nullable()
})
export type ArtworkDedupOperationDto = z.infer<typeof artworkDedupOperationDtoSchema>
export const artworkDedupArtworkPreviewDtoSchema = artworkDedupMemberDtoSchema.extend({
  ...artworkDedupGroupDtoSchema.pick({ visual: true, relationKind: true, containedArtworkId: true, containerArtworkId: true,
    containedFileCount: true, containerFileCount: true, extraFileCount: true }).shape,
  itemId: positive,
  groupId: id,
  role: z.enum(['KEEPER', 'COPY']),
  status: z.string(),
  reasons: z.array(z.string()),
  canAllowReimport: z.boolean(),
  personalRecords: z.enum(['CURRENT', 'REMOVED', 'UNAVAILABLE']).default('CURRENT'),
  mediaCount: bytes.default('0'),
  fileCount: bytes.default('0'),
  sources: z.array(
    z.object({
      sourceId: id,
      displayName: z.string(),
      generation: bytes,
      status: z.enum(['OPEN', 'HOLD', 'TOMBSTONE'])
    })
  )
})
export type ArtworkDedupArtworkPreviewDto = z.infer<typeof artworkDedupArtworkPreviewDtoSchema>
export const artworkDedupFilePreviewDtoSchema = z.object({
  fileId: id,
  artworkId: positive,
  role: artworkDedupFileRoleSchema,
  artworkRole: z.enum(['KEEPER', 'COPY']).nullable().default(null),
  artworkTitle: z.string().nullable().default(null),
  relativeName: z.string(),
  sizeBytes: bytes.nullable(),
  inspectionStatus: z.string(),
  ownershipStatus: z.string(),
  requiresReview: z.boolean(),
  blockReason: z.string().nullable(),
  status: z.string()
})
export type ArtworkDedupFilePreviewDto = z.infer<typeof artworkDedupFilePreviewDtoSchema>
export const artworkDedupOperationResponseDtoSchema = z.object({
  operation: artworkDedupOperationDtoSchema,
  preview: z
    .discriminatedUnion('kind', [
      z.object({
        kind: z.literal('ARTWORKS'),
        items: z.array(artworkDedupArtworkPreviewDtoSchema),
        nextCursor: z.string().nullable()
      }),
      z.object({
        kind: z.literal('FILES'),
        items: z.array(artworkDedupFilePreviewDtoSchema),
        nextCursor: z.string().nullable()
      })
    ])
    .nullable()
})
export type ArtworkDedupOperationResponseDto = z.infer<typeof artworkDedupOperationResponseDtoSchema>
