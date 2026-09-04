import { Prisma, type PrismaClient } from '@pixishelf/db'

export const ARCHIVE_UPLOADER_CATALOG_VIEWS = ['ACTIONABLE', 'PROCESSING', 'ARCHIVED', 'ATTENTION', 'ALL'] as const

export type ArchiveUploaderCatalogView = (typeof ARCHIVE_UPLOADER_CATALOG_VIEWS)[number]

export type ArchiveUploaderWorkflowStage =
  | 'NEW'
  | 'UPDATE_AVAILABLE'
  | 'REPLACEMENT'
  | 'INBOX'
  | 'READY'
  | 'DOWNLOADING'
  | 'ARCHIVED'
  | 'FAILED'
  | 'CANCELLED'
  | 'DUPLICATE'

export interface ArchiveUploaderCatalogCursor {
  sortAt: Date
  lastSeenAt: Date
  id: string
}

export interface ArchiveUploaderCatalogStateRow {
  id: string
  sourceId: string
  providerKey: string
  externalId: string
  canonicalUrl: string
  title: string
  thumbnailUrl: string | null
  uploaderName: string | null
  postedAt: Date | null
  classification: 'NEW' | 'ACTIVE' | 'ARCHIVED' | 'POSSIBLE_UPDATE' | 'REPLACEMENT'
  comparisonKnown: boolean
  changeReasons: Prisma.JsonValue
  firstSeenAt: Date
  lastSeenAt: Date
  workflowStage: ArchiveUploaderWorkflowStage
  workflowBucket: Exclude<ArchiveUploaderCatalogView, 'ALL'>
  recommendation: 'NEW' | 'POSSIBLE_UPDATE' | 'REPLACEMENT' | null
  intakeItemId: string | null
  intakeStatus: string | null
  archiveImportId: string | null
  archiveImportStatus: string | null
  artworkId: number | null
  errorCode: string | null
  errorMessage: string | null
  recoverable: boolean
  sortAt: Date
}

export interface ArchiveUploaderCatalogCounts {
  actionable: number
  processing: number
  archived: number
  attention: number
  total: number
}

export async function listArchiveUploaderCatalogState(
  database: PrismaClient,
  input: {
    sourceId: string
    view: ArchiveUploaderCatalogView
    cursor?: ArchiveUploaderCatalogCursor | null
    limit: number
  }
) {
  const cursorCondition = input.cursor
    ? Prisma.sql`AND (
        state."sortAt" < ${input.cursor.sortAt}
        OR (state."sortAt" = ${input.cursor.sortAt} AND state."lastSeenAt" < ${input.cursor.lastSeenAt})
        OR (
          state."sortAt" = ${input.cursor.sortAt}
          AND state."lastSeenAt" = ${input.cursor.lastSeenAt}
          AND state."id" < ${input.cursor.id}
        )
      )`
    : Prisma.empty
  const viewCondition = input.view === 'ALL' ? Prisma.empty : Prisma.sql`AND state."workflowBucket" = ${input.view}`

  const rows = await database.$queryRaw<ArchiveUploaderCatalogStateRow[]>(Prisma.sql`
    ${catalogStateCte(Prisma.sql`catalog."sourceId" = ${input.sourceId}`)}
    SELECT
      state."id",
      state."sourceId",
      state."providerKey",
      state."externalId",
      state."canonicalUrl",
      state."title",
      state."thumbnailUrl",
      state."uploaderName",
      state."postedAt",
      state."classification",
      state."comparisonKnown",
      state."changeReasons",
      state."firstSeenAt",
      state."lastSeenAt",
      state."workflowStage",
      state."workflowBucket",
      state."recommendation",
      state."intakeItemId",
      state."intakeStatus",
      state."archiveImportId",
      state."archiveImportStatus",
      state."artworkId",
      state."errorCode",
      state."errorMessage",
      state."recoverable",
      state."sortAt"
    FROM "catalogState" AS state
    WHERE TRUE
      ${viewCondition}
      ${cursorCondition}
    ORDER BY state."sortAt" DESC, state."lastSeenAt" DESC, state."id" DESC
    LIMIT ${input.limit + 1}
  `)
  const hasMore = rows.length > input.limit
  const items = hasMore ? rows.slice(0, input.limit) : rows
  const last = items.at(-1)
  return {
    items,
    nextCursor: hasMore && last ? { sortAt: last.sortAt, lastSeenAt: last.lastSeenAt, id: last.id } : null
  }
}

export async function getArchiveUploaderCatalogCounts(
  database: PrismaClient,
  sourceIds?: string[]
): Promise<Map<string, ArchiveUploaderCatalogCounts>> {
  if (sourceIds && sourceIds.length === 0) return new Map()
  const scope = sourceIds ? Prisma.sql`catalog."sourceId" IN (${Prisma.join(sourceIds)})` : Prisma.sql`TRUE`
  const rows = await database.$queryRaw<
    Array<{
      sourceId: string
      actionable: bigint
      processing: bigint
      archived: bigint
      attention: bigint
      total: bigint
    }>
  >(Prisma.sql`
    ${catalogStateCte(scope)}
    SELECT
      state."sourceId",
      COUNT(*) FILTER (WHERE state."workflowBucket" = 'ACTIONABLE')::bigint AS "actionable",
      COUNT(*) FILTER (WHERE state."workflowBucket" = 'PROCESSING')::bigint AS "processing",
      COUNT(*) FILTER (WHERE state."workflowBucket" = 'ARCHIVED')::bigint AS "archived",
      COUNT(*) FILTER (WHERE state."workflowBucket" = 'ATTENTION')::bigint AS "attention",
      COUNT(*)::bigint AS "total"
    FROM "catalogState" AS state
    GROUP BY state."sourceId"
  `)
  return new Map(
    rows.map((row) => [
      row.sourceId,
      {
        actionable: Number(row.actionable),
        processing: Number(row.processing),
        archived: Number(row.archived),
        attention: Number(row.attention),
        total: Number(row.total)
      }
    ])
  )
}

function catalogStateCte(scope: Prisma.Sql) {
  return Prisma.sql`
    WITH "catalogBase" AS (
      SELECT
        catalog.*,
        reference."artworkId",
        intake."id" AS "intakeItemId",
        intake."status"::text AS "intakeStatus",
        intake."updatedAt" AS "intakeUpdatedAt",
        intake."errorCode" AS "intakeErrorCode",
        intake."errorMessage" AS "intakeErrorMessage",
        archive_import."id" AS "archiveImportId",
        archive_import."status"::text AS "archiveImportStatus",
        archive_import."updatedAt" AS "archiveImportUpdatedAt",
        archive_import."errorCode" AS "archiveImportErrorCode",
        archive_import."errorMessage" AS "archiveImportErrorMessage",
        COALESCE(catalog."postedAt", catalog."lastSeenAt") AS "sortAt"
      FROM "archive_uploader_catalog_items" AS catalog
      LEFT JOIN "archive_uploader_ignored_items" AS ignored
        ON ignored."providerKey" = catalog."providerKey"
        AND ignored."externalId" = catalog."externalId"
      LEFT JOIN "artwork_external_refs" AS reference
        ON reference."providerKey" = catalog."providerKey"
        AND reference."externalId" = catalog."externalId"
      LEFT JOIN LATERAL (
        SELECT intake_item.*
        FROM "archive_intake_items" AS intake_item
        WHERE intake_item."id" = catalog."lastIntakeItemId"
          OR (
            (
              (
                intake_item."providerKey" = catalog."providerKey"
                AND intake_item."externalId" = catalog."externalId"
              )
              OR intake_item."submittedUrl" = catalog."canonicalUrl"
              OR intake_item."canonicalUrl" = catalog."canonicalUrl"
            )
            AND (
              catalog."lastOutcomeAt" IS NULL
              OR intake_item."updatedAt" > catalog."lastOutcomeAt"
            )
          )
        ORDER BY
          (intake_item."id" = catalog."lastIntakeItemId") DESC,
          (intake_item."status" IN ('QUEUED', 'RESOLVING', 'RETRY_WAIT', 'READY', 'STALE')) DESC,
          intake_item."updatedAt" DESC,
          intake_item."createdAt" DESC,
          intake_item."id" DESC
        LIMIT 1
      ) AS intake ON TRUE
      LEFT JOIN LATERAL (
        SELECT candidate.*
        FROM "archive_imports" AS candidate
        WHERE candidate."id" = catalog."lastArchiveImportId"
          OR (
            candidate."providerKey" = catalog."providerKey"
            AND candidate."externalId" = catalog."externalId"
            AND (
              catalog."lastOutcomeAt" IS NULL
              OR candidate."updatedAt" > catalog."lastOutcomeAt"
            )
          )
        ORDER BY candidate."createdAt" DESC, candidate."id" DESC
        LIMIT 1
      ) AS archive_import ON TRUE
      WHERE ${scope} AND catalog."matchesQuery" = true
        AND ignored."id" IS NULL
    ),
    "catalogStages" AS (
      SELECT
        base.*,
        CASE
          WHEN base."archiveImportStatus" IN ('PENDING', 'RUNNING', 'PAUSED', 'CANCELLING') THEN 'DOWNLOADING'
          WHEN base."intakeStatus" IN ('READY', 'STALE') THEN 'READY'
          WHEN base."intakeStatus" IN ('QUEUED', 'RESOLVING', 'RETRY_WAIT') THEN 'INBOX'
          WHEN base."archiveImportStatus" = 'FAILED'
            AND (
              base."lastOutcomeAt" IS NULL
              OR base."archiveImportUpdatedAt" > base."lastOutcomeAt"
            ) THEN 'FAILED'
          WHEN base."archiveImportStatus" = 'CANCELLED'
            AND (
              base."lastOutcomeAt" IS NULL
              OR base."archiveImportUpdatedAt" > base."lastOutcomeAt"
            ) THEN 'CANCELLED'
          WHEN base."intakeStatus" = 'FAILED'
            AND (
              base."lastOutcomeAt" IS NULL
              OR base."intakeUpdatedAt" > base."lastOutcomeAt"
            ) THEN 'FAILED'
          WHEN base."intakeStatus" = 'CANCELLED'
            AND (
              base."lastOutcomeAt" IS NULL
              OR base."intakeUpdatedAt" > base."lastOutcomeAt"
            ) THEN 'CANCELLED'
          WHEN base."intakeStatus" = 'DUPLICATE'
            AND (
              base."lastOutcomeAt" IS NULL
              OR base."intakeUpdatedAt" > base."lastOutcomeAt"
            ) THEN 'DUPLICATE'
          WHEN base."lastOutcome"::text = 'FAILED' THEN 'FAILED'
          WHEN base."lastOutcome"::text = 'CANCELLED' THEN 'CANCELLED'
          WHEN base."lastOutcome"::text = 'DUPLICATE' THEN 'DUPLICATE'
          WHEN base."lastOutcome"::text = 'ARCHIVED'
            AND base."artworkId" IS NOT NULL
            AND base."classification"::text <> 'POSSIBLE_UPDATE' THEN 'ARCHIVED'
          WHEN base."artworkId" IS NOT NULL
            AND base."classification"::text = 'POSSIBLE_UPDATE' THEN 'UPDATE_AVAILABLE'
          WHEN base."artworkId" IS NOT NULL THEN 'ARCHIVED'
          WHEN base."classification"::text = 'REPLACEMENT' THEN 'REPLACEMENT'
          ELSE 'NEW'
        END AS "workflowStage"
      FROM "catalogBase" AS base
    ),
    "catalogState" AS (
      SELECT
        stage.*,
        CASE
          WHEN stage."workflowStage" IN ('NEW', 'UPDATE_AVAILABLE', 'REPLACEMENT') THEN 'ACTIONABLE'
          WHEN stage."workflowStage" IN ('INBOX', 'READY', 'DOWNLOADING') THEN 'PROCESSING'
          WHEN stage."workflowStage" = 'ARCHIVED' THEN 'ARCHIVED'
          ELSE 'ATTENTION'
        END AS "workflowBucket",
        CASE
          WHEN stage."workflowStage" = 'UPDATE_AVAILABLE' THEN 'POSSIBLE_UPDATE'
          WHEN stage."workflowStage" = 'REPLACEMENT' THEN 'REPLACEMENT'
          WHEN stage."workflowStage" = 'NEW' THEN 'NEW'
          ELSE NULL
        END AS "recommendation",
        COALESCE(
          stage."archiveImportErrorCode",
          stage."intakeErrorCode",
          stage."lastErrorCode"
        ) AS "errorCode",
        COALESCE(
          stage."archiveImportErrorMessage",
          stage."intakeErrorMessage",
          stage."lastErrorMessage"
        ) AS "errorMessage",
        (
          stage."workflowStage" IN ('FAILED', 'CANCELLED', 'DUPLICATE')
          AND stage."intakeItemId" IS NULL
        ) AS "recoverable"
      FROM "catalogStages" AS stage
    )
  `
}
