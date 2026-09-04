import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

const url =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const database = url ? new PrismaClient({ datasourceUrl: url }) : null
const rollback = new Error('rollback isolated migration schema')
const migration = new URL(
  '../../prisma/migrations/20260904180000_add_archive_title_search/migration.sql',
  import.meta.url
)

describe.skipIf(!database)('title search expand migration', () => {
  afterAll(async () => database?.$disconnect())

  it.each([false, true])('preserves legacy data and refuses active writers (active=%s)', async (active) => {
    const sql = (await readFile(migration, 'utf8')).replace(/^BEGIN;\s*/, '').replace(/\s*COMMIT;\s*$/, '')
    const schema = `title_search_${randomUUID().replaceAll('-', '')}`
    const execution = database!.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
        for (const statement of [
          'CREATE TABLE archive_uploader_sources (id TEXT PRIMARY KEY, "identityKind" TEXT NOT NULL, "identityValue" TEXT NOT NULL, "normalizedIdentity" TEXT NOT NULL, "uploaderUid" TEXT, "uidRevalidationRequiredAt" TIMESTAMP, "latestSeenExternalId" TEXT, "historyCursor" TEXT)',
          'CREATE TABLE archive_uploader_scan_runs (id TEXT PRIMARY KEY, "sourceId" TEXT REFERENCES archive_uploader_sources(id), status TEXT, "searchIdentityKind" TEXT NOT NULL, "searchIdentityValue" TEXT NOT NULL, "itemCount" INT)',
          'CREATE TABLE archive_uploader_scan_items (id TEXT PRIMARY KEY, "runId" TEXT REFERENCES archive_uploader_scan_runs(id))',
          'CREATE TABLE archive_uploader_catalog_items (id TEXT PRIMARY KEY, "sourceId" TEXT REFERENCES archive_uploader_sources(id))',
          'CREATE TABLE system_jobs (type TEXT, "executionLane" TEXT, CONSTRAINT system_jobs_type_execution_lane_check CHECK (true))',
          `INSERT INTO archive_uploader_sources VALUES ('legacy', 'UID', '123', '123', '123', NULL, '300', 'old-cursor')`,
          `INSERT INTO archive_uploader_scan_runs VALUES ('run', 'legacy', '${active ? 'RUNNING' : 'COMPLETED'}', 'UID', '123', 8)`,
          `INSERT INTO archive_uploader_scan_items VALUES ('snapshot', 'run')`,
          `INSERT INTO archive_uploader_catalog_items VALUES ('catalog', 'legacy')`
        ])
          await tx.$executeRawUnsafe(statement)

        // This migration has one DO block followed by ordinary DDL/DML statements.
        for (const statement of sql.trim().split(/;\s*(?=(?:CREATE|ALTER|UPDATE)\b)/)) {
          await tx.$executeRawUnsafe(statement)
        }
        expect(active).toBe(false)
        expect(await tx.$queryRawUnsafe('SELECT * FROM archive_uploader_sources')).toEqual([
          expect.objectContaining({
            id: 'legacy',
            sourceKind: 'UPLOADER',
            uploaderUid: '123',
            latestSeenExternalId: '300',
            historyCursor: 'old-cursor',
            titleQuery: null
          })
        ])
        expect(await tx.$queryRawUnsafe('SELECT * FROM archive_uploader_scan_runs')).toEqual([
          expect.objectContaining({
            id: 'run',
            sourceId: 'legacy',
            checkedCount: 8,
            matchedCount: 8,
            searchIdentityValue: '123'
          })
        ])
        expect(await tx.$queryRawUnsafe('SELECT * FROM archive_uploader_catalog_items')).toEqual([
          { id: 'catalog', sourceId: 'legacy', matchesQuery: true }
        ])
        expect(await tx.$queryRawUnsafe('SELECT * FROM archive_uploader_scan_items')).toEqual([
          { id: 'snapshot', runId: 'run', matchesQuery: true }
        ])
        throw rollback
      },
      { timeout: 20_000 }
    )
    if (active)
      await expect(execution).rejects.toThrow('title search migration requires discovery scans to be terminal')
    else await expect(execution).rejects.toBe(rollback)
    const schemas = await database!.$queryRawUnsafe<unknown[]>(
      'SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1',
      schema
    )
    expect(schemas).toEqual([])
  })
})
