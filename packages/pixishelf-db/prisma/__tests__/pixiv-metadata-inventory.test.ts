import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const prismaDirectory = path.resolve(process.cwd(), 'prisma')
const schema = readFileSync(path.join(prismaDirectory, 'schema.prisma'), 'utf8')
const migration = readFileSync(
  path.join(prismaDirectory, 'migrations/20260820120000_add_pixiv_metadata_inventory/migration.sql'),
  'utf8'
)

describe('pixiv metadata inventory migration', () => {
  it('is expand-only and does not rewrite existing scan or domain rows', () => {
    expect(migration).not.toMatch(/^\s*(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\b/im)
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|TYPE)\b/i)
    expect(migration).toContain('CREATE TABLE "pixiv_metadata_inventory"')
    expect(migration).toContain('"baselineEligible" BOOLEAN NOT NULL DEFAULT false')
    expect(migration).toContain('CREATE TABLE "pixiv_metadata_inventory_state"')
  })

  it('keeps historical metrics and frozen stat fields nullable', () => {
    for (const field of [
      'walkedEntries',
      'metadataCandidates',
      'inventoryUnchanged',
      'contentHashed',
      'contentChanged',
      'parsedInputs',
      'publishedInputs',
      'failedInputs',
      'missingInputs',
      'discoveryDurationMs',
      'hashDurationMs',
      'publishDurationMs'
    ]) {
      expect(schema).toMatch(new RegExp(`${field}\\s+Int\\?`))
      expect(migration).toContain(`ADD COLUMN "${field}" INTEGER`)
    }
    expect(schema).toMatch(/inventoryBaselineGeneration\s+Int\?/)
    expect(migration).toContain('ADD COLUMN "inventoryBaselineGeneration" INTEGER')
    for (const field of ['sizeBytes', 'mtimeMs', 'ctimeMs', 'deviceId', 'inode']) {
      expect(schema).toMatch(new RegExp(`${field}\\s+BigInt\\?`))
      expect(migration).toContain(`ADD COLUMN "${field}" BIGINT`)
    }
  })

  it('separates observed, attempted, and successfully processed content', () => {
    expect(schema).toContain('model PixivMetadataInventory {')
    for (const field of [
      'observedContentHash',
      'processedContentHash',
      'lastAttemptedContentHash',
      'lastErrorRetryable'
    ]) {
      expect(schema).toContain(field)
      expect(migration).toContain(`"${field}"`)
    }
    expect(migration).toContain('ON DELETE SET NULL')
    expect(migration).not.toMatch(/FOREIGN KEY \("lastSeenScanRunId"\)/)
  })

  it('models an explicit trusted-baseline state tied to one scan-root identity', () => {
    expect(schema).toContain('enum PixivMetadataInventoryStatus {')
    expect(schema).toContain('INITIALIZING')
    expect(schema).toContain('READY')
    expect(schema).toMatch(/rootPathHash\s+String\s+@db\.VarChar\(64\)/)
    expect(migration).toContain('pixiv_inventory_state_root_hash_check')
    expect(migration).toContain('pixiv_inventory_state_singleton_check')
    expect(migration).toContain('pixiv_inventory_state_ready_time_check')
  })

  it('uses a nullable classification without extending the action enum read by old clients', () => {
    expect(schema).toMatch(/inventoryDecision\s+String\?\s+@db\.VarChar\(40\)/)
    expect(migration).toContain('scan_run_items_inventory_decision_check')
    expect(migration).toContain("'BASELINE_EXISTING', 'PENDING_SOURCE_REFRESH'")
    expect(migration).not.toContain('ALTER TYPE "ScanRunItemAction"')
  })

  it('validates new checks on existing tables without holding an access-exclusive scan', () => {
    for (const constraint of [
      'scan_runs_inventory_metrics_nonnegative_check',
      'scan_metadata_inputs_stat_check',
      'scan_run_items_inventory_decision_check'
    ]) {
      expect(migration).toMatch(new RegExp(`ADD CONSTRAINT "${constraint}"[\\s\\S]*?NOT VALID;`))
      expect(migration).toContain(`VALIDATE CONSTRAINT "${constraint}"`)
    }
  })

  it('keeps PostgreSQL identifiers within the catalog limit', () => {
    const identifiers = [...migration.matchAll(/(?:INDEX|CONSTRAINT)\s+"([^"]+)"/g)].map((match) => match[1]!)
    expect(identifiers.length).toBeGreaterThan(0)
    for (const identifier of identifiers) {
      expect(Buffer.byteLength(identifier, 'utf8'), identifier).toBeLessThanOrEqual(63)
    }
  })
})
