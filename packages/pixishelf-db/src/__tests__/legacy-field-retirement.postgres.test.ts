import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { PrismaClient, type Prisma } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const database = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const packageDirectory = path.resolve(import.meta.dirname, '../..')
const maintenance = path.join(packageDirectory, 'maintenance', 'retire-legacy-fields.mjs')

afterAll(async () => database?.$disconnect())

describePostgres('legacy field retirement maintenance behavior', () => {
  it('rolls back earlier writes on timeout and can retry the same decisions with a larger limit', async () => {
    const fixture = await createFixture()
    try {
      await seedIdentityFixture(fixture)
      await withSchema(fixture.schema, async (tx) => {
        await tx.$executeRawUnsafe(`CREATE FUNCTION delay_artist_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.5); RETURN NEW; END $$`)
        await tx.$executeRawUnsafe(`CREATE TRIGGER slow_update BEFORE UPDATE ON "Artist" FOR EACH ROW EXECUTE FUNCTION delay_artist_update()`)
      })
      const report = JSON.parse(runCli(fixture, 'audit').stdout)
      const issues = report.blockers.filter((item: { kind: string }) => item.kind === 'series-membership')
      const decisions = await writeDecisions(fixture, report, issues)
      const timedOut = runCli(fixture, 'prepare', ['--decisions', decisions, '--transaction-timeout-ms', '1000'])
      expect(timedOut.status).toBe(1)
      expect(timedOut.stderr).toMatch(/expired transaction|Transaction already closed|timed out/i)
      await expectLegacyPointers(fixture, 2)
      await withSchema(fixture.schema, async (tx) => {
        const rows = await tx.$queryRawUnsafe<Array<{ storagePath: string | null }>>(`SELECT "storagePath" FROM "Artwork" WHERE id=1`)
        expect(rows[0]?.storagePath).toBeNull()
      })
      const retry = runCli(fixture, 'prepare', ['--decisions', decisions, '--transaction-timeout-ms', '10000'])
      expect(retry.status, retry.stderr).toBe(0)
      expect(JSON.parse(retry.stdout).blockers).toEqual([])
      expect(retry.stderr).toContain('transaction committed; final audit')
    } finally {
      await fixture.dispose()
    }
  }, 30_000)

  it('rejects stale and missing decisions without writes, then preserves explicit membership choices', async () => {
    const fixture = await createFixture()
    try {
      await seedIdentityFixture(fixture)
      const audit = runCli(fixture, 'audit')
      expect(audit.status).toBe(2)
      const report = JSON.parse(audit.stdout)
      const membershipIssues = report.blockers.filter((item: { kind: string }) => item.kind === 'series-membership')
      expect(membershipIssues).toHaveLength(2)

      const stale = await writeDecisions(fixture, { ...report, fingerprint: '0'.repeat(64) }, membershipIssues)
      expect(runCli(fixture, 'prepare', ['--decisions', stale]).status).toBe(1)
      await expectLegacyPointers(fixture, 2)

      expect(runCli(fixture, 'prepare').status).toBe(2)
      await expectLegacyPointers(fixture, 2)

      const decisions = await writeDecisions(fixture, report, membershipIssues, ['KEEP_CURRENT', 'RESTORE_LEGACY'])
      const prepared = runCli(fixture, 'prepare', ['--decisions', decisions])
      expect(prepared.status, prepared.stderr).toBe(0)
      await withSchema(fixture.schema, async (transaction) => {
        const artists = await transaction.$queryRawUnsafe<Array<{ userId: string | null }>>(
          `SELECT "userId" FROM "Artist" WHERE id = 1`
        )
        expect(artists[0]?.userId).toBeNull()
        const artworks = await transaction.$queryRawUnsafe<Array<{ id: number; seriesId: number | null; storagePath: string | null }>>(
          `SELECT id, "seriesId", "storagePath" FROM "Artwork" WHERE id IN (1, 2) ORDER BY id`
        )
        expect(artworks).toEqual([
          { id: 1, seriesId: null, storagePath: 'artist/work' },
          { id: 2, seriesId: null, storagePath: null }
        ])
        const restored = await transaction.$queryRawUnsafe<
          Array<{ seriesId: number; artworkId: number; sortOrder: number; provenance: string; excludedAt: Date | null }>
        >(
          `SELECT "seriesId", "artworkId", "sortOrder", provenance, "excludedAt"
           FROM "SeriesArtwork" WHERE "artworkId" IN (1, 2) ORDER BY "artworkId", "seriesId"`
        )
        expect(restored).toEqual([
          expect.objectContaining({ artworkId: 1, seriesId: 2, sortOrder: 3, provenance: 'MANUAL' }),
          expect.objectContaining({ artworkId: 2, seriesId: 1, sortOrder: 8, provenance: 'LEGACY', excludedAt: null }),
          expect.objectContaining({ artworkId: 2, seriesId: 2, sortOrder: 4, provenance: 'MANUAL' })
        ])
        expect(restored[0]?.excludedAt).toBeInstanceOf(Date)
        expect(restored[2]?.excludedAt).toBeInstanceOf(Date)
      })
    } finally {
      await fixture.dispose()
    }
  }, 30_000)

  it('allows proof of a file-free planning failure and blocks unfinished file state', async () => {
    const fixture = await createFixture()
    try {
      await withSchema(fixture.schema, async (transaction) => {
        await transaction.$executeRawUnsafe(
          `INSERT INTO migration_job_items (id, "systemJobId", status, phase)
           VALUES ('safe', 'job-safe', 'FAILED', 'DISCOVERING')`
        )
      })
      const safe = runCli(fixture, 'audit')
      expect(safe.status, safe.stderr).toBe(0)
      expect(JSON.parse(safe.stdout).observations).toEqual(
        expect.arrayContaining([expect.objectContaining({ itemId: 'safe', closure: 'NO_FILE_SIDE_EFFECTS' })])
      )

      await mkdir(path.join(fixture.root, 'source'), { recursive: true })
      await mkdir(path.join(fixture.root, 'target'), { recursive: true })
      await writeFile(path.join(fixture.root, 'source', 'complete.jpg'), 'source')
      await writeFile(path.join(fixture.root, 'target', 'complete.jpg'), 'target')
      await withSchema(fixture.schema, async (transaction) => {
        await transaction.$executeRawUnsafe(
          `INSERT INTO migration_job_items (id, "systemJobId", status, phase)
           VALUES ('complete', 'job-complete', 'COMPLETED', 'FINALIZING')`
        )
        await transaction.$executeRawUnsafe(
          `INSERT INTO migration_file_entries
           (id, "itemId", ordinal, status, "sourceRelativePath", "targetRelativePath")
           VALUES ('file-complete', 'complete', 0, 'COMPLETED', 'source/complete.jpg', 'target/complete.jpg')`
        )
      })
      const sourceRemains = runCli(fixture, 'audit')
      expect(sourceRemains.status).toBe(2)
      expect(JSON.parse(sourceRemains.stdout).blockers).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'MIGRATION_SOURCE_REMAINS', itemId: 'complete' })])
      )
      await rm(path.join(fixture.root, 'source', 'complete.jpg'))
      expect(runCli(fixture, 'audit').status).toBe(0)

      await mkdir(path.join(fixture.root, 'normalized'), { recursive: true })
      await writeFile(path.join(fixture.root, 'normalized', 'same.jpg'), 'same')
      await withSchema(fixture.schema, async (transaction) => {
        await transaction.$executeRawUnsafe(
          `INSERT INTO migration_job_items (id, "systemJobId", status, phase)
           VALUES ('same-path', 'job-same-path', 'SKIPPED', 'FINALIZING')`
        )
        await transaction.$executeRawUnsafe(
          `INSERT INTO migration_file_entries
           (id, "itemId", ordinal, status, "sourceRelativePath", "targetRelativePath")
           VALUES ('file-same-path', 'same-path', 0, 'COMPLETED', '/normalized/same.jpg', 'normalized\\same.jpg')`
        )
      })
      const samePath = runCli(fixture, 'audit')
      expect(samePath.status, samePath.stderr).toBe(0)

      await withSchema(fixture.schema, async (transaction) => {
        await transaction.$executeRawUnsafe(
          `INSERT INTO migration_job_items (id, "systemJobId", status, phase)
           VALUES ('unsafe', 'job-unsafe', 'FAILED', 'STAGING_FILES')`
        )
        await transaction.$executeRawUnsafe(
          `INSERT INTO migration_file_entries
           (id, "itemId", ordinal, status, "sourceRelativePath", "targetRelativePath", "stagedRelativePath")
           VALUES ('file-unsafe', 'unsafe', 0, 'FAILED', 'source/a.jpg', 'target/a.jpg', 'staging/a.jpg')`
        )
      })
      const unsafe = runCli(fixture, 'audit')
      expect(unsafe.status).toBe(2)
      expect(JSON.parse(unsafe.stdout).blockers).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'MIGRATION_NOT_CLOSED', itemId: 'unsafe' })])
      )
    } finally {
      await fixture.dispose()
    }
  }, 30_000)

  it('leaves the first migration applied when the second migration gate fails', async () => {
    const fixture = await createFixture()
    try {
      const artistSql = await readFile(
        path.join(packageDirectory, 'prisma/migrations/20260930120000_retire_artist_legacy_identity/migration.sql'),
        'utf8'
      )
      const seriesSql = await readFile(
        path.join(packageDirectory, 'prisma/migrations/20260930121000_retire_series_legacy_fields/migration.sql'),
        'utf8'
      )
      await executeMigration(fixture.schema, artistSql)
      await withSchema(fixture.schema, (transaction) =>
        transaction.$executeRawUnsafe(`INSERT INTO "Artwork" (id, "seriesId") VALUES (10, 1)`)
      )
      await expect(executeMigration(fixture.schema, seriesSql)).rejects.toThrow('legacy series retirement blocked')

      const columns = await database!.$queryRawUnsafe<Array<{ tableName: string; columnName: string }>>(
        `SELECT table_name AS "tableName", column_name AS "columnName"
         FROM information_schema.columns
         WHERE table_schema = $1
           AND ((table_name = 'Artist' AND column_name = 'userId')
             OR (table_name = 'Artwork' AND column_name = 'seriesId')
             OR (table_name = 'Series' AND column_name IN ('source', 'externalId')))
         ORDER BY table_name, column_name`,
        fixture.schema
      )
      expect(columns).toEqual([
        { tableName: 'Artwork', columnName: 'seriesId' },
        { tableName: 'Series', columnName: 'externalId' },
        { tableName: 'Series', columnName: 'source' }
      ])
    } finally {
      await fixture.dispose()
    }
  })
})

async function createFixture() {
  const schema = `retire_${randomUUID().replace(/-/gu, '')}`
  const root = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-retire-'))
  const reports = path.join(root, 'reports')
  const manifest = path.join(root, 'checkpoint.json')
  await database!.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
  await withSchema(schema, createLegacySchema)
  await writeFile(
    manifest,
    JSON.stringify({
      checkpointId: 'test-checkpoint',
      createdAt: '2026-09-30T00:00:00.000Z',
      databaseDumpSha256: 'a'.repeat(64),
      originalMediaSnapshot: 'test-original',
      derivedMediaSnapshot: 'test-derived',
      pixivDataSnapshot: 'test-pixiv-data',
      configSnapshot: 'test-config',
      appImageDigest: 'sha256:test-app',
      workerImageDigest: 'sha256:test-worker',
      writesStoppedAt: '2026-09-30T00:00:00.000Z',
      operatorAssertions: {
        schedulerStopped: true,
        appStopped: true,
        workersStopped: true,
        externalWritersStopped: true
      }
    })
  )
  return {
    schema,
    root,
    reports,
    manifest,
    dispose: async () => {
      await database!.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await rm(root, { recursive: true, force: true })
    }
  }
}

async function createLegacySchema(transaction: Prisma.TransactionClient) {
  const statements = [
    `CREATE TABLE "Artist" (id integer PRIMARY KEY, "userId" text, "mergedIntoId" integer, username text)`,
    `CREATE UNIQUE INDEX unique_username_userid ON "Artist" (username, "userId")`,
    `CREATE TABLE "Series" (id integer PRIMARY KEY, source text NOT NULL DEFAULT 'LOCAL', "externalId" text)`,
    `CREATE TABLE "Artwork" (
      id integer PRIMARY KEY, "artistId" integer, "seriesId" integer, "storagePath" text UNIQUE, "metaSource" text
    )`,
    `CREATE TABLE "Image" (
      id integer PRIMARY KEY, "artworkId" integer, "sortOrder" integer NOT NULL DEFAULT 0,
      path text NOT NULL, "chaptersPath" text
    )`,
    `CREATE TABLE "SeriesArtwork" (
      "seriesId" integer NOT NULL, "artworkId" integer NOT NULL, "sortOrder" integer NOT NULL,
      "sourceOrder" integer, "orderOverridden" boolean NOT NULL DEFAULT false, "excludedAt" timestamp,
      provenance text NOT NULL DEFAULT 'LEGACY', "sourceRefId" text,
      UNIQUE ("seriesId", "artworkId")
    )`,
    `CREATE TABLE artist_external_refs (
      id text PRIMARY KEY, "artistId" integer NOT NULL, "providerKey" text NOT NULL, "externalId" text NOT NULL,
      "canonicalUrl" text, "createdAt" timestamp NOT NULL, "updatedAt" timestamp NOT NULL,
      UNIQUE ("artistId", "providerKey"), UNIQUE ("providerKey", "externalId")
    )`,
    `CREATE TABLE series_external_refs (
      id text PRIMARY KEY, "seriesId" integer NOT NULL, "providerKey" text NOT NULL, "externalId" text NOT NULL,
      "createdAt" timestamp NOT NULL, "updatedAt" timestamp NOT NULL,
      UNIQUE ("seriesId", "providerKey"), UNIQUE ("providerKey", "externalId")
    )`,
    `CREATE TABLE artwork_external_refs (
      id text PRIMARY KEY, "artworkId" integer NOT NULL, "providerKey" text NOT NULL, "externalId" text NOT NULL
    )`,
    `CREATE TABLE migration_job_items (
      id text PRIMARY KEY, "systemJobId" text NOT NULL, status text NOT NULL, phase text NOT NULL
    )`,
    `CREATE TABLE migration_file_entries (
      id text PRIMARY KEY, "itemId" text NOT NULL, ordinal integer NOT NULL, status text NOT NULL,
      "sourceRelativePath" text NOT NULL, "targetRelativePath" text NOT NULL, "stagedRelativePath" text
    )`
  ]
  for (const statement of statements) await transaction.$executeRawUnsafe(statement)
}

async function seedIdentityFixture(fixture: Awaited<ReturnType<typeof createFixture>>) {
  await mkdir(path.join(fixture.root, 'artist', 'work'), { recursive: true })
  await writeFile(path.join(fixture.root, 'artist', 'work', 'a.jpg'), 'fixture')
  await withSchema(fixture.schema, async (transaction) => {
    await transaction.$executeRawUnsafe(`INSERT INTO "Artist" (id, "userId") VALUES (1, 'p_local')`)
    await transaction.$executeRawUnsafe(
      `INSERT INTO "Series" (id, source, "externalId") VALUES (1, 'LOCAL', NULL), (2, 'LOCAL', NULL)`
    )
    await transaction.$executeRawUnsafe(
      `INSERT INTO "Artwork" (id, "artistId", "seriesId") VALUES (1, 1, 1), (2, NULL, 1), (3, NULL, NULL)`
    )
    await transaction.$executeRawUnsafe(
      `INSERT INTO "Image" (id, "artworkId", path) VALUES (1, 1, '/artist/work/a.jpg')`
    )
    await transaction.$executeRawUnsafe(
      `INSERT INTO "SeriesArtwork"
       ("seriesId", "artworkId", "sortOrder", provenance, "excludedAt") VALUES
       (2, 1, 3, 'MANUAL', CURRENT_TIMESTAMP),
       (2, 2, 4, 'MANUAL', CURRENT_TIMESTAMP),
       (1, 3, 7, 'MANUAL', NULL)`
    )
  })
}

function runCli(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  command: string,
  extra: string[] = []
) {
  const url = new URL(databaseUrl!)
  url.searchParams.set('schema', fixture.schema)
  const common = ['--data-root', fixture.root]
  if (command === 'prepare') common.push('--manifest', fixture.manifest, '--report-dir', fixture.reports)
  return spawnSync(process.execPath, [maintenance, command, ...common, ...extra], {
    cwd: packageDirectory,
    env: { ...process.env, DATABASE_URL: url.toString() },
    encoding: 'utf8'
  })
}

async function writeDecisions(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  report: { fingerprint: string },
  issues: Array<{ kind: string; artworkId: number; legacySeriesId: number; fingerprint: string }>,
  actions = ['KEEP_CURRENT', 'RESTORE_LEGACY']
) {
  const target = path.join(fixture.root, `decisions-${randomUUID()}.json`)
  await writeFile(
    target,
    JSON.stringify({
      auditFingerprint: report.fingerprint,
      decisions: issues.map((issue, index) => ({ ...issue, action: actions[index] }))
    })
  )
  return target
}

async function expectLegacyPointers(fixture: Awaited<ReturnType<typeof createFixture>>, count: number) {
  await withSchema(fixture.schema, async (transaction) => {
    const rows = await transaction.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*) AS count FROM "Artwork" WHERE "seriesId" IS NOT NULL`
    )
    expect(Number(rows[0]?.count)).toBe(count)
    const artist = await transaction.$queryRawUnsafe<Array<{ userId: string | null }>>(
      `SELECT "userId" FROM "Artist" WHERE id = 1`
    )
    expect(artist[0]?.userId).toBe('p_local')
  })
}

async function withSchema<T>(schema: string, run: (transaction: Prisma.TransactionClient) => Promise<T>) {
  return database!.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
    return run(transaction)
  })
}

async function executeMigration(schema: string, sql: string) {
  const statements = splitMigration(sql)
  return withSchema(schema, async (transaction) => {
    for (const statement of statements) await transaction.$executeRawUnsafe(statement)
  })
}

function splitMigration(sql: string) {
  const body = sql.replace(/^\s*BEGIN;\s*/u, '').replace(/\s*COMMIT;\s*$/u, '')
  const statements: string[] = []
  let remaining = body
  const doStart = remaining.indexOf('DO $$')
  const beforeDo = remaining.slice(0, doStart)
  statements.push(...beforeDo.split(';').map((item) => item.trim()).filter(Boolean))
  const doEnd = remaining.indexOf('$$;', doStart) + 2
  statements.push(remaining.slice(doStart, doEnd).trim())
  remaining = remaining.slice(doEnd + 1)
  statements.push(...remaining.split(';').map((item) => item.trim()).filter(Boolean))
  return statements
}
