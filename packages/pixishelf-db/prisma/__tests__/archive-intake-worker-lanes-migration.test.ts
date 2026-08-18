import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const prismaDirectory = path.resolve(process.cwd(), 'prisma')
const migration = readFileSync(
  path.join(prismaDirectory, 'migrations/20260818120000_add_archive_intake_worker_lanes/migration.sql'),
  'utf8'
)
const schema = readFileSync(path.join(prismaDirectory, 'schema.prisma'), 'utf8')
const requestHashMigration = readFileSync(
  path.join(prismaDirectory, 'migrations/20260818170000_add_archive_operation_request_hashes/migration.sql'),
  'utf8'
)
const maintenanceMigration = readFileSync(
  path.join(prismaDirectory, 'migrations/20260818180000_add_archive_maintenance_worker_job/migration.sql'),
  'utf8'
)

describe('archive intake Worker lanes migration', () => {
  it('replaces the global execution fence with a per-lane partial unique index', () => {
    expect(migration).toContain('ADD COLUMN "executionLane" "JobExecutionLane" NOT NULL')
    expect(migration).toContain('UPDATE "system_jobs" SET "executionLane" = \'BACKGROUND_WRITER\'')
    expect(migration).toContain('CONSTRAINT "system_jobs_type_execution_lane_check" CHECK')
    expect(migration).toContain('"type" = \'ARCHIVE_RESOLVE_ITEM\'')
    expect(migration).toContain('"executionLane" = \'ARCHIVE_RESOLVE\'')
    expect(migration).toContain('"type" <> \'ARCHIVE_RESOLVE_ITEM\'')
    expect(migration).toContain('DROP INDEX "system_jobs_single_executing_job_idx"')
    expect(migration).toContain('CREATE UNIQUE INDEX "system_jobs_single_executing_per_lane_idx"')
    expect(migration).toContain('ON "system_jobs" ("executionLane")')
    expect(migration).toContain(`WHERE "status" IN ('RUNNING', 'PAUSING', 'CANCELLING')`)
  })

  it('creates durable intake, bulk audit, pause, and provider throttle state', () => {
    for (const table of [
      'archive_intake_submissions',
      'archive_intake_items',
      'archive_bulk_operations',
      'archive_bulk_operation_items',
      'archive_resolve_queue_control',
      'archive_provider_throttles',
      'archive_provider_request_leases'
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`)
    }
    expect(migration).toContain('archive_intake_items_active_url_hash_idx')
    expect(migration).toContain('archive_intake_items_active_identity_idx')
    expect(migration).toContain('"queueOrder" BIGSERIAL NOT NULL')
    expect(migration).toContain('INSERT INTO "archive_resolve_queue_control"')
  })

  it('keeps Prisma lane and intake models aligned with the migration', () => {
    expect(schema).toMatch(/executionLane\s+JobExecutionLane\s+@default\(BACKGROUND_WRITER\)/)
    expect(schema).toContain('model ArchiveIntakeSubmission {')
    expect(schema).toContain('model ArchiveIntakeItem {')
    expect(schema).toContain('model ArchiveBulkOperation {')
    expect(schema).toContain('model ArchiveProviderThrottle {')
    expect(schema).toMatch(/queueOrder\s+BigInt\s+@unique @default\(autoincrement\(\)\)/)
  })

  it('adds semantic idempotency fingerprints with an expand-safe legacy backfill', () => {
    for (const table of ['archive_intake_submissions', 'archive_bulk_operations']) {
      const addColumn = requestHashMigration.indexOf(`ALTER TABLE "${table}"\n  ADD COLUMN "requestHash" VARCHAR(64);`)
      const backfill = requestHashMigration.indexOf(`UPDATE "${table}"`)
      const required = requestHashMigration.indexOf(
        `ALTER TABLE "${table}"\n  ALTER COLUMN "requestHash" SET NOT NULL;`
      )
      expect(addColumn).toBeGreaterThanOrEqual(0)
      expect(backfill).toBeGreaterThan(addColumn)
      expect(required).toBeGreaterThan(backfill)
    }
    expect(requestHashMigration).toContain('md5("idempotencyKey") || md5(')
    expect(requestHashMigration).toContain(`CHECK ("requestHash" ~ '^[a-f0-9]{64}$')`)
    expect(schema).toMatch(/model ArchiveIntakeSubmission \{[\s\S]*requestHash\s+String\s+@db\.VarChar\(64\)/)
    expect(schema).toMatch(/model ArchiveBulkOperation \{[\s\S]*requestHash\s+String\s+@db\.VarChar\(64\)/)
  })

  it('adds an expand-safe writer-lane guard for archive maintenance jobs', () => {
    expect(maintenanceMigration).toContain('ADD CONSTRAINT "system_jobs_archive_maintenance_lane_check"')
    expect(maintenanceMigration).toContain('"type" <> \'ARCHIVE_MAINTENANCE\'')
    expect(maintenanceMigration).toContain('"executionLane" = \'BACKGROUND_WRITER\'')
    expect(maintenanceMigration).toContain('NOT VALID')
    expect(maintenanceMigration).toContain('VALIDATE CONSTRAINT "system_jobs_archive_maintenance_lane_check"')
  })
})
