import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const rollback = new Error('rollback isolated visual search upgrade fixture')

describe.skipIf(!db)('visual search v2 nonempty upgrade', () => {
  afterAll(async () => { await db?.$disconnect() })

  it('preserves feature and historical evidence, retains v7 and admits v8 without reinterpreting coverage', async () => {
    const schema = `visual_v2_upgrade_${randomUUID().replaceAll('-', '')}`
    const previous = await readFile(new URL('../../prisma/migrations/20261029000200_artwork_dedup_quick_confirmation/migration.sql', import.meta.url), 'utf8')
    const migration = await readFile(new URL('../../prisma/migrations/20261029000300_artwork_dedup_visual_search_v2/migration.sql', import.meta.url), 'utf8')
    await expect(db!.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
      await tx.$executeRawUnsafe('CREATE TABLE "ArtworkDedupRun" (id text PRIMARY KEY,"algorithmVersion" integer,"visualStatus" text,"visualCheckpoint" jsonb,"visualCandidatePairs" text[])')
      await tx.$executeRawUnsafe(`INSERT INTO "ArtworkDedupRun" VALUES ('old',1,'COMPLETE','{"version":2,"phase":"PUBLISH"}',ARRAY['1:2'])`)
      await tx.$executeRawUnsafe(`CREATE TABLE system_jobs (id text PRIMARY KEY,type text,"definitionVersion" integer,"executionLane" text DEFAULT 'BACKGROUND_WRITER',"triggerSource" text DEFAULT 'SYSTEM',"queuePriority" integer DEFAULT 900,"effectivePriority" integer DEFAULT 900,"scheduledTaskId" text,"parentJobId" text,"deadlineAt" timestamp,payload jsonb)`)
      const marker = 'ALTER TABLE "system_jobs" DROP CONSTRAINT "system_jobs_dedup_policy";'
      await tx.$executeRawUnsafe(previous.slice(previous.indexOf(marker) + marker.length))
      await tx.$executeRawUnsafe(`INSERT INTO system_jobs(id,type,"definitionVersion",payload) VALUES ('v7','ARTWORK_DEDUP_SCAN',7,'{}'),('delete6','ARTWORK_DEDUP_MAINTENANCE',6,'{"operationId":"old","executionVersion":1,"mode":"DIRECT_DELETE"}')`)
      for (const statement of migration.trim().split(/;\s*(?=(?:--[^\n]*\n\s*)*ALTER\b)/)) await tx.$executeRawUnsafe(statement)
      expect(await tx.$queryRawUnsafe('SELECT * FROM "ArtworkDedupRun"')).toEqual([{
        id: 'old', algorithmVersion: 1, visualStatus: 'COMPLETE', visualCheckpoint: { version: 2, phase: 'PUBLISH' },
        visualCandidatePairs: ['1:2'], performanceSummary: null, visualSearchVersion: null,
        visualSearchComplete: false, visualInputDigest: null
      }])
      await tx.$executeRawUnsafe(`INSERT INTO system_jobs(id,type,"definitionVersion",payload) VALUES ('v8','ARTWORK_DEDUP_SCAN',8,'{}')`)
      expect(await tx.$queryRawUnsafe('SELECT id,"definitionVersion" FROM system_jobs ORDER BY id')).toEqual([
        { id: 'delete6', definitionVersion: 6 }, { id: 'v7', definitionVersion: 7 }, { id: 'v8', definitionVersion: 8 }
      ])
      await tx.$executeRawUnsafe('SAVEPOINT invalid_version')
      await expect(tx.$executeRawUnsafe(`INSERT INTO system_jobs(id,type,"definitionVersion",payload) VALUES ('v9','ARTWORK_DEDUP_SCAN',9,'{}')`)).rejects.toMatchObject({ code: 'P2010', meta: { code: '23514' } })
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_version')
      throw rollback
    }, { timeout: 30_000 })).rejects.toBe(rollback)
    expect(await db!.$queryRawUnsafe('SELECT schema_name FROM information_schema.schemata WHERE schema_name=$1', schema)).toEqual([])
  })
})
