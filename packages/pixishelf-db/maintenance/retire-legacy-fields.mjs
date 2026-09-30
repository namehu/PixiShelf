#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const ARTIST_MIGRATION = '20260930120000_retire_artist_legacy_identity'
const SERIES_MIGRATION = '20260930121000_retire_series_legacy_fields'
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const packageDirectory = path.resolve(scriptDirectory, '..')
const schemaPath = path.join(packageDirectory, 'prisma', 'schema.prisma')
const command = process.argv[2]
let options
try {
  options = parseOptions(process.argv.slice(3))
} catch (error) {
  console.error(`[retire-legacy-fields] ${error instanceof Error ? error.message : String(error)}`)
  failUsage()
}

if (!['audit', 'prepare', 'upgrade', 'guard-startup'].includes(command ?? '')) {
  failUsage()
}

const client = new PrismaClient()
try {
  if (command === 'guard-startup') await guardStartup(client)
  if (command === 'audit') await runAudit(client, options)
  if (command === 'prepare') await runPrepare(client, options)
  if (command === 'upgrade') await runUpgrade(client, options)
} catch (error) {
  console.error(`[retire-legacy-fields] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await client.$disconnect()
}

function parseOptions(arguments_) {
  const parsed = { scope: 'all', transactionTimeoutMs: 1800000 }
  const allowed = new Set(['scope', 'decisions', 'manifest', 'report-dir', 'report', 'data-root', 'transaction-timeout-ms'])
  for (let index = 0; index < arguments_.length; index += 1) {
    const key = arguments_[index]
    if (!key?.startsWith('--')) throw new Error(`Unexpected argument: ${key}`)
    const name = key.slice(2)
    if (!allowed.has(name)) throw new Error(`Unknown option: --${name}`)
    const value = arguments_[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`)
    parsed[toCamelCase(name)] = value
    index += 1
  }
  if (!['all', 'artist', 'series'].includes(parsed.scope)) {
    throw new Error('--scope must be all, artist, or series')
  }
  if (!/^\d+$/.test(String(parsed.transactionTimeoutMs))) {
    throw new Error('--transaction-timeout-ms must be an integer between 1000 and 7200000')
  }
  parsed.transactionTimeoutMs = Number(parsed.transactionTimeoutMs)
  if (!Number.isSafeInteger(parsed.transactionTimeoutMs) || parsed.transactionTimeoutMs < 1000 || parsed.transactionTimeoutMs > 7200000) {
    throw new Error('--transaction-timeout-ms must be an integer between 1000 and 7200000')
  }
  return parsed
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())
}

function failUsage() {
  console.error(
    'Usage: retire-legacy-fields.mjs <audit|prepare|upgrade|guard-startup> ' +
      '[--scope all|artist|series] [--decisions file.json] [--manifest file.json] ' +
      '[--report-dir directory] [--report file.json] [--data-root directory] ' +
      '[--transaction-timeout-ms milliseconds (prepare; default 1800000, max 7200000)]'
  )
  process.exit(1)
}

async function guardStartup(db) {
  const state = await inspectSchemaState(db)
  if (state.empty || state.upgraded) return
  console.error('[retire-legacy-fields] This existing database still contains legacy artist/series fields.')
  console.error(
    '[retire-legacy-fields] Keep App and Worker stopped, then run the maintenance audit/prepare/upgrade flow.'
  )
  process.exitCode = 2
}

async function runAudit(db, input) {
  const report = await audit(db, input)
  writeJsonToStdout(report)
  if (input.report) await writeJsonFile(input.report, report)
  if (report.blockers.length > 0) process.exitCode = 2
}

async function runPrepare(db, input) {
  requireOption(input, 'manifest')
  requireOption(input, 'reportDir')
  const manifest = await readAndValidateManifest(input.manifest)
  console.error('[retire-legacy-fields] prepare: starting read-only audit')
  const before = await audit(db, { ...input, scope: 'all' })
  await writeReport(input.reportDir, 'prepare-before', { manifest: manifestSummary(manifest), report: before })

  const decisions = input.decisions ? await readDecisions(input.decisions, before.fingerprint) : { decisions: [] }
  const decisionMap = new Map(decisions.decisions.map((decision) => [decisionKey(decision), decision]))
  const unresolved = before.blockers.filter((blocker) => !isSatisfiedByDecision(blocker, decisionMap))
  if (unresolved.length > 0) {
    writeJsonToStdout({ status: 'blocked', fingerprint: before.fingerprint, blockers: unresolved })
    process.exitCode = 2
    return
  }

  console.error(`[retire-legacy-fields] prepare: transaction timeout ${input.transactionTimeoutMs}ms; ${before.actions.length} automatic actions, ${before.blockers.length} decisions`)
  await db.$transaction(
    async (transaction) => {
      await transaction.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('pixishelf:retire-legacy-fields'))")
      await lockLegacyTables(transaction)
      console.error('[retire-legacy-fields] prepare: locks acquired; rechecking audit inside transaction')
      await assertAuditStillCurrent(transaction, before, input)
      console.error('[retire-legacy-fields] prepare: audit unchanged; applying actions')
      for (const [index, action] of before.actions.entries()) {
        await applyAutomaticAction(transaction, action)
        if ((index + 1) % 500 === 0) console.error(`[retire-legacy-fields] prepare: applied ${index + 1}/${before.actions.length} automatic actions (not committed)`)
      }
      for (const blocker of before.blockers) {
        await applyDecision(transaction, blocker, decisionMap.get(decisionKey(blocker)))
      }
      console.error('[retire-legacy-fields] prepare: checking result before commit')
      const transactionAfter = await audit(transaction, { ...input, scope: 'all' })
      if (transactionAfter.blockers.length > 0) {
        throw new Error('Prepare would leave retirement blockers; the transaction was rolled back')
      }
    },
    { timeout: input.transactionTimeoutMs }
  )

  console.error('[retire-legacy-fields] prepare: transaction committed; final audit')
  const after = await audit(db, { ...input, scope: 'all' })
  await writeReport(input.reportDir, 'prepare-after', { manifest: manifestSummary(manifest), report: after })
  writeJsonToStdout(after)
  if (after.blockers.length > 0) process.exitCode = 2
}

async function runUpgrade(db, input) {
  if (input.scope !== 'all') throw new Error('upgrade always covers both artist and series; --scope must be all')
  requireOption(input, 'manifest')
  requireOption(input, 'reportDir')
  const manifest = await readAndValidateManifest(input.manifest)
  const before = await audit(db, { ...input, scope: 'all' })
  await writeReport(input.reportDir, 'upgrade-before', { manifest: manifestSummary(manifest), report: before })
  if (before.blockers.length > 0) {
    writeJsonToStdout({ status: 'blocked', fingerprint: before.fingerprint, blockers: before.blockers })
    process.exitCode = 2
    return
  }

  const prismaCli = await resolvePrismaCli()
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy', `--schema=${schemaPath}`], {
    cwd: packageDirectory,
    env: process.env,
    encoding: 'utf8'
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error || result.status !== 0) {
    throw new Error(
      `Prisma migrate deploy failed; services must remain stopped. ${result.error?.message ?? `exit ${result.status}`}`
    )
  }

  const after = await audit(db, { ...input, scope: 'all' })
  await writeReport(input.reportDir, 'upgrade-after', { manifest: manifestSummary(manifest), report: after })
  if (!after.schema.upgraded || after.blockers.length > 0) {
    throw new Error('Migration command finished but the final schema audit did not pass; services must remain stopped')
  }
  writeJsonToStdout(after)
}

async function resolvePrismaCli() {
  const require = createRequire(import.meta.url)
  try {
    return require.resolve('prisma')
  } catch {
    const configured = process.env.PRISMA_CLI_PATH
    const candidates = [configured, '/usr/local/lib/node_modules/prisma/build/index.js'].filter(Boolean)
    for (const candidate of candidates) {
      try {
        await fs.access(candidate)
        return candidate
      } catch {
        // Try the next production image location.
      }
    }
    throw new Error('Prisma CLI could not be resolved; set PRISMA_CLI_PATH to its JavaScript entrypoint')
  }
}

async function audit(db, input) {
  const schema = await inspectSchemaState(db)
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    scope: input.scope ?? 'all',
    schema,
    actions: [],
    blockers: [],
    observations: []
  }
  if (schema.empty) return withFingerprint(report)

  const dataRoot = resolveDataRoot(input)
  const migrationClosure = await auditMigrationClosure(db, dataRoot)
  report.blockers.push(...migrationClosure.blockers)
  report.observations.push(...migrationClosure.observations)

  if ((input.scope === 'all' || input.scope === 'artist') && schema.columns.artistUserId) {
    const artist = await auditArtists(db, dataRoot)
    report.actions.push(...artist.actions)
    report.blockers.push(...artist.blockers)
  }
  if (
    (input.scope === 'all' || input.scope === 'series') &&
    (schema.columns.artworkSeriesId || schema.columns.seriesSource || schema.columns.seriesExternalId)
  ) {
    const series = await auditSeries(db)
    report.actions.push(...series.actions)
    report.blockers.push(...series.blockers)
  }
  return withFingerprint(report)
}

function resolveDataRoot(input) {
  return input.dataRoot ?? process.env.PIXISHELF_DATA_ROOT ?? process.env.SCAN_PATH ?? process.env.ARCHIVE_STORAGE_PATH
}

async function inspectSchemaState(db) {
  const tableRows = await db.$queryRawUnsafe(`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name IN ('Artist', 'Artwork', 'Series', '_prisma_migrations')
  `)
  const tables = new Set(tableRows.map((row) => row.tableName))
  const empty = !tables.has('Artist') && !tables.has('Artwork') && !tables.has('Series')
  if (empty) {
    return {
      empty: true,
      upgraded: false,
      columns: { artistUserId: false, artworkSeriesId: false, seriesSource: false, seriesExternalId: false },
      migrations: []
    }
  }
  const columnRows = await db.$queryRawUnsafe(`
    SELECT table_name AS "tableName", column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND (
        (table_name = 'Artist' AND column_name = 'userId')
        OR (table_name = 'Artwork' AND column_name = 'seriesId')
        OR (table_name = 'Series' AND column_name IN ('source', 'externalId'))
      )
  `)
  const columns = {
    artistUserId: columnRows.some((row) => row.tableName === 'Artist' && row.columnName === 'userId'),
    artworkSeriesId: columnRows.some((row) => row.tableName === 'Artwork' && row.columnName === 'seriesId'),
    seriesSource: columnRows.some((row) => row.tableName === 'Series' && row.columnName === 'source'),
    seriesExternalId: columnRows.some((row) => row.tableName === 'Series' && row.columnName === 'externalId')
  }
  const migrations = tables.has('_prisma_migrations')
    ? await db.$queryRawUnsafe(
        `SELECT migration_name AS "migrationName", finished_at AS "finishedAt", rolled_back_at AS "rolledBackAt"
         FROM "_prisma_migrations"
         WHERE migration_name IN ($1, $2)
         ORDER BY migration_name`,
        ARTIST_MIGRATION,
        SERIES_MIGRATION
      )
    : []
  const completed = new Set(
    migrations.filter((row) => row.finishedAt && !row.rolledBackAt).map((row) => row.migrationName)
  )
  return {
    empty: false,
    upgraded:
      !Object.values(columns).some(Boolean) && completed.has(ARTIST_MIGRATION) && completed.has(SERIES_MIGRATION),
    columns,
    migrations: [...completed]
  }
}

async function auditArtists(db, dataRoot) {
  const legacyRows = await db.$queryRawUnsafe(`
    SELECT
      artist.id,
      artist."userId",
      artist."mergedIntoId",
      (SELECT count(*)::integer FROM "Artist" duplicate WHERE duplicate."userId" = artist."userId") AS "ownerCount",
      EXISTS (
        SELECT 1 FROM "Artwork" artwork
        JOIN artwork_external_refs artwork_ref ON artwork_ref."artworkId" = artwork.id
        WHERE artwork."artistId" = artist.id AND artwork_ref."providerKey" = 'pixiv'
      ) AS "hasPixivArtworkEvidence",
      (SELECT external_ref."externalId" FROM artist_external_refs external_ref
       WHERE external_ref."artistId" = artist.id AND external_ref."providerKey" = 'pixiv' LIMIT 1) AS "currentPixivId",
      (SELECT external_ref."artistId" FROM artist_external_refs external_ref
       WHERE external_ref."providerKey" = 'pixiv' AND external_ref."externalId" = artist."userId" LIMIT 1) AS "legacyPixivOwnerId"
    FROM "Artist" artist
    WHERE artist."userId" IS NOT NULL
    ORDER BY artist.id
  `)
  const actions = []
  const blockers = []
  for (const row of legacyRows) {
    const core = {
      kind: 'artist-legacy-id',
      artistId: row.id,
      legacyUserId: row.userId,
      currentPixivId: row.currentPixivId,
      ownerCount: row.ownerCount,
      mergedIntoId: row.mergedIntoId
    }
    const storage = await verifyArtistStorage(db, row.id, dataRoot)
    actions.push(...storage.actions)
    if (!storage.ok) {
      blockers.push(
        issue(
          { ...core, storage: { ...storage, actions: undefined } },
          'ARTIST_STORAGE_UNVERIFIED',
          'Legacy artist identity cannot be removed until every owned media path is durably recorded and verified',
          []
        )
      )
      continue
    }
    if (row.currentPixivId === row.userId) {
      actions.push(action({ ...core, storage }, 'CLEAR_ARTIST_LEGACY_ID', 'matching provider identity already exists'))
      continue
    }
    if (row.currentPixivId || row.legacyPixivOwnerId) {
      blockers.push(
        issue(
          { ...core, storage },
          'ARTIST_IDENTITY_CONFLICT',
          'Legacy identity conflicts with an existing Pixiv identity',
          storage.ok ? ['CLEAR_LOCAL'] : []
        )
      )
      continue
    }
    const numeric = /^[1-9][0-9]*$/u.test(row.userId)
    if (numeric && row.ownerCount === 1 && row.hasPixivArtworkEvidence) {
      actions.push(
        action({ ...core, storage }, 'CREATE_ARTIST_PIXIV_REF_AND_CLEAR', 'unique numeric id with Pixiv artwork evidence')
      )
      continue
    }
    if (numeric) {
      blockers.push(
        issue(
          { ...core, storage },
          'ARTIST_PIXIV_ID_UNPROVEN',
          'Numeric legacy id lacks the strong evidence required for automatic claim',
          ['CLEAR_LOCAL']
        )
      )
      continue
    }
    actions.push(action({ ...core, storage }, 'CLEAR_ARTIST_LEGACY_ID', 'non-Pixiv legacy id has durable storage paths'))
  }
  return { actions, blockers }
}

async function verifyArtistStorage(db, artistId, dataRoot) {
  const artworks = await db.$queryRawUnsafe(
    `SELECT id, "storagePath", "metaSource" FROM "Artwork" WHERE "artistId" = $1 ORDER BY id`,
    artistId
  )
  if (artworks.length === 0) return { ok: true, artworkCount: 0, checkedPaths: 0, actions: [] }
  if (!dataRoot) return { ok: false, reason: 'data root is required', artworkCount: artworks.length, actions: [] }
  const root = path.resolve(dataRoot)
  let checkedPaths = 0
  const actions = []
  for (const artwork of artworks) {
    const images = await db.$queryRawUnsafe(
      `SELECT path, "chaptersPath" FROM "Image" WHERE "artworkId" = $1 ORDER BY "sortOrder", id`,
      artwork.id
    )
    const filePaths = [artwork.metaSource, ...images.flatMap((image) => [image.path, image.chaptersPath])].filter(Boolean)
    let storagePath = artwork.storagePath
    if (!storagePath) {
      const inferred = inferArtworkStoragePath(filePaths)
      if (!inferred) return { ok: false, reason: `Artwork ${artwork.id} has no unambiguous storagePath`, actions }
      const conflicting = await db.$queryRawUnsafe(
        `SELECT id FROM "Artwork" WHERE "storagePath" = $1 AND id <> $2 LIMIT 1`,
        inferred,
        artwork.id
      )
      if (conflicting.length > 0) {
        return {
          ok: false,
          reason: `Artwork ${artwork.id} inferred storagePath is already owned by Artwork ${conflicting[0].id}`,
          storagePath: inferred,
          actions
        }
      }
      storagePath = inferred
      actions.push(
        action(
          { kind: 'artwork-storage-path', artworkId: artwork.id, expectedStoragePath: null, storagePath },
          'SET_ARTWORK_STORAGE_PATH',
          'all persisted media and metadata paths identify one artwork directory'
        )
      )
    }
    const normalizedStorage = normalizeStoredRelativePath(storagePath)
    if (!normalizedStorage) {
      return { ok: false, reason: `Artwork ${artwork.id} has an unsafe storagePath`, path: storagePath, actions }
    }
    const ownedPaths = [storagePath, ...filePaths]
    for (const candidate of ownedPaths) {
      const normalizedCandidate = normalizeStoredRelativePath(candidate)
      if (!normalizedCandidate) {
        return { ok: false, reason: `Artwork ${artwork.id} has an unsafe stored path`, path: candidate, actions }
      }
      if (normalizedCandidate !== normalizedStorage && !normalizedCandidate.startsWith(`${normalizedStorage}/`)) {
        return {
          ok: false,
          reason: `Artwork ${artwork.id} has media outside its storagePath`,
          path: candidate,
          storagePath,
          actions
        }
      }
      const result = await verifyPathWithinRoot(root, candidate)
      if (!result.ok) return { ok: false, reason: `Artwork ${artwork.id}: ${result.reason}`, path: candidate, actions }
      checkedPaths += 1
    }
  }
  return { ok: true, artworkCount: artworks.length, checkedPaths, actions }
}

function inferArtworkStoragePath(paths) {
  const normalized = paths.map(normalizeStoredRelativePath).filter(Boolean)
  if (normalized.length === 0 || normalized.length !== paths.length) return null
  const parents = new Set(normalized.map((item) => path.posix.dirname(item)))
  if (parents.size !== 1) return null
  const candidate = parents.values().next().value
  return candidate && candidate !== '.' ? candidate : null
}

async function auditSeries(db) {
  const actions = []
  const blockers = []
  const schema = await inspectSchemaState(db)
  if (schema.columns.seriesSource && schema.columns.seriesExternalId) {
    const rows = await db.$queryRawUnsafe(`
      SELECT
        series.id,
        series.source,
        series."externalId",
        (SELECT count(*)::integer FROM "Series" duplicate
          WHERE upper(btrim(duplicate.source)) = upper(btrim(series.source))
            AND duplicate."externalId" IS NOT DISTINCT FROM series."externalId") AS "ownerCount",
        (SELECT external_ref."externalId" FROM series_external_refs external_ref
          WHERE external_ref."seriesId" = series.id AND external_ref."providerKey" = 'pixiv' LIMIT 1) AS "currentPixivId",
        (SELECT external_ref."seriesId" FROM series_external_refs external_ref
          WHERE external_ref."providerKey" = 'pixiv' AND external_ref."externalId" = series."externalId" LIMIT 1) AS "legacyPixivOwnerId",
        EXISTS (SELECT 1 FROM "SeriesArtwork" membership WHERE membership."seriesId" = series.id) AS "hasMembers",
        NOT EXISTS (
          SELECT 1
          FROM "SeriesArtwork" membership
          WHERE membership."seriesId" = series.id
            AND (
              (SELECT count(*) FROM artwork_external_refs artwork_ref
               WHERE artwork_ref."artworkId" = membership."artworkId"
                 AND artwork_ref."providerKey" = 'pixiv'
                 AND artwork_ref."externalId" ~ '^[1-9][0-9]*$') <> 1
              OR
              (SELECT count(*) FROM "SeriesArtwork" other_membership
               WHERE other_membership."artworkId" = membership."artworkId") <> 1
            )
        ) AS "allMembersHavePixivRefs"
      FROM "Series" series
      ORDER BY series.id
    `)
    for (const row of rows) {
      const source = row.source.trim().toUpperCase()
      const core = {
        kind: 'series-legacy-identity',
        seriesId: row.id,
        legacySource: row.source,
        legacyExternalId: row.externalId,
        currentPixivId: row.currentPixivId
      }
      if (source === 'LOCAL' && row.externalId === null) continue
      if (source === 'PIXIV' && row.currentPixivId === row.externalId) continue
      if (source === 'PIXIV' && row.currentPixivId && row.currentPixivId !== row.externalId) {
        blockers.push(issue(core, 'SERIES_IDENTITY_CONFLICT', 'Legacy and provider identities disagree', [
          'DISCARD_LEGACY_IDENTITY'
        ]))
        continue
      }
      const strong =
        source === 'PIXIV' &&
        /^[1-9][0-9]*$/u.test(row.externalId ?? '') &&
        row.ownerCount === 1 &&
        !row.legacyPixivOwnerId &&
        row.hasMembers &&
        row.allMembersHavePixivRefs
      if (strong) {
        actions.push(action(core, 'CREATE_SERIES_PIXIV_REF', 'unique numeric id with unambiguous Pixiv members'))
      } else {
        const allowedActions = ['DISCARD_LEGACY_IDENTITY']
        if (source === 'PIXIV' && /^[1-9][0-9]*$/u.test(row.externalId ?? '') && !row.legacyPixivOwnerId) {
          allowedActions.push('CREATE_PIXIV_REF')
        }
        blockers.push(
          issue(core, 'SERIES_IDENTITY_UNPROVEN', 'Legacy series identity cannot be automatically preserved', allowedActions)
        )
      }
    }
  }

  if (schema.columns.artworkSeriesId) {
    const pointers = await db.$queryRawUnsafe(`
      SELECT
        artwork.id AS "artworkId",
        artwork."seriesId" AS "legacySeriesId",
        EXISTS (
          SELECT 1 FROM "SeriesArtwork" membership
          WHERE membership."artworkId" = artwork.id AND membership."seriesId" = artwork."seriesId"
        ) AS "matchingMembership",
        (SELECT coalesce(max(membership."sortOrder"), -1) FROM "SeriesArtwork" membership
          WHERE membership."seriesId" = artwork."seriesId")::integer AS "maximumSortOrder"
      FROM "Artwork" artwork
      WHERE artwork."seriesId" IS NOT NULL
      ORDER BY artwork.id
    `)
    for (const row of pointers) {
      const core = {
        kind: 'series-membership',
        artworkId: row.artworkId,
        legacySeriesId: row.legacySeriesId,
        maximumSortOrder: row.maximumSortOrder
      }
      if (row.matchingMembership) {
        actions.push(action(core, 'CLEAR_MATCHING_SERIES_POINTER', 'join-table membership already preserves the relation'))
      } else {
        blockers.push(
          issue(core, 'DIRECT_ONLY_SERIES_MEMBERSHIP', 'Legacy direct pointer has no matching join-table membership', [
            'KEEP_CURRENT',
            'RESTORE_LEGACY'
          ])
        )
      }
    }
  }
  return { actions, blockers }
}

async function auditMigrationClosure(db, dataRoot) {
  const table = await db.$queryRawUnsafe(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = 'migration_job_items'
    ) AS present
  `)
  if (!table[0]?.present) return { blockers: [], observations: [] }
  const rows = await db.$queryRawUnsafe(`
    SELECT
      item.id AS "itemId", item."systemJobId", item.status AS "itemStatus", item.phase,
      file.id AS "fileId", file.status AS "fileStatus", file."sourceRelativePath",
      file."targetRelativePath", file."stagedRelativePath"
    FROM migration_job_items item
    LEFT JOIN migration_file_entries file ON file."itemId" = item.id
    ORDER BY item.id, file.ordinal
  `)
  const blockers = []
  const observations = []
  for (const row of rows) {
    const closedItem = ['COMPLETED', 'SKIPPED'].includes(row.itemStatus)
    const closedFile = row.fileId === null || row.fileStatus === 'COMPLETED'
    const harmlessPlanningFailure =
      ['FAILED', 'CANCELLED'].includes(row.itemStatus) && row.phase === 'DISCOVERING' && row.fileId === null
    const core = {
      kind: 'migration-closure',
      itemId: row.itemId,
      systemJobId: row.systemJobId,
      itemStatus: row.itemStatus,
      phase: row.phase,
      fileId: row.fileId,
      fileStatus: row.fileStatus
    }
    if (harmlessPlanningFailure) {
      observations.push({ ...core, closure: 'NO_FILE_SIDE_EFFECTS' })
      continue
    }
    if (!closedItem || !closedFile) {
      blockers.push(issue(core, 'MIGRATION_NOT_CLOSED', 'A migration item or file has not completed recovery and cleanup', []))
      continue
    }
    if (row.fileId !== null && !dataRoot) {
      blockers.push(
        issue(core, 'MIGRATION_FILESYSTEM_UNVERIFIED', 'A data root is required to verify completed migration files', [])
      )
      continue
    }
    if (row.stagedRelativePath) {
      const staged = await inspectExistingPath(dataRoot, row.stagedRelativePath)
      if (staged.exists) {
        blockers.push(issue({ ...core, path: row.stagedRelativePath }, 'MIGRATION_STAGING_REMAINS', 'Staging content remains on disk', []))
        continue
      }
    }
    if (row.fileId !== null) {
      const normalizedSource = normalizeStoredRelativePath(row.sourceRelativePath)
      const normalizedTarget = normalizeStoredRelativePath(row.targetRelativePath)
      const sourceIsTarget = normalizedSource !== null && normalizedSource === normalizedTarget
      const target = await inspectExistingPath(dataRoot, row.targetRelativePath)
      if (!target.exists || target.unsafe) {
        blockers.push(
          issue(
            { ...core, path: row.targetRelativePath },
            'MIGRATION_TARGET_UNVERIFIED',
            'Completed migration target is missing or unsafe',
            []
          )
        )
        continue
      }
      if (!sourceIsTarget) {
        const source = await inspectExistingPath(dataRoot, row.sourceRelativePath)
        if (source.exists) {
          blockers.push(
            issue(
              { ...core, path: row.sourceRelativePath },
              'MIGRATION_SOURCE_REMAINS',
              'Completed migration source still exists and cleanup is not proven',
              []
            )
          )
          continue
        }
      }
    }
    observations.push(core)
  }
  return { blockers, observations }
}

async function lockLegacyTables(transaction) {
  const state = await inspectSchemaState(transaction)
  const tables = [
    '"Artwork"',
    '"Image"',
    '"Series"',
    '"SeriesArtwork"',
    'artist_external_refs',
    'artwork_external_refs',
    'series_external_refs',
    'migration_job_items',
    'migration_file_entries'
  ]
  if (state.columns.artistUserId) tables.unshift('"Artist"')
  await transaction.$executeRawUnsafe(`LOCK TABLE ${tables.join(', ')} IN SHARE ROW EXCLUSIVE MODE`)
}

async function assertAuditStillCurrent(transaction, before, input) {
  const current = await audit(transaction, { ...input, scope: 'all' })
  if (current.fingerprint !== before.fingerprint) {
    throw new Error('Audit fingerprint changed before prepare; run audit again and regenerate the decision file')
  }
}

async function applyAutomaticAction(transaction, item) {
  if (item.action === 'SET_ARTWORK_STORAGE_PATH') {
    await expectOne(
      transaction.$executeRawUnsafe(
        `UPDATE "Artwork" SET "storagePath" = $1 WHERE id = $2 AND "storagePath" IS NULL`,
        item.storagePath,
        item.artworkId
      ),
      item
    )
    return
  }
  if (item.action === 'CLEAR_ARTIST_LEGACY_ID') {
    await expectOne(
      transaction.$executeRawUnsafe(
        `UPDATE "Artist" SET "userId" = NULL WHERE id = $1 AND "userId" = $2`,
        item.artistId,
        item.legacyUserId
      ),
      item
    )
    return
  }
  if (item.action === 'CREATE_ARTIST_PIXIV_REF_AND_CLEAR') {
    const id = `artist_ref_${createHash('md5').update(`pixiv:${item.legacyUserId}`).digest('hex')}`
    await transaction.$executeRawUnsafe(
      `INSERT INTO artist_external_refs
       (id, "artistId", "providerKey", "externalId", "canonicalUrl", "createdAt", "updatedAt")
       VALUES ($1, $2, 'pixiv', $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      id,
      item.artistId,
      item.legacyUserId,
      `https://www.pixiv.net/users/${item.legacyUserId}`
    )
    await expectOne(
      transaction.$executeRawUnsafe(
        `UPDATE "Artist" SET "userId" = NULL WHERE id = $1 AND "userId" = $2`,
        item.artistId,
        item.legacyUserId
      ),
      item
    )
    return
  }
  if (item.action === 'CREATE_SERIES_PIXIV_REF') {
    const id = `series_ref_${createHash('md5').update(`pixiv:${item.legacyExternalId}`).digest('hex')}`
    await transaction.$executeRawUnsafe(
      `INSERT INTO series_external_refs
       (id, "seriesId", "providerKey", "externalId", "createdAt", "updatedAt")
       VALUES ($1, $2, 'pixiv', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      id,
      item.seriesId,
      item.legacyExternalId
    )
    return
  }
  if (item.action === 'CLEAR_MATCHING_SERIES_POINTER') {
    await expectOne(
      transaction.$executeRawUnsafe(
        `UPDATE "Artwork" SET "seriesId" = NULL WHERE id = $1 AND "seriesId" = $2`,
        item.artworkId,
        item.legacySeriesId
      ),
      item
    )
  }
}

async function applyDecision(transaction, blocker, decision) {
  if (!decision || decision.fingerprint !== blocker.fingerprint) {
    throw new Error(`Missing or stale decision for ${decisionKey(blocker)}`)
  }
  if (!blocker.allowedActions.includes(decision.action)) {
    throw new Error(`Decision ${decision.action} is not allowed for ${decisionKey(blocker)}`)
  }
  if (blocker.kind === 'series-membership') {
    if (decision.action === 'RESTORE_LEGACY') {
      await transaction.$executeRawUnsafe(
        `INSERT INTO "SeriesArtwork"
         ("seriesId", "artworkId", "sortOrder", "sourceOrder", "orderOverridden", "excludedAt", provenance, "sourceRefId")
         SELECT $1, $2, coalesce(max("sortOrder"), -1) + 1, NULL, false, NULL, 'LEGACY', NULL
         FROM "SeriesArtwork" WHERE "seriesId" = $1
         ON CONFLICT ("seriesId", "artworkId") DO NOTHING`,
        blocker.legacySeriesId,
        blocker.artworkId
      )
    }
    await expectOne(
      transaction.$executeRawUnsafe(
        `UPDATE "Artwork" SET "seriesId" = NULL WHERE id = $1 AND "seriesId" = $2`,
        blocker.artworkId,
        blocker.legacySeriesId
      ),
      blocker
    )
    return
  }
  if (blocker.kind === 'artist-legacy-id' && decision.action === 'CLEAR_LOCAL') {
    await expectOne(
      transaction.$executeRawUnsafe(
        `UPDATE "Artist" SET "userId" = NULL WHERE id = $1 AND "userId" = $2`,
        blocker.artistId,
        blocker.legacyUserId
      ),
      blocker
    )
    return
  }
  if (blocker.kind === 'series-legacy-identity') {
    if (decision.action === 'CREATE_PIXIV_REF') {
      if (!/^[1-9][0-9]*$/u.test(blocker.legacyExternalId ?? '')) {
        throw new Error(`Cannot create a Pixiv identity from non-numeric value for Series ${blocker.seriesId}`)
      }
      const id = `series_ref_${createHash('md5').update(`pixiv:${blocker.legacyExternalId}`).digest('hex')}`
      await transaction.$executeRawUnsafe(
        `INSERT INTO series_external_refs
         (id, "seriesId", "providerKey", "externalId", "createdAt", "updatedAt")
         VALUES ($1, $2, 'pixiv', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        id,
        blocker.seriesId,
        blocker.legacyExternalId
      )
    } else {
      await expectOne(
        transaction.$executeRawUnsafe(
          `UPDATE "Series" SET source = 'LOCAL', "externalId" = NULL
           WHERE id = $1 AND source = $2 AND "externalId" IS NOT DISTINCT FROM $3`,
          blocker.seriesId,
          blocker.legacySource,
          blocker.legacyExternalId
        ),
        blocker
      )
    }
  }
}

async function expectOne(promise, item) {
  const changed = await promise
  if (changed !== 1) throw new Error(`Concurrent change detected for ${decisionKey(item)}`)
}

function action(core, actionName, reason) {
  return { ...core, action: actionName, reason, fingerprint: hash(core) }
}

function issue(core, code, message, allowedActions) {
  return { ...core, code, message, allowedActions, fingerprint: hash(core) }
}

function withFingerprint(report) {
  return { ...report, fingerprint: hash({ ...report, generatedAt: undefined }) }
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value, jsonReplacer)).digest('hex')
}

function jsonReplacer(_key, value) {
  return typeof value === 'bigint' ? value.toString() : value
}

function decisionKey(item) {
  if (item.kind === 'artist-legacy-id') return `${item.kind}:${item.artistId}`
  if (item.kind === 'series-legacy-identity') return `${item.kind}:${item.seriesId}`
  if (item.kind === 'series-membership') return `${item.kind}:${item.artworkId}`
  if (item.kind === 'migration-closure') return `${item.kind}:${item.itemId}:${item.fileId ?? '-'}`
  return `${item.kind}:${item.fingerprint}`
}

function isSatisfiedByDecision(blocker, decisions) {
  const decision = decisions.get(decisionKey(blocker))
  return Boolean(
    decision && decision.fingerprint === blocker.fingerprint && blocker.allowedActions.includes(decision.action)
  )
}

async function readDecisions(filePath, auditFingerprint) {
  const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'))
  if (parsed.auditFingerprint !== auditFingerprint) {
    throw new Error('Decision file auditFingerprint does not match the current audit')
  }
  if (!Array.isArray(parsed.decisions)) throw new Error('Decision file decisions must be an array')
  return parsed
}

async function readAndValidateManifest(filePath) {
  const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'))
  const requiredStrings = [
    'checkpointId',
    'createdAt',
    'databaseDumpSha256',
    'originalMediaSnapshot',
    'derivedMediaSnapshot',
    'pixivDataSnapshot',
    'configSnapshot',
    'appImageDigest',
    'workerImageDigest',
    'writesStoppedAt'
  ]
  for (const field of requiredStrings) {
    if (typeof parsed[field] !== 'string' || !parsed[field].trim()) throw new Error(`Manifest is missing ${field}`)
  }
  if (!/^[a-f0-9]{64}$/iu.test(parsed.databaseDumpSha256)) {
    throw new Error('Manifest databaseDumpSha256 must be a SHA-256 digest')
  }
  for (const field of ['createdAt', 'writesStoppedAt']) {
    if (!Number.isFinite(Date.parse(parsed[field]))) throw new Error(`Manifest ${field} must be an ISO-8601 timestamp`)
  }
  const assertions = parsed.operatorAssertions
  for (const field of ['schedulerStopped', 'appStopped', 'workersStopped', 'externalWritersStopped']) {
    if (assertions?.[field] !== true) throw new Error(`Manifest operatorAssertions.${field} must be true`)
  }
  return parsed
}

function manifestSummary(manifest) {
  return {
    checkpointId: manifest.checkpointId,
    createdAt: manifest.createdAt,
    databaseDumpSha256: manifest.databaseDumpSha256,
    originalMediaSnapshot: manifest.originalMediaSnapshot,
    derivedMediaSnapshot: manifest.derivedMediaSnapshot,
    pixivDataSnapshot: manifest.pixivDataSnapshot,
    configSnapshot: manifest.configSnapshot,
    appImageDigest: manifest.appImageDigest,
    workerImageDigest: manifest.workerImageDigest,
    writesStoppedAt: manifest.writesStoppedAt,
    operatorAssertions: manifest.operatorAssertions,
    note: 'The CLI records operator assertions; it cannot independently prove that external writers are stopped.'
  }
}

async function writeReport(directory, phase, value) {
  await fs.mkdir(directory, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/gu, '-')
  const target = path.join(directory, `${timestamp}-${phase}-${randomUUID()}.json`)
  await writeJsonFile(target, value)
  return target
}

async function writeJsonFile(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, jsonReplacer, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
}

function writeJsonToStdout(value) {
  process.stdout.write(`${JSON.stringify(value, jsonReplacer, 2)}\n`)
}

function requireOption(input, name) {
  if (!input[name]) throw new Error(`--${name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)} is required`)
}

async function verifyPathWithinRoot(root, candidate) {
  const normalized = normalizeStoredRelativePath(candidate)
  if (!normalized) return { ok: false, reason: 'stored path is not a bounded relative path' }
  const resolved = path.resolve(root, normalized)
  const relative = path.relative(root, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return { ok: false, reason: 'path escapes data root' }
  try {
    const real = await fs.realpath(resolved)
    const realRelative = path.relative(await fs.realpath(root), real)
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) return { ok: false, reason: 'symlink escapes data root' }
    return { ok: true }
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, reason: 'path does not exist' }
    return { ok: false, reason: `path cannot be verified: ${error?.code ?? error}` }
  }
}

function normalizeStoredRelativePath(candidate) {
  if (typeof candidate !== 'string' || !candidate || candidate.includes('\0')) return null
  const slashPath = candidate.replace(/\\/gu, '/')
  if (slashPath.startsWith('//') || /^[A-Za-z]:/u.test(slashPath)) return null
  const withoutLegacySlash = slashPath.startsWith('/') ? slashPath.slice(1) : slashPath
  if (!withoutLegacySlash || path.posix.isAbsolute(withoutLegacySlash)) return null
  const segments = withoutLegacySlash.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null
  return segments.join('/')
}

async function inspectExistingPath(root, candidate) {
  const verified = await verifyPathWithinRoot(path.resolve(root), candidate)
  if (verified.ok) return { exists: true }
  if (verified.reason === 'path does not exist') return { exists: false }
  return { exists: true, unsafe: true, reason: verified.reason }
}
