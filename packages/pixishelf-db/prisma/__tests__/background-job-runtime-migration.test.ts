import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const prismaDirectory = path.resolve(process.cwd(), 'prisma')
const schema = readFileSync(path.join(prismaDirectory, 'schema.prisma'), 'utf8')
const enumMigration = readFileSync(
  path.join(
    prismaDirectory,
    'migrations/20260814090000_add_background_task_enums/migration.sql',
  ),
  'utf8',
)
const queueMigration = readFileSync(
  path.join(
    prismaDirectory,
    'migrations/20260814091000_add_background_task_queue_schema/migration.sql',
  ),
  'utf8',
)

describe('background job runtime migration contract', () => {
  it('keeps new enum values in a migration before structural use', () => {
    const enumTransactionStart = enumMigration.indexOf('BEGIN;')
    const enumTransactionEnd = enumMigration.lastIndexOf('COMMIT;')

    expect(enumTransactionStart).toBeGreaterThanOrEqual(0)
    expect(enumTransactionEnd).toBeGreaterThan(enumTransactionStart)
    expect(enumMigration.slice(enumTransactionEnd + 'COMMIT;'.length).trim()).toBe('')

    for (const enumName of [
      'JobTriggerSource',
      'JobSkipReason',
      'JobEventLevel',
      'GcEntryStatus',
    ]) {
      expect(enumMigration).toContain(`CREATE TYPE "${enumName}" AS ENUM`)
    }

    expect(enumMigration).toContain(
      `ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'RETRY_WAIT'`,
    )
    expect(enumMigration).toContain(
      `ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'SKIPPED'`,
    )
    expect(enumMigration).not.toMatch(/CREATE TABLE|ALTER TABLE|\b(?:UPDATE|DELETE|INSERT)\b/)
    expect(queueMigration).not.toMatch(/CREATE TYPE|ALTER TYPE/)
  })

  it('runs the complete read-only cutover guard before every structural or data write', () => {
    const transactionStart = queueMigration.indexOf('BEGIN;')
    const guardStart = queueMigration.indexOf('DO $$')
    const guardEnd = queueMigration.indexOf('$$;', guardStart)
    const firstWrite = queueMigration.search(
      /(?:ALTER|CREATE|DROP) (?:TABLE|INDEX)|\b(?:UPDATE|DELETE FROM|INSERT INTO)\b/,
    )
    const transactionEnd = queueMigration.lastIndexOf('COMMIT;')

    expect(transactionStart).toBeGreaterThanOrEqual(0)
    expect(transactionStart).toBeLessThan(guardStart)
    expect(guardStart).toBeGreaterThanOrEqual(0)
    expect(guardEnd).toBeGreaterThan(guardStart)
    expect(firstWrite).toBeGreaterThan(guardEnd)
    expect(transactionEnd).toBeGreaterThan(firstWrite)
    expect(queueMigration.slice(transactionEnd + 'COMMIT;'.length).trim()).toBe('')

    for (const category of [
      'system_jobs',
      'archive_imports',
      'archive_import_items',
      'scan_runs',
      'pending_replace_batches',
      'pending_replace_items',
      'video_probes',
      'video_posters',
      'chapter_previews',
      'keyframe_staging_sets',
      'keyframe_frames',
      'archive_lifecycle',
    ]) {
      expect(queueMigration.slice(guardStart, guardEnd)).toContain(`'${category}'`)
    }

    const guard = queueMigration.slice(guardStart, guardEnd)
    expect(guard).toContain(`keyframe_set."systemJobId" IS NULL`)
    expect(guard).toContain(`linked_job."id" IS NULL`)
    expect(guard).toContain(`linked_job."status"::TEXT NOT IN`)
    expect(guard).toContain(`'RESTORE_SWAPPING'`)
    expect(guard).toContain(`"archiveLifecycleState"::TEXT IN ('TRASHING', 'RESTORING')`)
  })

  it('preserves old jobs as terminal legacy history and copies scheduler cursors', () => {
    expect(queueMigration).toMatch(
      /UPDATE "system_jobs"[\s\S]*"definitionVersion" = 0[\s\S]*"triggerSource" = 'LEGACY'/,
    )
    expect(queueMigration).toContain(
      `"effectivePriority" = "queuePriority"`,
    )
    expect(queueMigration).toContain(
      `"availableAt" = COALESCE("availableAt", "createdAt", CURRENT_TIMESTAMP)`,
    )
    expect(queueMigration).toContain(
      `"maxAttempts" = GREATEST(3, "attempt")`,
    )
    expect(queueMigration).toContain(
      `"lastMaterializedAt" = "lastTriggeredAt"`,
    )
    expect(queueMigration).toContain(
      `"lastMaterializedDate" = "lastTriggeredDate"`,
    )
  })

  it('does not mutate artwork, media, archive, scan, or replacement domain data', () => {
    const forbiddenDomainTables = [
      'Artwork',
      'Image',
      'MediaVideoMetadata',
      'MediaChapterPreview',
      'MediaVideoKeyframeSet',
      'MediaVideoKeyframe',
      'archive_imports',
      'archive_import_items',
      'archive_revisions',
      'scan_runs',
      'scan_run_items',
      'pending_replace_batches',
      'pending_replace_items',
    ]

    for (const table of forbiddenDomainTables) {
      const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      expect(queueMigration).not.toMatch(
        new RegExp(`(?:UPDATE|DELETE\\s+FROM|INSERT\\s+INTO)\\s+"${escapedTable}"`, 'i'),
      )
    }
  })

  it('creates the durable queue tables, indexes, foreign keys, and safe checks', () => {
    for (const table of [
      'system_job_events',
      'job_resource_leases',
      'derived_media_gc_entries',
    ]) {
      expect(queueMigration).toContain(`CREATE TABLE "${table}"`)
    }

    for (const requiredFragment of [
      'system_jobs_idempotencyKey_key',
      'system_jobs_scheduledTaskId_scheduledForDate_key',
      'system_jobs_status_effectivePriority_availableAt_createdAt_idx',
      'system_jobs_status_deadlineAt_idx',
      'system_jobs_status_leaseExpiresAt_idx',
      'system_jobs_scheduledTaskId_createdAt_idx',
      'system_job_events_jobId_id_idx',
      'job_resource_leases_ownerJobId_idx',
      'derived_media_gc_entries_mediaKind_relativePath_key',
      'derived_media_gc_entries_status_notBefore_createdAt_idx',
      'derived_media_gc_entries_lastSystemJobId_idx',
      'system_jobs_scheduledTaskId_fkey',
      'system_job_events_jobId_fkey',
      'job_resource_leases_ownerJobId_fkey',
      'derived_media_gc_entries_lastSystemJobId_fkey',
      'system_jobs_progress_check',
      'system_jobs_attempt_check',
      'system_jobs_max_attempts_check',
      'system_jobs_definition_version_check',
      'system_job_events_progress_check',
      'derived_media_gc_entries_attempt_check',
      'derived_media_gc_entries_max_attempts_check',
    ]) {
      expect(queueMigration).toContain(requiredFragment)
    }

    for (const legacyCheck of [
      'system_jobs_progress_check',
      'system_jobs_attempt_check',
      'system_jobs_max_attempts_check',
      'system_jobs_definition_version_check',
    ]) {
      expect(queueMigration).toMatch(
        new RegExp(`CONSTRAINT "${legacyCheck}" CHECK \\(.*\\) NOT VALID`),
      )
    }

    expect(queueMigration).not.toContain('targetImageId_type_status_idx')
    expect(queueMigration).toMatch(/"notBefore" TIMESTAMP\(3\) NOT NULL,/) // no unsafe immediate-delete default
  })

  it('keeps availableAt nullable during the legacy keyframe compatibility phase', () => {
    expect(queueMigration).toContain(
      `ALTER COLUMN "availableAt" SET DEFAULT CURRENT_TIMESTAMP`,
    )
    expect(queueMigration).not.toMatch(
      /ALTER COLUMN "availableAt" SET NOT NULL/,
    )
    expect(schema).toMatch(/availableAt\s+DateTime\?\s+@default\(now\(\)\)/)
  })

  it('keeps the Prisma schema aligned with the migration contract', () => {
    expect(prismaDirectory).toMatch(/[\\/]prisma$/)
    expect(schema).toMatch(/model SystemJob[\s\S]*type\s+String\s+@db\.VarChar\(80\)/)
    expect(schema).toMatch(/definitionVersion\s+Int\s+@default\(1\)/)
    expect(schema).toMatch(/triggerSource\s+JobTriggerSource\s+@default\(SYSTEM\)/)
    expect(schema).toMatch(/idempotencyKey\s+String\?\s+@unique\s+@db\.VarChar\(180\)/)
    expect(schema).toMatch(/leaseToken\s+String\?\s+@db\.Uuid/)
    expect(schema).toContain('@@unique([scheduledTaskId, scheduledForDate])')
    expect(schema).toContain('@@index([status, effectivePriority, availableAt, createdAt])')
    expect(schema).toContain('@@index([status, deadlineAt])')
    expect(schema).toContain('@@index([status, leaseExpiresAt])')
    expect(schema).toContain('@@index([scheduledTaskId, createdAt])')

    for (const model of [
      'SystemJobEvent',
      'JobResourceLease',
      'DerivedMediaGcEntry',
    ]) {
      expect(schema).toContain(`model ${model} {`)
    }
    expect(schema).toMatch(/notBefore\s+DateTime\s*\n/)
    expect(schema).toMatch(/model ScheduledTask[\s\S]*type\s+String\s+@db\.VarChar\(80\)/)
    expect(schema).toContain('lastMaterializedAt')
    expect(schema).toContain('lastMaterializedDate')
    expect(schema).toMatch(/jobs\s+SystemJob\[\]/)
  })
})
