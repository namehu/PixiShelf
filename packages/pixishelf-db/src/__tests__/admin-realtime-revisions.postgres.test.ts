import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const admin = url ? new PrismaClient({ datasourceUrl: url }) : null
const schema = `realtime_${randomUUID().replaceAll('-', '')}`
let db: PrismaClient
const sql = await readFile(
  new URL('../../prisma/migrations/20261111000000_admin_realtime_revisions/migration.sql', import.meta.url),
  'utf8'
)
const fn = sql.match(/CREATE FUNCTION[\s\S]*?END \$\$;/)![0]
const statements = sql
  .replace(fn, '__FUNCTION__;')
  .replace(/^--.*$/gm, '')
  .split(';')
  .map((value) => value.trim())
  .filter((value) => value && value !== 'BEGIN' && value !== 'COMMIT')
  .map((value) => (value === '__FUNCTION__' ? fn : value))

describe.skipIf(!admin)('admin realtime migration', () => {
  beforeAll(async () => {
    await admin!.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    const target = new URL(url!)
    target.searchParams.set('schema', schema)
    db = new PrismaClient({ datasourceUrl: target.toString() })
    for (const statement of [
      'CREATE TABLE archive_intake_items (id text PRIMARY KEY, status text, "expiresAt" timestamp, "updatedAt" timestamp)',
      'CREATE TABLE archive_resolve_queue_control (id text PRIMARY KEY, paused boolean, "pausedAt" timestamp)',
      'CREATE TABLE archive_uploader_catalog_items (id text PRIMARY KEY, "lastIntakeItemId" text, "comparisonSnapshot" jsonb, "lastSeenAt" timestamp, title text)',
      'CREATE TABLE system_job_failure_acknowledgements ("jobId" text PRIMARY KEY)',
      'CREATE TABLE archive_imports (id text PRIMARY KEY, status text, "publishedArtworkDeletedAt" timestamp, "completedItems" int)',
      ...statements
    ])
      await db.$executeRawUnsafe(statement)
  })
  afterAll(async () => {
    await db?.$disconnect()
    if (admin) {
      await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
      await admin.$disconnect()
    }
  })
  const revision = async (resource = 'archiveInbox') =>
    (await db.adminRealtimeRevision.findUniqueOrThrow({ where: { resource } })).revision

  it('advances once for a batch, covers lifecycle states and deletes, and ignores empty writes', async () => {
    let expected = await revision()
    await db.$executeRawUnsafe(
      "INSERT INTO archive_intake_items SELECT n::text, 'QUEUED', NULL, now() FROM generate_series(1,100) n"
    )
    expect(await revision()).toBe(++expected)
    for (const status of ['RESOLVING', 'READY', 'FAILED', 'RETRY_WAIT', 'CANCELLED', 'ENQUEUED']) {
      await db.$executeRawUnsafe('UPDATE archive_intake_items SET status = $1', status)
      expect(await revision()).toBe(++expected)
    }
    await db.$executeRawUnsafe("UPDATE archive_intake_items SET status = 'FAILED' WHERE id = 'absent'")
    expect(await revision()).toBe(expected)
    await db.$executeRawUnsafe('DELETE FROM archive_intake_items')
    expect(await revision()).toBe(++expected)
  })

  it('publishes only committed changes and covers pause/resume', async () => {
    let expected = await revision()
    const rollback = new Error('rollback fixture')
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("INSERT INTO archive_intake_items VALUES ('rolled-back','READY',NULL,now())")
        expect(
          (await tx.adminRealtimeRevision.findUniqueOrThrow({ where: { resource: 'archiveInbox' } })).revision
        ).toBe(expected + 1n)
        expect(await revision()).toBe(expected)
        throw rollback
      })
    ).rejects.toBe(rollback)
    expect(await revision()).toBe(expected)
    await db.$executeRawUnsafe("INSERT INTO archive_resolve_queue_control VALUES ('queue',false,NULL)")
    expect(await revision()).toBe(++expected)
    await db.$executeRawUnsafe('UPDATE archive_resolve_queue_control SET paused=true, "pausedAt"=now()')
    expect(await revision()).toBe(++expected)
    await db.$executeRawUnsafe('UPDATE archive_resolve_queue_control SET paused=false, "pausedAt"=NULL')
    expect(await revision()).toBe(++expected)
  })

  it('covers linked source facts without invalidating for unrelated catalog edits', async () => {
    let expected = await revision()
    await db.$executeRawUnsafe("INSERT INTO archive_uploader_catalog_items VALUES ('catalog',NULL,'{}',now(),'title')")
    expect(await revision()).toBe(expected)
    await db.$executeRawUnsafe('UPDATE archive_uploader_catalog_items SET "lastIntakeItemId"=\'intake\'')
    expect(await revision()).toBe(++expected)
    await db.$executeRawUnsafe("UPDATE archive_uploader_catalog_items SET title='new title'")
    expect(await revision()).toBe(expected)
    await db.$executeRawUnsafe('UPDATE archive_uploader_catalog_items SET "comparisonSnapshot"=\'{"fileSize":42}\'')
    expect(await revision()).toBe(++expected)
    await db.$executeRawUnsafe('UPDATE archive_uploader_catalog_items SET "lastSeenAt"=now()+interval \'1 minute\'')
    expect(await revision()).toBe(++expected)
    await db.$executeRawUnsafe('DELETE FROM archive_uploader_catalog_items')
    expect(await revision()).toBe(++expected)
  })

  it('notifies dashboard acknowledgements and unfinished/archive deletion changes, not image progress', async () => {
    let expected = await revision('jobDashboard')
    await db.$executeRawUnsafe("INSERT INTO system_job_failure_acknowledgements VALUES ('job')")
    expect(await revision('jobDashboard')).toBe(++expected)
    await db.$executeRawUnsafe("INSERT INTO archive_imports VALUES ('archive','RUNNING',NULL,0)")
    expect(await revision('jobDashboard')).toBe(++expected)
    await db.$executeRawUnsafe('UPDATE archive_imports SET "completedItems"=1')
    expect(await revision('jobDashboard')).toBe(expected)
    await db.$executeRawUnsafe("UPDATE archive_imports SET status='COMPLETED'")
    expect(await revision('jobDashboard')).toBe(++expected)
    await db.$executeRawUnsafe('UPDATE archive_imports SET "publishedArtworkDeletedAt"=now()')
    expect(await revision('jobDashboard')).toBe(++expected)
  })
})
