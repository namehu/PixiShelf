#!/usr/bin/env node
// Read-only pre/post upgrade audit. This command never repairs jobs or acknowledges failures.
const args = process.argv.slice(2)
if (args.length !== 1 || !['--before', '--after', '--help'].includes(args[0])) {
  console.error('Usage: node maintenance/audit-background-task-retirement.mjs --before|--after')
  process.exitCode = 2
} else if (args[0] === '--help') {
  console.log(
    'Read-only phase-1 audit. --before checks upgrade readiness; --after also verifies historical snapshots and dual writes. Stop all writers first. DATABASE_URL is required.'
  )
} else if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required; no database was opened.')
  process.exitCode = 2
} else {
  const { PrismaClient } = await import('@prisma/client')
  const db = new PrismaClient()
  try {
    const report = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
      const baseline = await tx.$queryRawUnsafe(
        `SELECT migration_name FROM _prisma_migrations WHERE migration_name = '20261007000000_delete_archive_failed_records' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`
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
      if (args[0] === '--after') {
        await check(
          'legacy_snapshot_mismatch',
          `SELECT id FROM system_jobs WHERE "definitionVersion" = 0 AND "legacyDisplay" IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'targetImageId',"targetImageId",'targetPath',"targetPath",'mode',mode) ORDER BY id`
        )
        await check(
          'rollback_projection_mismatch',
          `SELECT id FROM system_jobs WHERE "definitionVersion" = 1 AND type IN ('VIDEO_KEYFRAME_GENERATION','VIDEO_STREAMING_OPTIMIZATION') AND (to_jsonb("targetImageId") IS DISTINCT FROM payload->'imageId' OR "targetPath" IS DISTINCT FROM payload->>'relativePath' OR mode IS DISTINCT FROM payload->>'mode') ORDER BY id`
        )
      }
      return {
        phase: 1,
        mode: args[0].slice(2),
        baselineMigrationPresent: baseline.length === 1,
        checks,
        ready: baseline.length === 1 && checks.every((check) => check.count === 0),
        operatorChecks: [
          'App, scheduler, Worker and external writers are stopped',
          'Matching database/media/config/image recovery checkpoint exists'
        ]
      }
    })
    console.log(JSON.stringify(report, null, 2))
    if (!report.ready) process.exitCode = 1
  } catch {
    console.error('Audit failed. Verify database access and the expected migration chain; no data was changed.')
    process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}
