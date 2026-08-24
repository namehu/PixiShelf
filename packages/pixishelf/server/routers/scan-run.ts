import { z } from 'zod'
import { ScanRunItemAction, ScanRunItemStatus, ScanRunMode, ScanRunStatus, ScanRunType } from '@prisma/client'
import { authProcedure, router } from '@/server/trpc'
import { getLatestScanRun, getScanRunDetail, listScanRuns } from '@/services/scan-run-service'

const nullableCount = z.number().int().nonnegative().nullable()
const scanRunHistoryDtoSchema = z
  .object({
    id: z.string().min(1),
    type: z.nativeEnum(ScanRunType),
    mode: z.nativeEnum(ScanRunMode),
    status: z.nativeEnum(ScanRunStatus),
    operationKind: z.enum(['CONSISTENCY_AUDIT', 'AUDIT_APPLY']).nullable(),
    sourceAuditRunId: z.string().nullable(),
    startedAt: z.date().nullable(),
    finishedAt: z.date().nullable(),
    durationMs: nullableCount,
    totalArtworks: z.number().int().nonnegative(),
    succeededArtworks: z.number().int().nonnegative(),
    skippedArtworks: z.number().int().nonnegative(),
    failedArtworks: z.number().int().nonnegative(),
    newImages: z.number().int().nonnegative(),
    walkedEntries: nullableCount,
    metadataCandidates: nullableCount,
    inventoryUnchanged: nullableCount,
    contentHashed: nullableCount,
    contentChanged: nullableCount,
    parsedInputs: nullableCount,
    publishedInputs: nullableCount,
    missingInputs: nullableCount,
    auditNewInputs: nullableCount,
    auditChangedInputs: nullableCount,
    auditInvalidInputs: nullableCount,
    auditIdentityConflictInputs: nullableCount,
    discoveryDurationMs: nullableCount,
    hashDurationMs: nullableCount,
    publishDurationMs: nullableCount,
    errorMessage: z.string().nullable()
  })
  .strict()

const scanRunDetailItemDtoSchema = z
  .object({
    id: z.string().min(1),
    resultArtworkId: z.number().int().positive().nullable(),
    externalId: z.string().nullable(),
    title: z.string().nullable(),
    artistName: z.string().nullable(),
    relativeDirectory: z.string().nullable(),
    metadataRelativePath: z.string().nullable(),
    status: z.nativeEnum(ScanRunItemStatus),
    action: z.nativeEnum(ScanRunItemAction),
    inventoryDecision: z.enum(['BASELINE_EXISTING', 'PENDING_SOURCE_REFRESH']).nullable(),
    mediaCount: z.number().int().nonnegative(),
    errorMessage: z.string().nullable()
  })
  .strict()

const scanRunDetailDtoSchema = z
  .object({
    run: scanRunHistoryDtoSchema.nullable(),
    items: z.array(scanRunDetailItemDtoSchema),
    nextCursor: z.string().nullable()
  })
  .strict()

export const scanRunRouter = router({
  /**
   * latest 仅返回最近一次扫描记录；list 支持可选分页，status 用于可选筛选扫描项状态。
   */
  latest: authProcedure.output(scanRunHistoryDtoSchema.nullable()).query(async () => {
    return getLatestScanRun()
  }),

  list: authProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).optional()
        })
        .optional()
    )
    .output(z.array(scanRunHistoryDtoSchema))
    .query(async ({ input }) => {
      return listScanRuns({ limit: input?.limit })
    }),

  detail: authProcedure
    .input(
      z.object({
        scanRunId: z.string().min(1),
        status: z.nativeEnum(ScanRunItemStatus).optional(),
        limit: z.number().int().min(1).max(500).optional(),
        cursor: z.string().min(1).optional()
      })
    )
    .output(scanRunDetailDtoSchema)
    .query(async ({ input }) => {
      return getScanRunDetail(input)
    })
})
