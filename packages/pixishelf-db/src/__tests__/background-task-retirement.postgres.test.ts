import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

const url =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const database = url ? new PrismaClient({ datasourceUrl: url }) : null
const rollback = new Error('rollback isolated retirement migration')

describe.skipIf(!database)('background task retirement expand migration', () => {
  afterAll(async () => database?.$disconnect())

  it('snapshots legacy targets including nulls without changing history, acknowledgements or rollback columns', async () => {
    const schema = `retirement_${randomUUID().replaceAll('-', '')}`
    const sql = await readFile(
      new URL(
        '../../prisma/migrations/20261007100000_background_task_retirement_read_model/migration.sql',
        import.meta.url
      ),
      'utf8'
    )
    await expect(
      database!.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
          await tx.$executeRawUnsafe(
            'CREATE TABLE system_jobs (id TEXT PRIMARY KEY, type TEXT, "definitionVersion" INT, status TEXT, payload JSONB, "targetImageId" INT, "targetPath" TEXT, mode TEXT, "createdAt" TIMESTAMP)'
          )
          await tx.$executeRawUnsafe(
            'CREATE TABLE system_job_failure_acknowledgements ("jobId" TEXT REFERENCES system_jobs(id), source TEXT)'
          )
          await tx.$executeRawUnsafe(`INSERT INTO system_jobs VALUES
        ('history', 'VIDEO_KEYFRAME_GENERATION', 0, 'FAILED', NULL, 17, '归档/旧视频.mp4', 'MANUAL_FORCE', '2020-01-01'),
        ('nulls', 'SCAN', 0, 'COMPLETED', NULL, NULL, NULL, NULL, '2020-01-02'),
        ('modern', 'VIDEO_STREAMING_OPTIMIZATION', 1, 'PAUSED', '{"imageId":18}', 18, 'current.mp4', 'REMUX_FASTSTART', '2026-01-01')`)
          await tx.$executeRawUnsafe("INSERT INTO system_job_failure_acknowledgements VALUES ('history', 'MANUAL')")
          const before = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
            'SELECT * FROM system_jobs ORDER BY id'
          )
          for (const statement of sql
            .replace(/^--.*$/gm, '')
            .split(';')
            .map((s) => s.trim())
            .filter((s) => s && s !== 'BEGIN' && s !== 'COMMIT')) {
            await tx.$executeRawUnsafe(statement)
          }
          const after = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
            'SELECT expanded.* FROM system_jobs expanded ORDER BY id'
          )
          expect(after.map(({ legacyDisplay: _, ...row }) => row)).toEqual(before)
          expect(after.map((row) => row.legacyDisplay)).toEqual([
            { schemaVersion: 1, targetImageId: 17, targetPath: '归档/旧视频.mp4', mode: 'MANUAL_FORCE' },
            null,
            { schemaVersion: 1, targetImageId: null, targetPath: null, mode: null }
          ])
          expect(await tx.$queryRawUnsafe('SELECT * FROM system_job_failure_acknowledgements')).toEqual([
            { jobId: 'history', source: 'MANUAL' }
          ])
          const indexes = await tx.$queryRawUnsafe<Array<{ indexname: string }>>(
            'SELECT indexname FROM pg_indexes WHERE schemaname = $1',
            schema
          )
          expect(indexes.map((row) => row.indexname)).toEqual(
            expect.arrayContaining(['system_jobs_payload_image_created_idx', 'system_jobs_legacy_image_created_idx'])
          )
          throw rollback
        },
        { timeout: 20_000 }
      )
    ).rejects.toBe(rollback)
    expect(
      await database!.$queryRawUnsafe(
        'SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1',
        schema
      )
    ).toEqual([])
  })
})
