import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Prisma, PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

const url =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const database = url ? new PrismaClient({ datasourceUrl: url }) : null
const rollback = new Error('rollback isolated content migration')

describe.skipIf(!database)('media content expand migration', () => {
  afterAll(async () => database?.$disconnect())
  it.each([false, true])(
    'migrates an empty/existing media schema without media backfill (existing=%s)',
    async (existing) => {
      const schema = `content_migration_${randomUUID().replaceAll('-', '')}`
      await expect(
        database!.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
            await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
            await tx.$executeRawUnsafe('CREATE TABLE "Artwork" (id INTEGER PRIMARY KEY, title TEXT NOT NULL)')
            await tx.$executeRawUnsafe(
              'CREATE TABLE "Image" (id INTEGER PRIMARY KEY, "artworkId" INTEGER REFERENCES "Artwork"(id), path TEXT NOT NULL, size BIGINT, "sortOrder" INTEGER DEFAULT 0)'
            )
            if (existing) {
              await tx.$executeRawUnsafe('INSERT INTO "Artwork" VALUES (1, \'retained\')')
              await tx.$executeRawUnsafe('INSERT INTO "Image" VALUES (7, 1, \'/unchanged.jpg\', 9007199254740993, 2)')
            }
            await applyMigration(tx, '20261023002000_media_content_fingerprints')
            expect(await tx.$queryRawUnsafe(`SELECT * FROM "${schema}"."Artwork"`)).toEqual(
              existing ? [{ id: 1, title: 'retained' }] : []
            )
            expect(await tx.$queryRawUnsafe(`SELECT * FROM "${schema}"."Image"`)).toEqual(
              existing ? [{ id: 7, artworkId: 1, path: '/unchanged.jpg', size: 9007199254740993n, sortOrder: 2 }] : []
            )
            for (const table of [
              'MediaContentDirectoryState',
              'MediaContentPathWrite',
              'MediaContentSource',
              'ArtworkContentSource',
              'MediaContentFingerprint',
              'ArtworkContentFingerprint'
            ])
              expect(await tx.$queryRawUnsafe(`SELECT * FROM "${schema}"."${table}"`)).toEqual([])
            if (existing) {
              await tx.$executeRawUnsafe('UPDATE "Image" SET "sortOrder" = 3 WHERE id = 7')
              expect(await tx.$queryRawUnsafe('SELECT * FROM "ArtworkContentSource"')).toEqual([])
              await tx.$executeRawUnsafe('UPDATE "Image" SET path = \'/changed.jpg\' WHERE id = 7')
              expect(await tx.$queryRawUnsafe('SELECT revision FROM "ArtworkContentSource"')).toEqual([
                { revision: 1n }
              ])
              expect(await tx.$queryRawUnsafe('SELECT revision FROM "MediaContentSource"')).toEqual([{ revision: 1n }])
            }
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
    }
  )

  it.each([false, true])(
    'upgrades recovery grants over empty/existing content evidence without rewriting it (existing=%s)',
    async (existing) => {
      const schema = `content_recovery_migration_${randomUUID().replaceAll('-', '')}`
      await expect(
        database!.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
            await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
            for (const statement of [
              'CREATE TABLE "Artwork" (id INTEGER PRIMARY KEY, title TEXT NOT NULL)',
              'CREATE TABLE "Image" (id INTEGER PRIMARY KEY, "artworkId" INTEGER REFERENCES "Artwork"(id), path TEXT NOT NULL, size BIGINT, "sortOrder" INTEGER DEFAULT 0)',
              'CREATE TABLE system_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, attempt INTEGER NOT NULL)'
            ])
              await tx.$executeRawUnsafe(statement)
            if (existing) {
              await tx.$executeRawUnsafe(`INSERT INTO "Artwork" VALUES (1, 'legacy'), (2, 'fingerprinted')`)
              await tx.$executeRawUnsafe(`INSERT INTO "Image" VALUES
                (7, 1, '/unchanged.jpg', 9007199254740993, 2),
                (8, 2, '/evidence/retained.jpg', 9007199254740995, 3)`)
              await tx.$executeRawUnsafe(`INSERT INTO system_jobs VALUES ('retained-job', 'PAUSED', 2)`)
            }
            await applyMigration(tx, '20261023002000_media_content_fingerprints')
            if (existing) {
              for (const statement of [
                `INSERT INTO "MediaContentDirectoryState"
                  (id, "logicalRoot", "relativeDirectory", "rootIdentity", generation, "updatedAt")
                  VALUES ('directory', 'source-media:v1', 'evidence', 'retained-root', 9007199254740993, CURRENT_TIMESTAMP)`,
                `INSERT INTO "MediaContentPathWrite"
                  (id, "directoryId", scope, "relativePath", "sessionId", "sessionVersion", "writeToken",
                   "declarationVersion", "jobId", "executionToken", "executionAttempt", status, "startedAt", "updatedAt")
                  VALUES ('write', 'directory', 'PATH', 'evidence/retained.jpg', 'retained-session', 3, 'retained-write-token',
                    4, 'retained-job', 'retained-execution-token', 2, 'RECOVERY_REQUIRED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                `INSERT INTO "MediaContentSource"
                  ("imageId", revision, "directoryStateId", "writeToken", "writeStartedAt", "updatedAt")
                  VALUES (8, 11, 'directory', 'retained-source-token', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                `INSERT INTO "ArtworkContentSource"
                  ("artworkId", revision, "mediaEpoch", "writeToken", "writeStartedAt", "updatedAt")
                  VALUES (2, 12, 13, 'retained-source-token', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                `INSERT INTO "MediaContentFingerprint"
                  ("imageId", "algorithmVersion", "rootIdentity", "sourcePath", "canonicalPath", "sourceRevision",
                   "artworkMediaEpoch", size, "mtimeNs", "ctimeNs", "deviceId", inode, sha256, "hashedAt")
                  VALUES (8, 1, 'retained-root', '/evidence/retained.jpg', 'evidence/retained.jpg', 11,
                    13, 9007199254740995, 9007199254740997, 9007199254740999, 10, 20, repeat('a', 64), CURRENT_TIMESTAMP)`,
                `INSERT INTO "ArtworkContentFingerprint"
                  ("artworkId", "algorithmVersion", "sourceRevision", "mediaEpoch", "membersSignature", "fileCount", "contentSha256", "completedAt")
                  VALUES (2, 1, 12, 13, repeat('b', 64), 1, repeat('c', 64), CURRENT_TIMESTAMP)`
              ])
                await tx.$executeRawUnsafe(statement)
            }
            const tables = [
              'Artwork',
              'Image',
              'system_jobs',
              'MediaContentDirectoryState',
              'MediaContentPathWrite',
              'MediaContentSource',
              'ArtworkContentSource',
              'MediaContentFingerprint',
              'ArtworkContentFingerprint'
            ]
            const before = await Promise.all(
              tables.map((table) => tx.$queryRawUnsafe(`SELECT * FROM "${schema}"."${table}" ORDER BY 1`))
            )
            await applyMigration(tx, '20261023003000_media_content_recovery_grants')
            for (const [index, table] of tables.entries())
              expect(await tx.$queryRawUnsafe(`SELECT * FROM "${schema}"."${table}" ORDER BY 1`)).toEqual(before[index])
            expect(await tx.$queryRawUnsafe(`SELECT * FROM "${schema}"."MediaContentRecoveryGrant"`)).toEqual([])

            await tx.$executeRawUnsafe(
              `INSERT INTO system_jobs VALUES ('grant-job', 'PAUSED', 2), ('other-job', 'PAUSED', 2)`
            )
            const insertGrant = (id: string, jobId = 'grant-job', sessionId = 'grant-session') =>
              tx.$executeRawUnsafe(
                `INSERT INTO "MediaContentRecoveryGrant"
                  (id, "jobId", "sessionId", "expectedAttempt", "targetAttempt", snapshot, "snapshotSha256", "backupCheckpointRef", operator)
                  VALUES ($1, $2, $3, 2, 3, '{"version": 1}', repeat('a', 64), 'fixture-checkpoint', 'fixture-operator')`,
                id,
                jobId,
                sessionId
              )
            await insertGrant('grant')
            expect(await tx.$queryRawUnsafe(`SELECT * FROM "${schema}"."MediaContentRecoveryGrant"`)).toEqual([
              expect.objectContaining({
                status: 'ACTIVE',
                expectedAttempt: 2,
                targetAttempt: 3,
                snapshot: { version: 1 },
                snapshotSha256: 'a'.repeat(64),
                createdAt: expect.any(Date),
                consumedAt: null,
                consumedExecutionToken: null,
                revokedAt: null,
                revokedBy: null,
                revocationReason: null
              })
            ])
            for (const invalidValues of [
              '"expectedAttempt" = 0, "targetAttempt" = 1',
              '"targetAttempt" = 4',
              `"sessionId" = ''`,
              `"sessionId" = repeat('x', 4097)`,
              `operator = ''`,
              `"backupCheckpointRef" = ''`,
              `"snapshotSha256" = repeat('A', 64)`,
              `snapshot = '[]'::jsonb`,
              `snapshot = jsonb_build_object('evidence', repeat('x', 1048576))`,
              '"consumedAt" = CURRENT_TIMESTAMP',
              '"revokedAt" = CURRENT_TIMESTAMP',
              `status = 'CONSUMED'`,
              `status = 'CONSUMED', "consumedAt" = CURRENT_TIMESTAMP`,
              `status = 'REVOKED'`,
              `status = 'REVOKED', "revokedAt" = CURRENT_TIMESTAMP, "revokedBy" = 'operator'`
            ])
              await expectRejected(
                tx,
                () =>
                  tx.$executeRawUnsafe(`UPDATE "MediaContentRecoveryGrant" SET ${invalidValues} WHERE id = 'grant'`),
                '23514'
              )
            await expectRejected(tx, () => insertGrant('duplicate'), '23505')
            await expectRejected(tx, () => insertGrant('orphan', 'missing-job'), '23503')
            await expectRejected(
              tx,
              () => tx.$executeRawUnsafe(`DELETE FROM system_jobs WHERE id = 'grant-job'`),
              '23503'
            )
            await insertGrant('other-session', 'grant-job', 'other-session')
            await insertGrant('other-job', 'other-job')
            await tx.$executeRawUnsafe(`UPDATE system_jobs SET id = 'renamed-job' WHERE id = 'grant-job'`)
            expect(
              await tx.$queryRawUnsafe(`SELECT "jobId" FROM "${schema}"."MediaContentRecoveryGrant" WHERE id = 'grant'`)
            ).toEqual([{ jobId: 'renamed-job' }])
            await tx.$executeRawUnsafe(`UPDATE "MediaContentRecoveryGrant"
              SET status = 'CONSUMED', "consumedAt" = CURRENT_TIMESTAMP,
                "consumedExecutionToken" = '11111111-1111-4111-8111-111111111111' WHERE id = 'grant'`)
            await expectRejected(
              tx,
              () =>
                tx.$executeRawUnsafe(`UPDATE "MediaContentRecoveryGrant"
                SET "revokedAt" = CURRENT_TIMESTAMP, "revokedBy" = 'operator', "revocationReason" = 'mixed evidence'
                WHERE id = 'grant'`),
              '23514'
            )
            await insertGrant('replacement', 'renamed-job')
            await tx.$executeRawUnsafe(`UPDATE "MediaContentRecoveryGrant"
              SET status = 'REVOKED', "revokedAt" = CURRENT_TIMESTAMP, "revokedBy" = 'operator', "revocationReason" = 'new checkpoint'
              WHERE id = 'replacement'`)
            await insertGrant('replacement-after-revoke', 'renamed-job')
            expect(
              await tx.$queryRawUnsafe(`SELECT id, status FROM "${schema}"."MediaContentRecoveryGrant"
              WHERE "jobId" = 'renamed-job' AND "sessionId" = 'grant-session' ORDER BY id`)
            ).toEqual([
              { id: 'grant', status: 'CONSUMED' },
              { id: 'replacement', status: 'REVOKED' },
              { id: 'replacement-after-revoke', status: 'ACTIVE' }
            ])
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
    }
  )
})

async function applyMigration(tx: Prisma.TransactionClient, name: string) {
  const sql = await readFile(new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8')
  // Split top-level CREATE/ALTER statements while preserving semicolons inside function bodies.
  for (const statement of sql.trim().split(/;\s*(?=(?:--[^\n]*\n\s*)*(?:CREATE|ALTER)\b)/))
    await tx.$executeRawUnsafe(statement)
}

async function expectRejected(tx: Prisma.TransactionClient, statement: () => Promise<unknown>, sqlState: string) {
  await tx.$executeRawUnsafe('SAVEPOINT invalid_grant')
  await expect(statement()).rejects.toMatchObject({ code: 'P2010', meta: { code: sqlState } })
  await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_grant')
  await tx.$executeRawUnsafe('RELEASE SAVEPOINT invalid_grant')
}
