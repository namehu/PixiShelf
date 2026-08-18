import { Prisma, PrismaClient } from '@prisma/client'

export { Prisma, PrismaClient }

const latestRequiredMigration = '20260818190000_add_archive_intake_retention_cleanup'

const requiredQueueObjects = [
  'archive_intake_items',
  'archive_provider_request_leases',
  'archive_provider_throttles',
  'archive_resolve_queue_control',
  'derived_media_gc_entries',
  'job_resource_leases',
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

  try {
    ;[columnRows, tableRows, migrationRows, indexRows] = await Promise.all([
      client.$queryRaw<Array<{ columnName: string }>>(Prisma.sql`
        SELECT column_name AS "columnName"
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'system_jobs'
          AND column_name IN ('definitionVersion', 'executionLane')
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
      `)
    ])
  } catch {
    throw new Error('Unable to verify the background queue database schema')
  }

  const missingObjects: string[] = []
  if (!columnRows.some(({ columnName }) => columnName === 'definitionVersion')) {
    missingObjects.push('system_jobs.definitionVersion')
  }
  if (!columnRows.some(({ columnName }) => columnName === 'executionLane')) {
    missingObjects.push('system_jobs.executionLane')
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
