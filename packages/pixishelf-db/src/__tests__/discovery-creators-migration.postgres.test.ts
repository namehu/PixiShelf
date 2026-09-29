import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
afterAll(async () => db?.$disconnect())

describe.skipIf(!url)('discovery creator migration backfill', () => {
  it('marks historical matches and preserves only currently excluded creator decisions', async () => {
    const sql = await readFile(
      new URL('../../prisma/migrations/20260916120000_discovery_creators/migration.sql', import.meta.url),
      'utf8'
    )
    const schema = `discovery_migration_${randomUUID().replaceAll('-', '')}`
    const rollback = new Error('rollback isolated migration fixture')
    try {
      await db!.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
          for (const statement of [
            `CREATE TYPE "ArchiveBulkOperationCommand" AS ENUM ('ENQUEUE')`,
            `CREATE TYPE "ArchiveBulkOperationTarget" AS ENUM ('INTAKE_ITEM')`,
            `CREATE TABLE "Artist" (id INTEGER PRIMARY KEY)`,
            `CREATE TABLE archive_uploader_sources (id TEXT PRIMARY KEY)`,
            `CREATE TABLE archive_uploader_scan_runs (id TEXT PRIMARY KEY)`,
            `CREATE TABLE archive_uploader_catalog_items (id TEXT PRIMARY KEY, "matchesQuery" BOOLEAN, "lastSeenAt" TIMESTAMP)`,
            `CREATE TABLE artwork_artists (id TEXT PRIMARY KEY, "artworkId" INTEGER, "artistId" INTEGER)`,
            `CREATE TABLE artwork_external_refs ("artworkId" INTEGER, "providerKey" TEXT, "externalId" TEXT)`,
            `CREATE TABLE artwork_artist_evidence ("membershipId" TEXT, "excludedAt" TIMESTAMP, present BOOLEAN)`,
            `INSERT INTO "Artist" VALUES (1), (2)`,
            `INSERT INTO archive_uploader_catalog_items VALUES ('matched', true, '2026-09-01'), ('unmatched', false, '2026-09-01')`,
            `INSERT INTO artwork_artists VALUES ('removed', 1, 1), ('restored', 1, 2)`,
            `INSERT INTO artwork_external_refs VALUES (1, 'e-hentai', '100')`,
            `INSERT INTO artwork_artist_evidence VALUES ('removed', '2026-09-02', true), ('restored', '2026-09-02', true), ('restored', NULL, true)`
          ])
            await tx.$executeRawUnsafe(statement)
          for (const statement of sql
            .replace(/^--.*$/gm, '')
            .split(';')
            .map((part) => part.trim())
            .filter(Boolean))
            await tx.$executeRawUnsafe(statement)
          expect(await tx.$queryRawUnsafe('SELECT "artistId" FROM discovery_creator_suppressions')).toEqual([
            { artistId: 1 }
          ])
          expect(
            await tx.$queryRawUnsafe('SELECT id, "firstMatchedAt" FROM archive_uploader_catalog_items ORDER BY id')
          ).toEqual([
            { id: 'matched', firstMatchedAt: new Date('2026-09-01T00:00:00Z') },
            { id: 'unmatched', firstMatchedAt: null }
          ])
          throw rollback
        },
        { timeout: 30000 }
      )
    } catch (error) {
      if (error !== rollback) throw error
    }
  })
})
