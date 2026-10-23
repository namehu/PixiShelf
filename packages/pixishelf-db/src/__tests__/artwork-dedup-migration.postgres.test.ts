import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PrismaClient, type Prisma } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const rollback = new Error('rollback isolated detection migration')
async function apply(tx: Prisma.TransactionClient, name: string) {
  const sql = await readFile(new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8')
  for (const statement of sql.trim().split(/;\s*(?=(?:--[^\n]*\n\s*)*(?:CREATE|ALTER)\b)/)) {
    await tx.$executeRawUnsafe(statement)
  }
}
async function rejected(tx: Prisma.TransactionClient, sql: string, code: string) {
  await tx.$executeRawUnsafe('SAVEPOINT invalid_detection')
  await expect(tx.$executeRawUnsafe(sql)).rejects.toMatchObject({ code: 'P2010', meta: { code } })
  await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_detection')
  await tx.$executeRawUnsafe('RELEASE SAVEPOINT invalid_detection')
}
describe.skipIf(!db)('detection migration upgrades', () => {
  afterAll(async () => {
    await db?.$disconnect()
  })
  it.each([false, true])(
    'preserves old artwork/media/jobs and enforces new invariants (nonempty=%s)',
    async (nonempty) => {
      const schema = `dedup_migration_${randomUUID().replaceAll('-', '')}`
      await expect(
        db!.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
            await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
            await tx.$executeRawUnsafe('CREATE TABLE "Artwork" (id INTEGER PRIMARY KEY,title TEXT)')
            await tx.$executeRawUnsafe(
              'CREATE TABLE "Image" (id INTEGER PRIMARY KEY,"artworkId" INTEGER REFERENCES "Artwork"(id),path TEXT,size BIGINT)'
            )
            await tx.$executeRawUnsafe(`CREATE TABLE system_jobs (id TEXT PRIMARY KEY,type TEXT,status TEXT DEFAULT 'PENDING',"definitionVersion" INTEGER DEFAULT 1,
    "executionLane" TEXT DEFAULT 'BACKGROUND_WRITER',"triggerSource" TEXT DEFAULT 'SYSTEM',"queuePriority" INTEGER DEFAULT 900,"effectivePriority" INTEGER DEFAULT 900,
    "scheduledTaskId" TEXT,"parentJobId" TEXT,"deadlineAt" TIMESTAMP,"updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"startedAt" TIMESTAMP,"finishedAt" TIMESTAMP)`)
            if (nonempty) {
              await tx.$executeRawUnsafe(`INSERT INTO "Artwork" VALUES(1,'retained')`)
              await tx.$executeRawUnsafe(`INSERT INTO "Image" VALUES(7,1,'/retained.jpg',9007199254740993)`)
              await tx.$executeRawUnsafe(
                `INSERT INTO system_jobs(id,type,status,"queuePriority","effectivePriority") VALUES('old','SCAN','PAUSED',100,100)`
              )
            }
            await apply(tx, '20261023004000_artwork_dedup_detection')
            await apply(tx, '20261023004100_artwork_dedup_failure_causes')
            await apply(tx, '20261023004200_artwork_dedup_root_bindings')
            expect(await tx.$queryRawUnsafe('SELECT * FROM "Artwork"')).toEqual(
              nonempty ? [{ id: 1, title: 'retained' }] : []
            )
            expect(await tx.$queryRawUnsafe('SELECT * FROM "Image"')).toEqual(
              nonempty ? [{ id: 7, artworkId: 1, path: '/retained.jpg', size: 9007199254740993n }] : []
            )
            expect(await tx.$queryRawUnsafe('SELECT id,type,status,"queuePriority" FROM system_jobs')).toEqual(
              nonempty ? [{ id: 'old', type: 'SCAN', status: 'PAUSED', queuePriority: 100 }] : []
            )
            await tx.$executeRawUnsafe(`INSERT INTO system_jobs(id,type) VALUES('scan','ARTWORK_DEDUP_SCAN')`)
            await tx.$executeRawUnsafe(
              `INSERT INTO "ArtworkDedupRun"(id,"artistId","requestedBy","idempotencyKey",mode,"jobId","updatedAt") VALUES('r',1,'u','key','FULL','scan',CURRENT_TIMESTAMP)`
            )
            await rejected(
              tx,
              `INSERT INTO "ArtworkDedupRun"(id,"artistId","requestedBy","idempotencyKey",mode,status,"updatedAt") VALUES('other',1,'u','other','FULL','PAUSED',CURRENT_TIMESTAMP)`,
              '23505'
            )
            await rejected(tx, `UPDATE system_jobs SET "effectivePriority"=899 WHERE id='scan'`, '23514')
            await rejected(tx, `UPDATE system_jobs SET "executionLane"='ARCHIVE_RESOLVE' WHERE id='scan'`, '23514')
            await tx.$executeRawUnsafe(`UPDATE "ArtworkDedupRun" SET "errorCode"='ROOT_CHANGED' WHERE id='r'`)
            await tx.$executeRawUnsafe(`UPDATE system_jobs SET status='FAILED' WHERE id='scan'`)
            expect(await tx.$queryRawUnsafe('SELECT status,version,"errorCode" FROM "ArtworkDedupRun"')).toEqual([
              { status: 'FAILED', version: 2, errorCode: 'ROOT_CHANGED' }
            ])
            await tx.$executeRawUnsafe(
              `INSERT INTO "ArtworkDedupRun"(id,"artistId","requestedBy","idempotencyKey",mode,"updatedAt") VALUES('other',1,'u','other','FULL',CURRENT_TIMESTAMP)`
            )
            await rejected(
              tx,
              `INSERT INTO "ArtworkDedupItem"("runId","artworkId","frozenMediaRevision",status,"updatedAt") VALUES('missing',1,1,'PENDING',CURRENT_TIMESTAMP)`,
              '23503'
            )
            throw rollback
          },
          { timeout: 30000 }
        )
      ).rejects.toBe(rollback)
      expect(
        await db!.$queryRawUnsafe('SELECT schema_name FROM information_schema.schemata WHERE schema_name=$1', schema)
      ).toEqual([])
    }
  )
})
