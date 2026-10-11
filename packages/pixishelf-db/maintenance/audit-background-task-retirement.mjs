#!/usr/bin/env node
// Read-only pre/post upgrade audit. This command never repairs jobs or acknowledges failures.
import { phase1Migration, phase2Migration, contractChecks, invalidSnapshot } from './background-task-contract.mjs'
const args = process.argv.slice(2)
if (
  args.length !== 1 ||
  !['--before', '--after', '--phase2-before', '--phase2-after', 'guard-startup', '--help'].includes(args[0])
) {
  console.error(
    'Usage: node maintenance/audit-background-task-retirement.mjs --before|--after|--phase2-before|--phase2-after|guard-startup'
  )
  process.exitCode = 2
} else if (args[0] === '--help') {
  console.log(
    'Read-only audit. --before/--after retain phase-1 checks. --phase2-before/--phase2-after audit destructive retirement. guard-startup blocks automatic destructive migration of existing databases. Stop all writers first. DATABASE_URL is required.'
  )
} else if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required; no database was opened.')
  process.exitCode = 2
} else {
  const { PrismaClient } = await import('@prisma/client')
  const db = new PrismaClient()
  try {
    const report = await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        if (args[0] === 'guard-startup') {
          const tables = await tx.$queryRawUnsafe(
            `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`
          )
          if (tables.length === 0) return { mode: 'guard-startup', ready: true, emptyDatabase: true }
          const migrationTable = await tx.$queryRawUnsafe(
            `SELECT to_regclass(format('%I._prisma_migrations', current_schema()))::text AS name`
          )
          const migrations = migrationTable[0]?.name
            ? await tx.$queryRawUnsafe(
                `SELECT migration_name FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
                phase2Migration
              )
            : []
          const retiredColumns = await tx.$queryRawUnsafe(
            `SELECT table_name || '.' || column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND ((table_name = 'system_jobs' AND column_name IN ('targetImageId','targetPath','mode')) OR (table_name = 'scheduled_tasks' AND column_name IN ('time','timezone','mutexKey','lastTriggeredAt','lastTriggeredDate')))`
          )
          const constraints = await tx.$queryRawUnsafe(
            `SELECT c.conname AS name FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = current_schema() AND t.relname = 'system_jobs' AND c.contype = 'c' AND c.convalidated`
          )
          const missingConstraints = Object.keys(contractChecks).filter(
            (name) => !constraints.some((row) => row.name === name)
          )
          const availability = await tx.$queryRawUnsafe(
            `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'system_jobs' AND column_name = 'availableAt' AND is_nullable = 'NO'`
          )
          return {
            mode: 'guard-startup',
            ready:
              migrations.length === 1 &&
              retiredColumns.length === 0 &&
              missingConstraints.length === 0 &&
              availability.length === 1,
            requiredMigration: phase2Migration,
            retiredColumns,
            missingConstraints,
            availableAtNotNull: availability.length === 1
          }
        }
        const phase2 = args[0].startsWith('--phase2-')
        const after = args[0] === '--phase2-after'
        const baseline = await tx.$queryRawUnsafe(
          `SELECT migration_name FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
          phase2 ? (after ? phase2Migration : phase1Migration) : '20261007000000_delete_archive_failed_records'
        )
        const checks = []
        async function check(name, sql) {
          const rows = await tx.$queryRawUnsafe(
            `SELECT id, count(*) OVER ()::int AS total FROM (${sql}) problems LIMIT 20`
          )
          checks.push({ name, count: rows[0]?.total ?? 0, sampleIds: rows.map((row) => row.id) })
        }
        await check(
          'executing_jobs',
          `SELECT id FROM system_jobs WHERE status IN ('RUNNING','PAUSING','CANCELLING') ORDER BY id`
        )
        await check(
          'live_resource_leases',
          `SELECT "resourceKey" AS id FROM job_resource_leases WHERE "expiresAt" > CURRENT_TIMESTAMP ORDER BY "resourceKey"`
        )
        await check(
          'legacy_nonterminal_jobs',
          `SELECT id FROM system_jobs WHERE "definitionVersion" = 0 AND status NOT IN ('COMPLETED','FAILED','CANCELLED','SKIPPED') ORDER BY id`
        )
        if (args[0] === '--after' || (phase2 && !after)) {
          await check(
            'legacy_snapshot_mismatch',
            `SELECT id FROM system_jobs WHERE "definitionVersion" = 0 AND "legacyDisplay" IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'targetImageId',"targetImageId",'targetPath',"targetPath",'mode',mode) ORDER BY id`
          )
          await check(
            'rollback_projection_mismatch',
            `SELECT id FROM system_jobs WHERE "definitionVersion" = 1 AND type IN ('VIDEO_KEYFRAME_GENERATION','VIDEO_STREAMING_OPTIMIZATION') AND (to_jsonb("targetImageId") IS DISTINCT FROM payload->'imageId' OR "targetPath" IS DISTINCT FROM payload->>'relativePath' OR mode IS DISTINCT FROM payload->>'mode') ORDER BY id`
          )
        }
        if (phase2) {
          for (const [name, sql] of Object.entries(contractChecks)) {
            await check(name, `SELECT id FROM system_jobs WHERE NOT (${sql}) ORDER BY id`)
          }
          await check('invalid_legacy_snapshot', `SELECT id FROM system_jobs WHERE ${invalidSnapshot} ORDER BY id`)
          if (after) {
            await check('null_available_at', `SELECT id FROM system_jobs WHERE "availableAt" IS NULL ORDER BY id`)
            await check(
              'retired_columns',
              `SELECT table_name || '.' || column_name AS id FROM information_schema.columns WHERE table_schema = current_schema() AND ((table_name = 'system_jobs' AND column_name IN ('targetImageId','targetPath','mode')) OR (table_name = 'scheduled_tasks' AND column_name IN ('time','timezone','mutexKey','lastTriggeredAt','lastTriggeredDate')))`
            )
            await check(
              'retired_indexes',
              `SELECT indexname AS id FROM pg_indexes WHERE schemaname = current_schema() AND indexname IN ('system_jobs_type_targetImageId_createdAt_idx','scheduled_tasks_mutexKey_idx')`
            )
            await check(
              'missing_validated_constraints',
              `SELECT name AS id FROM (VALUES ${Object.keys(contractChecks)
                .map((name) => `('${name}')`)
                .join(
                  ','
                )}) required(name) WHERE NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = current_schema() AND t.relname = 'system_jobs' AND c.conname = required.name AND c.contype = 'c' AND c.convalidated)`
            )
            await check(
              'nullable_available_at',
              `SELECT 'system_jobs.availableAt' AS id WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'system_jobs' AND column_name = 'availableAt' AND is_nullable = 'NO')`
            )
          }
        }
        return {
          phase: phase2 ? 2 : 1,
          mode: args[0].slice(2),
          baselineMigrationPresent: baseline.length === 1,
          checks,
          ready: baseline.length === 1 && checks.every((check) => check.count === 0),
          operatorChecks: [
            'App, Worker and external writers are stopped',
            'Matching database/media/config/image recovery checkpoint exists'
          ]
        }
      },
      { maxWait: 10_000, timeout: 120_000 }
    )
    console.log(JSON.stringify(report, null, 2))
    if (!report.ready) process.exitCode = 1
  } catch {
    console.error('Audit failed. Verify database access and the expected migration chain; no data was changed.')
    process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}
