import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { PrismaClient } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const url =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const admin = url ? new PrismaClient({ datasourceUrl: url }) : null
const run = promisify(execFile)
const migration = '20261011000000_background_task_retirement_contract'
let db: PrismaClient
let schema: string
let fixtureUrl: string
const sql = await readFile(new URL(`../../prisma/migrations/${migration}/migration.sql`, import.meta.url), 'utf8')
const block = sql.match(/DO \$retirement\$[\s\S]*?\$retirement\$;/)![0]
const statements = sql
  .replace(block, '__GUARD__;')
  .replace(/^--.*$/gm, '')
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s && s !== 'BEGIN' && s !== 'COMMIT')
  .map((s) => (s === '__GUARD__' ? block : s))
async function migrate() {
  await db.$transaction(async (tx) => {
    for (const statement of statements) await tx.$executeRawUnsafe(statement)
  })
}
async function audit(mode: string) {
  try {
    const result = await run(
      process.execPath,
      [new URL('../../maintenance/audit-background-task-retirement.mjs', import.meta.url).pathname, mode],
      { env: { ...process.env, DATABASE_URL: fixtureUrl } }
    )
    return { code: 0, report: JSON.parse(result.stdout) }
  } catch (error) {
    const failed = error as { code: number; stdout: string }
    return { code: failed.code, report: JSON.parse(failed.stdout) }
  }
}

describe.skipIf(!admin)('phase two retirement contract', () => {
  beforeEach(async () => {
    schema = `contract_${randomUUID().replaceAll('-', '')}`
    await admin!.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    const target = new URL(url!)
    target.searchParams.set('schema', schema)
    fixtureUrl = target.toString()
    db = new PrismaClient({ datasourceUrl: fixtureUrl })
    await db.$executeRawUnsafe(
      `CREATE TABLE system_jobs (id text PRIMARY KEY, type text NOT NULL DEFAULT 'SCAN', "definitionVersion" int NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'PENDING', "triggerSource" text NOT NULL DEFAULT 'SYSTEM', payload jsonb, "legacyDisplay" jsonb, "targetImageId" int, "targetPath" text, mode text, "availableAt" timestamp, "createdAt" timestamp NOT NULL DEFAULT '2020-01-01', "workerId" text, "leaseToken" uuid, "leaseExpiresAt" timestamp, "skipReason" text, "skippedAt" timestamp, "scheduledTaskId" text, "scheduledForDate" text)`
    )
    await db.$executeRawUnsafe(
      `CREATE TABLE scheduled_tasks (id text PRIMARY KEY, time text, timezone text, "mutexKey" text, "lastTriggeredAt" timestamp, "lastTriggeredDate" text)`
    )
    await db.$executeRawUnsafe(
      `ALTER TABLE system_jobs ADD CONSTRAINT "system_jobs_scheduledTaskId_fkey" FOREIGN KEY ("scheduledTaskId") REFERENCES scheduled_tasks(id) ON DELETE SET NULL`
    )
    await db.$executeRawUnsafe(
      `CREATE TABLE system_job_failure_acknowledgements ("jobId" text PRIMARY KEY REFERENCES system_jobs(id) ON DELETE CASCADE, source text NOT NULL, "acknowledgedAt" timestamp NOT NULL)`
    )
    await db.$executeRawUnsafe(`CREATE TABLE job_resource_leases ("resourceKey" text, "expiresAt" timestamp)`)
    await db.$executeRawUnsafe(
      `CREATE TABLE _prisma_migrations (migration_name text, finished_at timestamp, rolled_back_at timestamp)`
    )
    await db.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations VALUES ('20261007100000_background_task_retirement_read_model', now(), null)`
    )
  })
  afterEach(async () => {
    await db?.$disconnect()
    await admin!.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
  })

  it('preserves history and backfills availability, audits both versions, and blocks automatic startup before explicit migration', async () => {
    await db.$executeRawUnsafe(
      `INSERT INTO system_jobs (id,"definitionVersion",status,"targetPath","legacyDisplay") VALUES ('old',0,'FAILED','旧/视频.mp4','{"schemaVersion":1,"targetImageId":null,"targetPath":"旧/视频.mp4","mode":null}'), ('new',1,'PENDING',null,null)`
    )
    await db.$executeRawUnsafe(
      `INSERT INTO system_jobs (id,status,"triggerSource","scheduledForDate") VALUES ('deleted-plan','COMPLETED','SCHEDULE','2026-10-10')`
    )
    await db.$executeRawUnsafe(`INSERT INTO system_job_failure_acknowledgements VALUES ('old','MANUAL','2026-10-01')`)
    await db.$executeRawUnsafe(
      `INSERT INTO scheduled_tasks (id,time,timezone) VALUES ('retained-plan','01:00','Asia/Shanghai')`
    )
    await db.$executeRawUnsafe(
      `INSERT INTO system_jobs (id,status,"triggerSource","scheduledTaskId","scheduledForDate") VALUES ('linked-plan-job','COMPLETED','SCHEDULE','retained-plan','2026-10-09')`
    )
    const acknowledgementsBefore = await db.$queryRawUnsafe('SELECT * FROM system_job_failure_acknowledgements')
    const linkedJobBefore = await db.$queryRawUnsafe(
      `SELECT id,status,"triggerSource","scheduledTaskId","scheduledForDate" FROM system_jobs WHERE id='linked-plan-job'`
    )
    expect((await audit('--phase2-before')).code).toBe(0)
    expect((await audit('guard-startup')).code).toBe(1)
    await migrate()
    await db.$executeRawUnsafe(`INSERT INTO _prisma_migrations VALUES ('${migration}', now(), null)`)
    expect((await audit('--phase2-after')).code).toBe(0)
    expect((await audit('guard-startup')).code).toBe(0)
    const rows = await db.$queryRawUnsafe<
      Array<{ id: string; availableAt: Date; createdAt: Date; legacyDisplay: unknown }>
    >('SELECT id,"availableAt","createdAt","legacyDisplay" FROM system_jobs ORDER BY id')
    expect(rows.every((row) => row.availableAt.getTime() === row.createdAt.getTime())).toBe(true)
    expect(rows.find((row) => row.id === 'old')?.legacyDisplay).toMatchObject({ targetPath: '旧/视频.mp4' })
    expect(await db.$queryRawUnsafe('SELECT * FROM system_job_failure_acknowledgements')).toEqual(
      acknowledgementsBefore
    )
    expect(
      await db.$queryRawUnsafe(
        `SELECT id,status,"triggerSource","scheduledTaskId","scheduledForDate" FROM system_jobs WHERE id='linked-plan-job'`
      )
    ).toEqual(linkedJobBefore)
    await db.$executeRawUnsafe(`DELETE FROM scheduled_tasks WHERE id='retained-plan'`)
    expect(
      await db.$queryRawUnsafe(
        `SELECT status,"triggerSource","scheduledTaskId","scheduledForDate" FROM system_jobs WHERE id='linked-plan-job'`
      )
    ).toEqual([
      { status: 'COMPLETED', triggerSource: 'SCHEDULE', scheduledTaskId: null, scheduledForDate: '2026-10-09' }
    ])
    expect((await audit('--phase2-after')).code).toBe(0)
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO system_jobs (id,"availableAt",status,"triggerSource","scheduledForDate") VALUES ('plan2',now(),'PENDING','SCHEDULE','2026-10-11')`
      )
    ).resolves.toBe(1)
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO system_jobs (id,"availableAt",status,"workerId","leaseToken","leaseExpiresAt") VALUES ('running',now(),'RUNNING','w','11111111-1111-1111-1111-111111111111',now())`
      )
    ).resolves.toBe(1)
  })

  it.each([
    ['executing', `status='RUNNING'`],
    ['lease', `"workerId"='stale'`],
    ['skip', `status='SKIPPED'`],
    ['stray skip', `"skipReason"='STALE'`],
    ['schedule', `"triggerSource"='SCHEDULE'`],
    ['stray schedule', `"scheduledForDate"='2026-10-11'`],
    ['legacy active', `"definitionVersion"=0`],
    ['legacy snapshot', `"definitionVersion"=0,status='FAILED'`],
    ['projection', `type='VIDEO_KEYFRAME_GENERATION',payload='{"imageId":12}'`]
  ])('blocks %s and rolls back all schema changes', async (_, assignment) => {
    await db.$executeRawUnsafe(`INSERT INTO system_jobs (id) VALUES ('bad')`)
    await db.$executeRawUnsafe(`UPDATE system_jobs SET ${assignment} WHERE id='bad'`)
    expect((await audit('--phase2-before')).code).toBe(1)
    await expect(migrate()).rejects.toThrow('Background task retirement blocked')
    expect(await db.$queryRawUnsafe(`SELECT "targetImageId" FROM system_jobs`)).toEqual([{ targetImageId: null }])
    expect(await db.$queryRawUnsafe(`SELECT "availableAt" FROM system_jobs`)).toEqual([{ availableAt: null }])
  })

  it('blocks live resource leases even when no job is running', async () => {
    await db.$executeRawUnsafe(`INSERT INTO job_resource_leases VALUES ('lane',now()+interval '1 hour')`)
    expect((await audit('--phase2-before')).code).toBe(1)
    await expect(migrate()).rejects.toThrow('live_resource_leases')
  })
  it('enforces new writes and permits empty database startup', async () => {
    await migrate()
    for (const values of ["'invalid',null,'PENDING'", "'invalid',now(),'RUNNING'", "'invalid',now(),'SKIPPED'"]) {
      await expect(
        db.$executeRawUnsafe(`INSERT INTO system_jobs (id,"availableAt",status) VALUES (${values})`)
      ).rejects.toThrow()
    }
    await db.$executeRawUnsafe(
      'DROP TABLE system_job_failure_acknowledgements, system_jobs, scheduled_tasks, job_resource_leases'
    )
    expect((await audit('guard-startup')).code).toBe(0)
  })
})
