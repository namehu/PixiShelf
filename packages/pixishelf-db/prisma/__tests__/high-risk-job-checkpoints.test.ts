import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const prismaDirectory = path.resolve(process.cwd(), 'prisma')
const schema = readFileSync(path.join(prismaDirectory, 'schema.prisma'), 'utf8')
const enumMigration = readFileSync(
  path.join(prismaDirectory, 'migrations/20260815010000_add_high_risk_job_enum_values/migration.sql'),
  'utf8'
)
const checkpointMigration = readFileSync(
  path.join(prismaDirectory, 'migrations/20260815011000_add_high_risk_job_checkpoints/migration.sql'),
  'utf8'
)

describe('high-risk job checkpoint migrations', () => {
  it('commits existing enum extensions before structural use', () => {
    expect(enumMigration.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/)
    for (const [enumName, values] of [
      ['ScanRunStatus', ['PENDING', 'PAUSED', 'RETRY_WAIT']],
      ['ScanRunItemStatus', ['PENDING', 'PROCESSING', 'RETRY_WAIT']],
      ['PendingReplaceBatchStatus', ['DISCOVERING', 'FAILED']],
      ['PendingReplaceItemStatus', ['ARCHIVING', 'RESTORE_COMMITTED', 'CLEANING_BACKUP']]
    ] as const) {
      for (const value of values) {
        expect(enumMigration).toContain(`ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS '${value}'`)
      }
    }
    expect(enumMigration).not.toMatch(/CREATE TABLE|ALTER TABLE|CREATE INDEX/)
  })

  it('runs duplicate-data guards before the first structural write', () => {
    const guardStart = checkpointMigration.indexOf('DO $$')
    const guardEnd = checkpointMigration.indexOf('$$;', guardStart)
    const firstWrite = checkpointMigration.search(/CREATE TYPE|ALTER TABLE|CREATE TABLE|CREATE INDEX|DROP INDEX/)
    expect(checkpointMigration.indexOf('BEGIN;')).toBeLessThan(guardStart)
    expect(firstWrite).toBeGreaterThan(guardEnd)
    expect(checkpointMigration.slice(guardStart, guardEnd)).toContain('COUNT(*) > 1')
    expect(checkpointMigration.slice(guardStart, guardEnd)).toContain('one scan run per system job')
    expect(checkpointMigration.slice(guardStart, guardEnd)).toContain('unique pending source directories per batch')
    expect(checkpointMigration.trim()).toMatch(/COMMIT;$/)
  })

  it('makes ScanRun ownership unique and adds bounded run checkpoints', () => {
    expect(schema).toMatch(/systemJobId\s+String\?\s+@unique/)
    expect(schema).toMatch(/startedAt\s+DateTime\?\s*\n/)
    expect(schema).toMatch(/inputDigest\s+String\?\s+@db\.VarChar\(64\)/)
    expect(schema).toMatch(/inputCount\s+Int\s+@default\(0\)/)
    expect(schema).toMatch(/checkpointStage\s+String\?\s+@db\.VarChar\(80\)/)
    expect(schema).toMatch(/checkpointOrdinal\s+Int\s+@default\(0\)/)
    expect(checkpointMigration).toContain('CREATE UNIQUE INDEX "scan_runs_systemJobId_key"')
    expect(checkpointMigration).toContain('scan_runs_checkpoint_ordinal_check')
  })

  it('adds nullable idempotency keys and attempts to scan-run items', () => {
    expect(schema).toMatch(/checkpointKey\s+String\?\s+@db\.VarChar\(180\)/)
    expect(schema).toContain('@@unique([scanRunId, checkpointKey], map: "scan_run_items_run_checkpoint_key")')
    expect(schema).toMatch(/attempt\s+Int\s+@default\(0\)/)
    expect(checkpointMigration).toContain('scan_run_items_attempt_check')
  })

  it('freezes client metadata input with stable ordinals and paths', () => {
    expect(schema).toContain('model ScanRunMetadataInput {')
    expect(schema).toContain('@@unique([scanRunId, ordinal], map: "scan_metadata_inputs_run_ordinal_key")')
    expect(schema).toContain('@@unique([scanRunId, relativePath], map: "scan_metadata_inputs_run_path_key")')
    expect(checkpointMigration).toContain('CREATE TABLE "scan_run_metadata_inputs"')
    expect(checkpointMigration).toContain('scan_run_metadata_inputs_scanRunId_fkey')
  })

  it('freezes local work and artist mapping snapshots without an Artist foreign key', () => {
    expect(schema).toContain('model ScanRunLocalWorkInput {')
    expect(schema).toContain('MEDIA_DIRECTORY')
    expect(schema).toContain('ARCHIVE_MANIFEST')
    expect(schema).toContain('model ScanRunLocalArtistMappingInput {')
    const mappingTable = checkpointMigration.slice(
      checkpointMigration.indexOf('CREATE TABLE "scan_run_local_artist_mapping_inputs"'),
      checkpointMigration.indexOf('CREATE TABLE "pending_replace_operations"')
    )
    expect(mappingTable).toContain('"artistId" INTEGER NOT NULL')
    expect(checkpointMigration).not.toContain('scan_run_local_artist_mapping_inputs_artistId_fkey')
  })

  it('records full-reconcile sightings without coupling external refs to scan retention', () => {
    expect(schema).toMatch(/lastSeenScanRunId\s+String\?\s+@db\.VarChar\(30\)/)
    expect(schema).toContain('@@index([lastSeenScanRunId])')
    expect(schema).toContain(
      '@@index([providerKey, createdAt, lastSeenScanRunId], map: "artwork_external_refs_reconcile_sweep_idx")'
    )
    expect(checkpointMigration).toContain('artwork_external_refs_lastSeenScanRunId_idx')
    expect(checkpointMigration).toContain(
      '"artwork_external_refs_reconcile_sweep_idx" ON "artwork_external_refs"("providerKey", "createdAt", "lastSeenScanRunId")'
    )
    expect(checkpointMigration).not.toContain('artwork_external_refs_lastSeenScanRunId_fkey')
  })

  it('models one fenced pending-replace operation per SystemJob', () => {
    expect(schema).toContain('model PendingReplaceOperation {')
    expect(schema).toMatch(/systemJobId\s+String\s+@id/)
    expect(schema).toContain('enum PendingReplaceOperationMode {')
    for (const mode of ['DISCOVER', 'BATCH', 'RESTORE', 'CLEANUP']) expect(schema).toContain(mode)
    expect(checkpointMigration).toContain('pending_replace_operations_item_mode_check')
  })

  it('protects pending batch source identity and restricts operation target deletion', () => {
    expect(schema).toContain(
      '@@unique([batchId, sourceDirectoryName], map: "pending_replace_items_batch_source_directory_key")'
    )
    expect(schema).toContain('@@unique([id, batchId], map: "pending_replace_items_id_batch_key")')
    expect(schema).toMatch(/batch\s+PendingReplaceBatch\s+@relation\([^\n]+onDelete: Restrict\)/)
    expect(schema).toMatch(/item\s+PendingReplaceItem\?\s+@relation\([^\n]+onDelete: Restrict\)/)
    expect(checkpointMigration).toContain('pending_replace_operations_batchId_idx')
    expect(checkpointMigration).toContain('pending_replace_operations_itemId_idx')
    expect(checkpointMigration).toContain('FOREIGN KEY ("itemId", "batchId")')
  })

  it('defines resumable migration item states, phases, and job ownership', () => {
    for (const enumName of ['MigrationItemStatus', 'MigrationItemPhase', 'MigrationFileStatus']) {
      expect(schema).toContain(`enum ${enumName} {`)
      expect(checkpointMigration).toContain(`CREATE TYPE "${enumName}" AS ENUM`)
    }
    expect(schema).toContain('model MigrationJobItem {')
    expect(schema).toContain('@@unique([systemJobId, artworkIdSnapshot])')
    expect(schema).toContain('@@index([systemJobId, status, artworkIdSnapshot])')
    expect(checkpointMigration).toContain('migration_job_items_systemJobId_fkey')
  })

  it('tracks per-file staging, fingerprints, publication, and source cleanup', () => {
    expect(schema).toContain('model MigrationFileEntry {')
    for (const field of [
      'sourceRelativePath',
      'targetRelativePath',
      'stagedRelativePath',
      'sourceSize',
      'sourceMtimeMs',
      'sourceSha256',
      'stagedSha256',
      'transferredAt',
      'publishedAt',
      'cleanedAt'
    ]) {
      expect(schema).toContain(field)
    }
    expect(checkpointMigration).toContain('migration_file_entries_itemId_sourceRelativePath_key')
    expect(checkpointMigration).toContain('migration_file_entries_item_target_path_key')
    expect(checkpointMigration).toContain('migration_file_entries_itemId_status_ordinal_idx')
  })

  it('adds only checkpoint structures and never rewrites Artwork or Image rows', () => {
    expect(checkpointMigration).not.toMatch(/(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+"(?:Artwork|Image)"/i)
    for (const constraint of [
      'scan_runs_input_count_check',
      'scan_run_items_attempt_check',
      'scan_metadata_inputs_hash_check',
      'migration_job_items_attempt_check',
      'migration_file_entries_source_size_check',
      'migration_file_entries_source_hash_check'
    ]) {
      expect(checkpointMigration).toContain(constraint)
    }
  })

  it('keeps every new PostgreSQL identifier within the 63-byte catalog limit', () => {
    const identifiers = [...checkpointMigration.matchAll(/(?:INDEX|CONSTRAINT)\s+"([^"]+)"/g)].map((match) => match[1]!)
    expect(identifiers.length).toBeGreaterThan(0)
    for (const identifier of identifiers) {
      expect(Buffer.byteLength(identifier, 'utf8'), identifier).toBeLessThanOrEqual(63)
    }
  })
})
