import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const rollback = new Error('rollback isolated schema')
describe.skipIf(!db)('title rules historical migration', () => {
  afterAll(async () => db?.$disconnect())
  it('preserves membership, source identity and coverage while adding equivalent rules and invalidation', async () => {
    const schema = `title_rules_${randomUUID().replaceAll('-', '')}`
    const sql = (
      await readFile(
        new URL('../../prisma/migrations/20261022000000_archive_title_rules/migration.sql', import.meta.url),
        'utf8'
      )
    )
      .replace(/^BEGIN;\s*/, '')
      .replace(/\s*COMMIT;\s*$/, '')
      .replace(/^--.*$/gm, '')
    await expect(
      db!.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
          for (const statement of [
            'CREATE TABLE archive_uploader_sources (id TEXT PRIMARY KEY, "sourceKind" TEXT, "titleQuery" JSONB, "queryKey" TEXT, "historyCursor" TEXT, "latestSeenExternalId" TEXT)',
            'CREATE TABLE archive_uploader_scan_runs (id TEXT PRIMARY KEY)',
            'CREATE TABLE archive_uploader_catalog_items (id TEXT PRIMARY KEY, "sourceId" TEXT REFERENCES archive_uploader_sources(id), "matchesQuery" BOOLEAN)',
            'CREATE TABLE system_jobs (id TEXT PRIMARY KEY, type TEXT, "executionLane" TEXT, CONSTRAINT system_jobs_type_execution_lane_check CHECK (true))',
            `INSERT INTO archive_uploader_sources VALUES ('legacy', 'TITLE_QUERY', '{"keyword":"RAG","matchMode":"CONTAINS","uploaderUid":null}', 'old-key', 'v3-cursor', '123'), ('uploader', 'UPLOADER', NULL, NULL, 'uid-cursor', '456')`,
            `INSERT INTO archive_uploader_catalog_items VALUES ('accepted', 'legacy', true), ('filtered', 'legacy', false)`
          ])
            await tx.$executeRawUnsafe(statement)
          for (const statement of sql.trim().split(/;\s*(?=(?:CREATE|ALTER|UPDATE)\b)/))
            await tx.$executeRawUnsafe(statement)
          expect(await tx.$queryRawUnsafe("SELECT * FROM archive_uploader_sources WHERE id = 'legacy'")).toEqual([
            expect.objectContaining({
              queryKey: 'old-key',
              historyCursor: 'v3-cursor',
              latestSeenExternalId: '123',
              rulesVersion: 1,
              catalogVersion: 0n,
              titleRules: { version: 1, any: [{ operator: 'CONTAINS', text: 'RAG' }], all: [], none: [] }
            })
          ])
          expect(
            await tx.$queryRawUnsafe(
              'SELECT id, "ruleMatches", "matchesQuery", "reviewDecision" FROM archive_uploader_catalog_items ORDER BY id'
            )
          ).toEqual([
            { id: 'accepted', ruleMatches: true, matchesQuery: true, reviewDecision: 'AUTO' },
            { id: 'filtered', ruleMatches: false, matchesQuery: false, reviewDecision: 'AUTO' }
          ])
          await tx.$executeRawUnsafe('UPDATE archive_uploader_catalog_items SET "reviewDecision" = \'EXCLUDE\'')
          expect(
            await tx.$queryRawUnsafe('SELECT "catalogVersion" FROM archive_uploader_sources WHERE id = \'legacy\'')
          ).toEqual([{ catalogVersion: 1n }])
          await tx.$executeRawUnsafe('DELETE FROM archive_uploader_catalog_items')
          expect(
            await tx.$queryRawUnsafe('SELECT "catalogVersion" FROM archive_uploader_sources WHERE id = \'legacy\'')
          ).toEqual([{ catalogVersion: 2n }])
          expect(
            await tx.$queryRawUnsafe(
              'SELECT "titleRules", "catalogVersion" FROM archive_uploader_sources WHERE id = \'uploader\''
            )
          ).toEqual([{ titleRules: null, catalogVersion: 0n }])
          throw rollback
        },
        { timeout: 20_000 }
      )
    ).rejects.toBe(rollback)
    expect(
      await db!.$queryRawUnsafe('SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1', schema)
    ).toEqual([])
  })
})
