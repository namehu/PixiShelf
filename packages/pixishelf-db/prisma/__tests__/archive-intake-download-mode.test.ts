import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  path.resolve('prisma/migrations/20260909100000_archive_intake_download_mode/migration.sql'),
  'utf8'
)
const databaseUrl = process.env.QUEUE_KERNEL_TEST_DATABASE_URL

describe('archive intake download intent migration', () => {
  it('adds a manual default without issuing any historical activation writes', () => {
    expect(migration).toContain("NOT NULL DEFAULT 'MANUAL'")
    expect(migration).not.toMatch(/\b(UPDATE|DELETE|INSERT)\b/)
  })

  it.skipIf(!databaseUrl)('preserves nonempty historical rows as MANUAL using the actual migration', async () => {
    const database = new PrismaClient({ datasourceUrl: databaseUrl! })
    const schema = `archive_mode_${randomUUID().replaceAll('-', '')}`
    try {
      await database.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
        await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
        await transaction.$executeRawUnsafe(`CREATE TYPE "ArchiveIntakeStatus" AS ENUM ('READY', 'FAILED')`)
        await transaction.$executeRawUnsafe(
          `CREATE TABLE "archive_intake_items" ("id" text PRIMARY KEY, "status" "ArchiveIntakeStatus" NOT NULL)`
        )
        await transaction.$executeRawUnsafe(
          `INSERT INTO "archive_intake_items" VALUES ('old-ready', 'READY'), ('old-failed', 'FAILED')`
        )
        for (const statement of migration
          .replace(/--[^\r\n]*/g, '')
          .split(';')
          .map((value) => value.trim())
          .filter(Boolean)) {
          await transaction.$executeRawUnsafe(statement)
        }
        expect(
          await transaction.$queryRawUnsafe(
            `SELECT "id", "status"::text, "downloadMode"::text FROM "archive_intake_items" ORDER BY "id"`
          )
        ).toEqual([
          { id: 'old-failed', status: 'FAILED', downloadMode: 'MANUAL' },
          { id: 'old-ready', status: 'READY', downloadMode: 'MANUAL' }
        ])
        await transaction.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
      })
    } finally {
      await database.$disconnect()
    }
  })
})
