import { Prisma, PrismaClient } from '@prisma/client'

export { Prisma, PrismaClient }
export * from './creators'
export * from './discovery-creators'
export * from './artist-merge'
export * from './animation-duration'
export * from './artwork-reading'
export * from './artwork-summary'
export * from './media-content-types'
export * from './media-content-directory'
export * from './media-content-writes'
export * from './media-content-evidence'
export * from './media-content-recovery'

const latestRequiredMigration = '20261023003000_media_content_recovery_grants'

const requiredQueueObjects = [
  'MediaContentDirectoryState',
  'MediaContentRecoveryGrant',
  'MediaContentPathWrite',
  'MediaContentSource',
  'ArtworkContentSource',
  'MediaContentFingerprint',
  'ArtworkContentFingerprint',
  'archive_import_executions',
  'archive_staging_generations',
  'ArtworkSummary',
  'ArtworkSummaryFeature',
  'artist_merges',
  'ImageAnimationMetadata',
  'artwork_reading_summaries',
  'artwork_read_media',
  'creator_maintenance_plans',
  'creator_maintenance_items',
  'artwork_artists',
  'artwork_artist_evidence',
  'artist_source_tag_mappings',
  'effective_artwork_creators',
  'archive_intake_items',
  'archive_deleted_identities',
  'archive_uploader_scan_items',
  'archive_uploader_scan_runs',
  'archive_uploader_sources',
  'archive_provider_request_leases',
  'archive_provider_throttles',
  'archive_resolve_queue_control',
  'derived_media_gc_entries',
  'job_resource_leases',
  'pixiv_metadata_inventory',
  'pixiv_metadata_inventory_state',
  'pixiv_source_audit_items',
  'tag_external_metadata',
  'system_job_events',
  'worker_instances'
] as const

interface QueueFenceIndexRow {
  indexName: string
  indexPredicate: string | null
  indexExpression: string | null
  keyCount: number
}

export function createDatabaseClient(options?: Prisma.PrismaClientOptions): PrismaClient {
  return new PrismaClient(options)
}

export async function disconnectDatabase(client: PrismaClient): Promise<void> {
  await client.$disconnect()
}

export async function assertBackgroundQueueSchema(client: PrismaClient): Promise<void> {
  let columnRows: Array<{ columnName: string }>
  let tableRows: Array<{ tableName: string }>
  let migrationRows: Array<{ migrationName: string }>
  let indexRows: QueueFenceIndexRow[]
  let contractRows: Array<{ name: string }>

  try {
    ;[columnRows, tableRows, migrationRows, indexRows, contractRows] = await Promise.all([
      client.$queryRaw<Array<{ columnName: string }>>(Prisma.sql`
        SELECT CASE
          WHEN table_name = 'Artwork' AND column_name = 'mediaRevision' THEN 'Artwork.mediaRevision'
          WHEN table_name = 'archive_imports' THEN 'archive_imports.' || column_name
          ELSE column_name
        END AS "columnName"
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND (
            (table_name = 'system_jobs' AND column_name IN ('definitionVersion', 'executionLane', 'progressData', 'legacyDisplay'))
            OR (table_name = 'Artwork' AND column_name = 'mediaRevision')
            OR (table_name = 'archive_imports' AND column_name IN ('publishedArtworkDeletedAt', 'publishedArtworkPurgedAt', 'phase', 'origin', 'generationToken', 'sealedManifestSha256'))
            OR (table_name = 'Artist' AND column_name = 'userId')
            OR (table_name = 'Artwork' AND column_name = 'seriesId')
            OR (table_name = 'Series' AND column_name IN ('source', 'externalId'))
          )
      `),
      client.$queryRaw<Array<{ tableName: string }>>(Prisma.sql`
        SELECT table_name AS "tableName"
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name IN (${Prisma.join(requiredQueueObjects)})
      `),
      client.$queryRaw<Array<{ migrationName: string }>>(Prisma.sql`
        SELECT migration_name AS "migrationName"
        FROM "_prisma_migrations"
        WHERE migration_name = ${latestRequiredMigration}
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      `),
      client.$queryRaw<QueueFenceIndexRow[]>(Prisma.sql`
        SELECT
          index_class.relname AS "indexName",
          pg_get_expr(index_metadata.indpred, index_metadata.indrelid, true) AS "indexPredicate",
          pg_get_indexdef(index_metadata.indexrelid, 1, true) AS "indexExpression",
          index_metadata.indnkeyatts::integer AS "keyCount"
        FROM pg_index AS index_metadata
        INNER JOIN pg_class AS index_class ON index_class.oid = index_metadata.indexrelid
        INNER JOIN pg_class AS table_class ON table_class.oid = index_metadata.indrelid
        INNER JOIN pg_namespace AS table_namespace ON table_namespace.oid = table_class.relnamespace
        WHERE table_namespace.nspname = current_schema()
          AND table_class.relname = 'system_jobs'
          AND index_class.relname = 'system_jobs_single_executing_per_lane_idx'
          AND index_metadata.indisunique
          AND index_metadata.indisvalid
          AND index_metadata.indisready
          AND index_metadata.indpred IS NOT NULL
      `),
      client.$queryRaw<Array<{ name: string }>>(Prisma.sql`
        SELECT c.conname AS name FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = current_schema() AND t.relname = 'system_jobs' AND c.contype = 'c' AND c.convalidated
        UNION ALL
        SELECT 'availableAt_not_null' AS name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'system_jobs' AND column_name = 'availableAt' AND is_nullable = 'NO'
        UNION ALL
        SELECT 'retired-column:' || table_name || '.' || column_name AS name FROM information_schema.columns
        WHERE table_schema = current_schema() AND ((table_name = 'system_jobs' AND column_name IN ('targetImageId','targetPath','mode')) OR (table_name = 'scheduled_tasks' AND column_name IN ('time','timezone','mutexKey','lastTriggeredAt','lastTriggeredDate')))
      `)
    ])
  } catch {
    throw new Error('Unable to verify the background queue database schema')
  }

  const missingObjects: string[] = contractRows
    .filter((row) => row.name.startsWith('retired-column:'))
    .map((row) => row.name)
  for (const name of [
    'system_jobs_legacy_terminal_check',
    'system_jobs_central_lease_check',
    'system_jobs_central_skip_check',
    'system_jobs_central_schedule_check',
    'system_jobs_type_execution_lane_check',
    'availableAt_not_null'
  ]) {
    if (!contractRows.some((row) => row.name === name)) missingObjects.push(`constraint:${name}`)
  }
  if (!columnRows.some(({ columnName }) => columnName === 'definitionVersion')) {
    missingObjects.push('system_jobs.definitionVersion')
  }
  if (!columnRows.some(({ columnName }) => columnName === 'executionLane')) {
    missingObjects.push('system_jobs.executionLane')
  }
  if (!columnRows.some(({ columnName }) => columnName === 'progressData')) {
    missingObjects.push('system_jobs.progressData')
  }
  if (!columnRows.some(({ columnName }) => columnName === 'legacyDisplay')) {
    missingObjects.push('system_jobs.legacyDisplay')
  }
  if (!columnRows.some(({ columnName }) => columnName === 'Artwork.mediaRevision')) {
    missingObjects.push('Artwork.mediaRevision')
  }
  for (const columnName of [
    'archive_imports.publishedArtworkDeletedAt',
    'archive_imports.publishedArtworkPurgedAt',
    'archive_imports.phase',
    'archive_imports.origin',
    'archive_imports.generationToken',
    'archive_imports.sealedManifestSha256'
  ]) {
    if (!columnRows.some((row) => row.columnName === columnName)) missingObjects.push(columnName)
  }
  for (const retiredColumn of ['userId', 'seriesId', 'source', 'externalId']) {
    if (columnRows.some(({ columnName }) => columnName === retiredColumn)) {
      missingObjects.push(`retired-column:${retiredColumn}`)
    }
  }

  const existingTables = new Set(tableRows.map(({ tableName }) => tableName))
  for (const tableName of requiredQueueObjects) {
    if (!existingTables.has(tableName)) {
      missingObjects.push(tableName)
    }
  }

  if (!migrationRows.some(({ migrationName }) => migrationName === latestRequiredMigration)) {
    missingObjects.push(`migration:${latestRequiredMigration}`)
  }
  if (!indexRows.some(isExpectedSingleExecutionIndex)) {
    missingObjects.push('index:system_jobs_single_executing_per_lane_idx')
  }

  if (missingObjects.length > 0) {
    throw new Error(`Background queue schema is not ready: missing ${missingObjects.join(', ')}`)
  }
}

function isExpectedSingleExecutionIndex(row: QueueFenceIndexRow): boolean {
  if (
    row.indexName !== 'system_jobs_single_executing_per_lane_idx' ||
    row.keyCount !== 1 ||
    normalizeIndexKeyExpression(row.indexExpression) !== 'executionLane'
  ) {
    return false
  }

  const statuses = parseExecutingStatusPredicate(row.indexPredicate)
  return (
    statuses !== null &&
    statuses.size === 3 &&
    statuses.has('RUNNING') &&
    statuses.has('PAUSING') &&
    statuses.has('CANCELLING')
  )
}

function normalizeIndexKeyExpression(expression: string | null): string | null {
  if (expression === null) return null
  return stripOuterParentheses(expression.replace(/[\s"]/g, ''))
}

function parseExecutingStatusPredicate(predicate: string | null): Set<string> | null {
  if (predicate === null) return null
  const normalized = stripOuterParentheses(predicate.replace(/[\s"]/g, ''))
  const match = /^status=ANY\(ARRAY\[(.*)\](?:::JobStatus\[\])?\)$/i.exec(normalized)
  if (!match?.[1]) return null

  const statuses = new Set<string>()
  for (const item of match[1].split(',')) {
    const status = /^'(RUNNING|PAUSING|CANCELLING)'(?:::JobStatus)?$/i.exec(item)?.[1]
    if (!status) return null
    statuses.add(status.toUpperCase())
  }
  return statuses
}

function stripOuterParentheses(value: string): string {
  let normalized = value
  while (normalized.startsWith('(') && normalized.endsWith(')') && wrapsWholeExpression(normalized)) {
    normalized = normalized.slice(1, -1)
  }
  return normalized
}

function wrapsWholeExpression(value: string): boolean {
  let depth = 0
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1
    if (value[index] === ')') depth -= 1
    if (depth === 0 && index < value.length - 1) return false
  }
  return depth === 0
}
