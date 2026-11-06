import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { groupLogicalMedia } from '@pixishelf/job-contracts'

// This suite resets only the explicitly named, disposable migration fixture database.
const databaseUrl = process.env.READING_MIGRATION_TEST_DATABASE_URL
const migrationName = '20261104010000_reading_position_progress'
const prismaDirectory = path.resolve(process.cwd(), 'prisma')
const migration = readFileSync(path.join(prismaDirectory, 'migrations', migrationName, 'migration.sql'), 'utf8')
const maintenanceDirectory = path.resolve(process.cwd(), 'maintenance/reading-position-v1')
const preflight = readFileSync(path.join(maintenanceDirectory, 'preflight.sql'), 'utf8')
const preflightAudit = preflight.slice(preflight.indexOf('WITH names AS ('), preflight.indexOf('FROM audits;') + 'FROM audits'.length)
const require = createRequire(import.meta.url)
const prismaCli = require.resolve('prisma')
let temporaryDirectory: string | undefined

function sql(source: string) {
  return execFileSync('psql', [databaseUrl!, '-X', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'], {
    input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
  }).trim()
}
function query<T>(source: string): T {
  return JSON.parse(sql(`SELECT coalesce(json_agg(result), '[]'::json) FROM (${source}) result;`)) as T
}

const parityMedia = [
  { id: 9001, path: '/a/pair.apng', mediaType: 'ANIMATION' },
  { id: 9002, path: '/b/pair.webm', mediaType: 'VIDEO' },
  { id: 9003, path: '/c/pair.mp4', mediaType: 'VIDEO' },
  { id: 9004, path: '/a/query.apng', mediaType: 'UNKNOWN' },
  { id: 9005, path: '/b/query.MP4?v=1', mediaType: 'UNKNOWN' },
  { id: 9006, path: '/a/query.apng?v=1', mediaType: 'UNKNOWN' },
  { id: 9007, path: '/a/Case.apng', mediaType: 'ANIMATION' },
  { id: 9008, path: '/b/case.mp4', mediaType: 'VIDEO' },
  { id: 9009, path: 'C:\\a\\trailing.mp4\\', mediaType: 'VIDEO' },
  { id: 9010, path: '/b/trailing.apng', mediaType: 'ANIMATION' },
  { id: 9011, path: '/a/.apng', mediaType: 'ANIMATION' },
  { id: 9012, path: '/a/.mp4', mediaType: 'UNKNOWN' },
  { id: 9013, path: '/a/.hidden.apng', mediaType: 'ANIMATION' },
  { id: 9014, path: '/b/.hidden.avi', mediaType: 'UNKNOWN' },
  { id: 9015, path: '/a/..', mediaType: 'VIDEO' },
  { id: 9016, path: '/a/plain.jpg', mediaType: 'IMAGE' }
]

describe.skipIf(!databaseUrl).sequential('reading position migration on disposable PostgreSQL', () => {
  beforeAll(() => {
    const target = new URL(databaseUrl!)
    if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
      !/^\/pixishelf_reading_position_\d{8}_migrate_fixture$/.test(target.pathname)) {
      throw new Error('Use only the explicit localhost pixishelf_reading_position_DATE_migrate_fixture database')
    }
    sql('DROP SCHEMA IF EXISTS reading_legacy_v1 CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'pixishelf-reading-migration-'))
    cpSync(path.join(prismaDirectory, 'schema.prisma'), path.join(temporaryDirectory, 'schema.prisma'))
    for (const entry of readdirSync(path.join(prismaDirectory, 'migrations'))) {
      if (entry === migrationName) continue
      cpSync(path.join(prismaDirectory, 'migrations', entry), path.join(temporaryDirectory, 'migrations', entry), { recursive: true })
    }
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', path.join(temporaryDirectory, 'schema.prisma')], {
      env: { ...process.env, DATABASE_URL: databaseUrl! }, stdio: 'pipe'
    })
    sql(`
      INSERT INTO "UserBA" (id,"updatedAt") VALUES ('reading-fixture-user','2026-10-01');
      INSERT INTO "Artwork" (id,title,"updatedAt") SELECT n,'reading-fixture-'||n,'2026-10-01' FROM generate_series(1,9) n;
      INSERT INTO "Artwork" (id,title,"updatedAt") VALUES (90,'group-parity','2026-10-01');
      INSERT INTO "Image" (id,path,"sortOrder","artworkId","updatedAt","mediaType")
        SELECT a*100+n,'/fixture/'||a||'/'||n||'.jpg',n*17,a,'2026-10-01','IMAGE'::"MediaType"
        FROM generate_series(1,8) a CROSS JOIN generate_series(0,9) n;
      INSERT INTO artwork_reading_summaries ("userId","artworkId","seenCount","totalCount","viewCount","lastViewedAt","lastActiveAt","lastMediaId","lastMediaIndex","stateVersion","createdAt","updatedAt")
      VALUES
        ('reading-fixture-user',1,9,10,4,'2026-10-02','2026-10-03',105,5,7,'2026-10-01','2026-10-03'),
        ('reading-fixture-user',2,2,10,1,'2026-10-02','2026-10-03',207,7,2,'2026-10-01','2026-10-03'),
        ('reading-fixture-user',3,1,10,1,'2026-10-02','2026-10-03',309,9,0,'2026-10-01','2026-10-03'),
        ('reading-fixture-user',4,10,10,0,NULL,NULL,NULL,NULL,5,'2026-10-01','2026-10-03'),
        ('reading-fixture-user',5,9,10,2,'2026-10-02','2026-10-03',500,0,1,'2026-10-01','2026-10-03'),
        ('reading-fixture-user',7,1,10,2,'2026-10-02','2026-10-03',700,0,1,'2026-10-01','2026-10-03'),
        ('reading-fixture-user',9,0,0,0,NULL,NULL,NULL,NULL,0,'2026-10-01','2026-10-03');
      INSERT INTO artwork_read_media ("userId","artworkId","mediaId","firstSeenAt") VALUES
        ('reading-fixture-user',1,100,'2026-10-02'),
        ('reading-fixture-user',2,201,'2026-10-02'), ('reading-fixture-user',2,207,'2026-10-03'),
        ('reading-fixture-user',3,309,'2026-10-02'),
        ('reading-fixture-user',6,603,'2026-10-02'),
        ('reading-fixture-user',7,700,'2026-10-02');
      DELETE FROM "Image" WHERE id=700;
      INSERT INTO "Image" (id,path,"sortOrder","artworkId","updatedAt") VALUES (510,'/fixture/5/extra.jpg',200,5,'2026-10-03');
    `)
    for (const [index, item] of parityMedia.entries()) {
      const literal = (value: string) => `'${value.replaceAll("'", "''")}'`
      sql(`INSERT INTO "Image" (id,path,"sortOrder","artworkId","updatedAt","mediaType") VALUES (${item.id},${literal(item.path)},${Math.floor(index / 2) * 11},90,'2026-10-01',${literal(item.mediaType)}::"MediaType")`)
    }
    sql(`INSERT INTO artwork_reading_summaries ("userId","artworkId","seenCount","totalCount","viewCount","lastMediaId","lastMediaIndex","createdAt","updatedAt")
      VALUES ('reading-fixture-user',90,1,12,0,9001,0,'2026-10-01','2026-10-02');
      INSERT INTO artwork_read_media ("userId","artworkId","mediaId","firstSeenAt") VALUES ('reading-fixture-user',90,9001,'2026-10-02');`)
  }, 120_000)
  afterAll(() => {
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
  })

  it('matches groupLogicalMedia for APNG pairs, extensions, path stems and stable sparse ordering', () => {
    const mapping = migration.split('CREATE TEMP TABLE reading_position_media_map ON COMMIT DROP AS\n')[1]!.split(';\nCREATE UNIQUE INDEX')[0]!
    const actual = query<Array<{ member_id: number; owner_id: number; logical_index: number }>>(`${mapping} WHERE o."artworkId"=90 ORDER BY o.id`)
    const expected = groupLogicalMedia(parityMedia).flatMap((group, index) => group.members.map((member) => ({
      member_id: member.id, artworkId: 90, owner_id: group.item.id, logical_index: index
    }))).sort((left, right) => left.member_id - right.member_id)
    expect(actual).toEqual(expected)
  })

  it('preserves every legacy preflight diagnostic with set-based account/media joins', () => {
    // Keep the previous scalar audit as a semantic oracle on the small legacy fixture.
    const legacyAudit = preflightAudit.slice(0, preflightAudit.indexOf('), read_counts AS (')) + `), audits AS (
      SELECT s."userId",s."artworkId",s."seenCount",s."totalCount",c.logical_count,
        (s."totalCount">0 AND s."seenCount"::bigint*100>=s."totalCount"::bigint*90) AS keep_old_completed,
        s."lastMediaId" IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM media_map m WHERE m.member_id=s."lastMediaId" AND m."artworkId"=s."artworkId"
        ) AS invalid_last,
        (SELECT count(DISTINCT m.owner_id) FROM artwork_read_media r JOIN media_map m
          ON m.member_id=r."mediaId" AND m."artworkId"=r."artworkId"
          WHERE r."userId"=s."userId" AND r."artworkId"=s."artworkId") AS current_read_logical_count
      FROM artwork_reading_summaries s JOIN counts c ON c.id=s."artworkId"
    )` + preflightAudit.slice(preflightAudit.indexOf('\nSELECT count(*) AS summaries'))
    const expected = [{ summaries: 8, stale_total_snapshots: 2, differing_read_snapshots: 4,
      preserved_completed: 3, completed_with_stale_total: 1, invalid_last_anchors: 0 }]
    expect(query(preflightAudit)).toEqual(expected)
    expect(query(preflightAudit)).toEqual(query(legacyAudit))
    expect(sql(`SELECT count(*) FROM (SELECT "userId","artworkId" FROM artwork_read_media
      EXCEPT SELECT "userId","artworkId" FROM artwork_reading_summaries) k`)).toBe('1')
    // An APNG and its video are two read members but still one logical read; a last
    // Image from another artwork is invalid even though its legacy FK is satisfied.
    sql(`INSERT INTO artwork_read_media ("userId","artworkId","mediaId") VALUES ('reading-fixture-user',90,9002);
      UPDATE artwork_reading_summaries SET "lastMediaId"=603 WHERE "artworkId"=2;`)
    expect(query(preflightAudit)).toEqual([{ ...expected[0], invalid_last_anchors: 1 }])
    expect(query(preflightAudit)).toEqual(query(legacyAudit))
    sql(`DELETE FROM artwork_read_media WHERE "artworkId"=90 AND "mediaId"=9002;
      UPDATE artwork_reading_summaries SET "lastMediaId"=207 WHERE "artworkId"=2;`)
  })

  it('scans the logical mapping once per set join, while formal count lookups use the temporary index', () => {
    // Shadow only this psql session's tables: 20,000 synthetic media and 400 summaries.
    const fixture = `BEGIN;
      CREATE TEMP TABLE "Artwork" (id integer PRIMARY KEY,"logicalMediaCount" integer DEFAULT 0) ON COMMIT DROP;
      CREATE TEMP TABLE "Image" (id integer,"artworkId" integer,"sortOrder" integer,path text,"mediaType" text) ON COMMIT DROP;
      CREATE TEMP TABLE artwork_reading_summaries ("userId" text,"artworkId" integer,"seenCount" integer,"totalCount" integer,"lastMediaId" integer) ON COMMIT DROP;
      CREATE TEMP TABLE artwork_read_media ("userId" text,"artworkId" integer,"mediaId" integer) ON COMMIT DROP;
      INSERT INTO "Artwork" (id) SELECT generate_series(1,200);
      INSERT INTO "Image" SELECT (a.id-1)*100+p,a.id,p*17,'/fixture/large/'||a.id||'/'||p||'.jpg','IMAGE'
        FROM "Artwork" a CROSS JOIN generate_series(0,99) p;
      INSERT INTO artwork_reading_summaries SELECT 'account-'||u,a.id,20,100,(a.id-1)*100+19
        FROM "Artwork" a CROSS JOIN generate_series(1,2) u;
      INSERT INTO artwork_read_media SELECT 'account-'||u,a.id,(a.id-1)*100+p
        FROM "Artwork" a CROSS JOIN generate_series(1,2) u CROSS JOIN generate_series(0,19) p;
      ANALYZE "Artwork"; ANALYZE "Image"; ANALYZE artwork_reading_summaries; ANALYZE artwork_read_media;`
    interface PlanNode {
      'Node Type': string
      'Parent Relationship'?: string
      'CTE Name'?: string
      'Actual Loops'?: number
      'Actual Rows'?: number
      'Index Cond'?: string
      Plans?: PlanNode[]
    }
    const plan = JSON.parse(sql(`${fixture} EXPLAIN (ANALYZE,FORMAT JSON) ${preflightAudit}; ROLLBACK;`))[0].Plan as PlanNode
    const nodes: PlanNode[] = []
    const visit = (node: PlanNode) => { nodes.push(node); node.Plans?.forEach(visit) }
    visit(plan)
    expect(nodes.some((node) => node['Parent Relationship'] === 'SubPlan')).toBe(false)
    const mapScans = nodes.filter((node) => node['Node Type'] === 'CTE Scan' && node['CTE Name'] === 'media_map')
    expect(mapScans.length).toBeGreaterThan(0)
    expect(mapScans.every((node) => node['Actual Loops'] === 1)).toBe(true)

    const mappingSetup = migration.slice(migration.indexOf('CREATE TEMP TABLE reading_position_media_map'), migration.indexOf('UPDATE "Artwork" a'))
    const countUpdate = migration.slice(migration.indexOf('UPDATE "Artwork" a'), migration.indexOf('CREATE TEMP TABLE reading_position_expected_progress'))
    const formalPlan = JSON.parse(sql(`${fixture} ${mappingSetup} EXPLAIN (FORMAT JSON) ${countUpdate} ROLLBACK;`))[0].Plan as PlanNode
    nodes.length = 0
    visit(formalPlan)
    expect(nodes.some((node) => node['Index Cond']?.includes('"artworkId" = a.id'))).toBe(true)
    // Execute only the unchanged count expression as a SELECT over synthetic temp
    // tables: each of 200 artworks reads its own 100 rows, not the whole mapping.
    const countSelect = countUpdate.replace('UPDATE "Artwork" a SET "logicalMediaCount" =', 'SELECT a.id,')
      .replace(/;\s*$/, ' AS logical_count FROM "Artwork" a')
    const countPlan = JSON.parse(sql(`${fixture} ${mappingSetup} EXPLAIN (ANALYZE,FORMAT JSON) ${countSelect}; ROLLBACK;`))[0].Plan as PlanNode
    nodes.length = 0
    visit(countPlan)
    const indexedCount = nodes.find((node) => node['Index Cond']?.includes('"artworkId" = a.id'))
    expect(indexedCount?.['Actual Loops']).toBe(200)
    expect(indexedCount?.['Actual Rows']).toBe(100)
  })

  it('runs read-only preflight and fully rolls back DDL/backfill/sealing on a late failure', () => {
    sql(readFileSync(path.join(maintenanceDirectory, 'preflight.sql'), 'utf8'))
    const failed = spawnSync('psql', [databaseUrl!, '-X', '-v', 'ON_ERROR_STOP=1', '-q'], {
      input: migration.replace(/COMMIT;\s*$/, "DO $$ BEGIN RAISE EXCEPTION 'fixture rollback'; END $$;\nCOMMIT;"), encoding: 'utf8'
    })
    expect(failed.status).not.toBe(0)
    expect(failed.stderr).toContain('fixture rollback')
    const assertionFailure = spawnSync('psql', [databaseUrl!, '-X', '-v', 'ON_ERROR_STOP=1', '-q'], {
      input: migration.replace('INSERT INTO artwork_reading_progress SELECT * FROM reading_position_expected_progress;',
        'INSERT INTO artwork_reading_progress SELECT * FROM reading_position_expected_progress; UPDATE artwork_reading_progress SET completed=NOT completed WHERE "artworkId"=2;'), encoding: 'utf8'
    })
    expect(assertionFailure.status).not.toBe(0)
    expect(assertionFailure.stderr).toContain('differ from expected progress')
    expect(query<Array<{ old_table: boolean; new_table: boolean; new_column: boolean }>>(`SELECT
      to_regclass('public.artwork_reading_summaries') IS NOT NULL AS old_table,
      to_regclass('public.artwork_reading_progress') IS NOT NULL AS new_table,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Artwork' AND column_name='logicalMediaCount') AS new_column`
    )).toEqual([{ old_table: true, new_table: false, new_column: false }])
  })

  it('deploys phase 1 through Prisma history and preserves completion, sparse positions and history', () => {
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', path.join(prismaDirectory, 'schema.prisma')], {
      env: { ...process.env, DATABASE_URL: databaseUrl! }, stdio: 'pipe'
    })
    const postflight = readFileSync(path.join(maintenanceDirectory, 'postflight.sql'), 'utf8')
    sql(postflight)
    const postflightAudit = postflight.slice(postflight.indexOf('WITH names AS ('), postflight.indexOf('INTO progress_mismatches'))
    // The two final counts may use InitPlans; neither depends on an outer progress row.
    expect(sql(`EXPLAIN (ANALYZE,FORMAT JSON) ${postflightAudit}`)).not.toMatch(/"Parent Relationship":\s*"SubPlan"/)
    const rows = query<Array<Record<string, unknown>>>('SELECT * FROM artwork_reading_progress ORDER BY "artworkId"')
    const find = (artworkId: number) => rows.find((row) => row.artworkId === artworkId)
    expect(rows).toHaveLength(9)
    expect(find(1)).toMatchObject({ completed: true, furthestMediaIndex: 0, lastMediaIndex: 5, viewCount: 4, stateVersion: 8 })
    expect(find(2)).toMatchObject({ completed: false, furthestMediaId: 207, furthestMediaIndex: 7, lastMediaIndex: 7 })
    expect(find(3)).toMatchObject({ completed: true, furthestMediaIndex: 9 })
    expect(find(4)).toMatchObject({ completed: true, viewCount: 0, lastViewedAt: null, lastActiveAt: null, lastMediaId: null, furthestMediaId: null })
    expect(find(5)).toMatchObject({ completed: true, stateVersion: 2 })
    expect(find(6)).toMatchObject({ completed: false, furthestMediaIndex: 3, viewCount: 0, lastViewedAt: null, lastActiveAt: null, stateVersion: 1 })
    expect(find(7)).toMatchObject({ completed: false, lastMediaId: null, lastMediaIndex: null, furthestMediaId: null })
    expect(find(9)).toMatchObject({ completed: false, furthestMediaIndex: null })
    expect(find(90)).toMatchObject({ completed: false, furthestMediaId: 9002, furthestMediaIndex: 0, lastMediaId: 9002, lastMediaIndex: 0 })
    expect(query<Array<{ count: number }>>('SELECT "logicalMediaCount" AS count FROM "Artwork" WHERE id=90')).toEqual([{ count: groupLogicalMedia(parityMedia).length }])
    expect(sql(`SELECT count(*) FROM _prisma_migrations WHERE migration_name='${migrationName}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`)).toBe('1')
    expect(sql(`SELECT count(*) FROM artwork_dedup_group_choices('missing-run','reading-fixture-user')`)).toBe('0')
  })

  it('rejects equal-count wrong keys, wrong anchors, cached totals and completion in read-only postflight', () => {
    const postflight = readFileSync(path.join(maintenanceDirectory, 'postflight.sql'), 'utf8')
    const corruptions = [
      ['UPDATE artwork_reading_progress SET "artworkId"=8 WHERE "artworkId"=2', 'UPDATE artwork_reading_progress SET "artworkId"=2 WHERE "artworkId"=8'],
      ['UPDATE artwork_reading_progress SET "furthestMediaId"=201 WHERE "artworkId"=2', 'UPDATE artwork_reading_progress SET "furthestMediaId"=207 WHERE "artworkId"=2'],
      ['UPDATE artwork_reading_progress SET "furthestMediaIndex"=6 WHERE "artworkId"=2', 'UPDATE artwork_reading_progress SET "furthestMediaIndex"=7 WHERE "artworkId"=2'],
      ['UPDATE artwork_reading_progress SET "furthestMediaId"=604,"furthestMediaIndex"=4 WHERE "artworkId"=6', 'UPDATE artwork_reading_progress SET "furthestMediaId"=603,"furthestMediaIndex"=3 WHERE "artworkId"=6'],
      ['UPDATE "Artwork" SET "logicalMediaCount"=11 WHERE id=2', 'UPDATE "Artwork" SET "logicalMediaCount"=10 WHERE id=2'],
      ['UPDATE artwork_reading_progress SET completed=true WHERE "artworkId"=2', 'UPDATE artwork_reading_progress SET completed=false WHERE "artworkId"=2'],
      ['UPDATE artwork_reading_progress SET "lastMediaId"=201,"lastMediaIndex"=1 WHERE "artworkId"=2', 'UPDATE artwork_reading_progress SET "lastMediaId"=207,"lastMediaIndex"=7 WHERE "artworkId"=2']
    ]
    for (const [corrupt, restore] of corruptions) {
      sql(corrupt!)
      expect(() => sql(postflight)).toThrow(/Reading postflight failed/)
      sql(restore!)
      sql(postflight)
    }
  })

  it('keeps sealed evidence unchanged after business deletion, then executes independent RESTRICT cleanup', () => {
    const before = sql('SELECT json_build_array((SELECT json_agg(s) FROM reading_legacy_v1.artwork_reading_summaries s), (SELECT json_agg(r) FROM reading_legacy_v1.artwork_read_media r))')
    sql('DELETE FROM "Image" WHERE "artworkId"=1; DELETE FROM "Artwork" WHERE id=1; DELETE FROM "UserBA" WHERE id=\'reading-fixture-user\';')
    expect(sql('SELECT count(*) FROM artwork_reading_progress')).toBe('0')
    expect(sql('SELECT json_build_array((SELECT json_agg(s) FROM reading_legacy_v1.artwork_reading_summaries s), (SELECT json_agg(r) FROM reading_legacy_v1.artwork_read_media r))')).toBe(before)
    expect(sql("SELECT to_regclass('reading_legacy_v1.artwork_read_media') IS NOT NULL")).toBe('t')
    const cleanupPreflight = readFileSync(path.join(maintenanceDirectory, 'cleanup-preflight.sql'), 'utf8')
    sql('CREATE VIEW public.reading_test_reference AS SELECT * FROM reading_legacy_v1.artwork_read_media')
    expect(() => sql(cleanupPreflight)).toThrow(/still reads sealed tables|depends on sealed tables/)
    sql('DROP VIEW public.reading_test_reference')
    sql(cleanupPreflight)
    const cleanup = readFileSync(path.join(maintenanceDirectory, 'phase2-cleanup.sql'), 'utf8')
    sql('CREATE TABLE reading_legacy_v1.unexpected_dependency (id integer)')
    expect(() => sql(cleanup)).toThrow()
    expect(sql("SELECT to_regclass('reading_legacy_v1.artwork_read_media') IS NOT NULL")).toBe('t')
    sql('DROP TABLE reading_legacy_v1.unexpected_dependency')
    sql(cleanup)
    expect(sql("SELECT count(*) FROM pg_namespace WHERE nspname='reading_legacy_v1'")).toBe('0')
    expect(migration).not.toMatch(/DROP\s+TABLE/i)
  })
})
