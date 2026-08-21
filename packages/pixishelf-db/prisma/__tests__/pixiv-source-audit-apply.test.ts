import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const prismaDirectory = path.resolve(process.cwd(), 'prisma')
const schema = readFileSync(path.join(prismaDirectory, 'schema.prisma'), 'utf8')
const migration = readFileSync(
  path.join(prismaDirectory, 'migrations/20260820210000_add_pixiv_source_audit_apply/migration.sql'),
  'utf8'
)

describe('Pixiv source audit apply migration', () => {
  it('is expand-only and leaves existing enums and rows untouched', () => {
    expect(migration).not.toMatch(/^\s*(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\b/im)
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|TYPE)\b/i)
    expect(migration).not.toMatch(/ALTER\s+TYPE/i)
    expect(migration).toContain('ADD COLUMN "sourceAuditRunId" VARCHAR(30)')
  })

  it('adds nullable apply provenance and nonnegative aggregates without a source-run FK', () => {
    expect(schema).toMatch(/sourceAuditRunId\s+String\?\s+@db\.VarChar\(30\)/)
    expect(schema).toMatch(/auditApplyStaleInputs\s+Int\?/)
    expect(schema).toMatch(/auditApplyConflictInputs\s+Int\?/)
    expect(migration).toContain('scan_runs_audit_apply_counts_check')
    expect(migration).toContain('scan_runs_audit_apply_source_check')
    expect(migration).not.toMatch(/FOREIGN KEY \("sourceAuditRunId"\)/)
  })

  it('stores complete frozen apply evidence on metadata inputs', () => {
    for (const field of ['observedExternalId', 'expectedProcessedContentHash']) {
      expect(schema).toContain(field)
      expect(migration).toContain(`"${field}"`)
    }
    expect(migration).toContain('scan_metadata_inputs_expected_processed_hash_check')
    expect(migration).toContain("'^[a-f0-9]{64}$'")
  })

  it('adds nullable item outcomes with strict varchar checks and no domain foreign keys', () => {
    for (const field of [
      'sourceAuditItemId',
      'auditDifferenceKind',
      'applyOutcome',
      'resultArtworkId',
      'applyReasonCode',
      'applyReasonSummary',
      'applyRetryable'
    ]) {
      expect(schema).toContain(field)
      expect(migration).toContain(`"${field}"`)
    }
    expect(migration).toContain("'APPLIED', 'SKIPPED', 'CONFLICT', 'FAILED'")
    expect(migration).toContain("'NEW', 'CHANGED'")
    expect(migration).toContain('"resultArtworkId" > 0')
    expect(migration).toContain('"applyOutcome" IS NOT NULL AND "applyRetryable" IS NOT NULL')
    expect(migration).not.toMatch(/FOREIGN KEY \("(?:sourceAuditItemId|resultArtworkId)"\)/)
  })

  it('enforces one audit item per apply run and indexes cross-operation history', () => {
    expect(migration).toContain('scan_run_items_run_source_audit_item_key')
    expect(migration).toContain('scan_run_items_source_audit_created_idx')
    expect(migration).toContain('scan_runs_source_audit_created_idx')
  })

  it('uses online-compatible validation for checks on existing tables', () => {
    expect(migration.match(/NOT VALID/g)?.length).toBe(6)
    expect(migration.match(/VALIDATE CONSTRAINT/g)?.length).toBe(6)
  })

  it('keeps every PostgreSQL identifier within the catalog limit', () => {
    const identifiers = [...migration.matchAll(/(?:INDEX|CONSTRAINT)\s+"([^"]+)"/g)].map((match) => match[1]!)
    for (const identifier of identifiers) {
      expect(Buffer.byteLength(identifier, 'utf8'), identifier).toBeLessThanOrEqual(63)
    }
  })
})
