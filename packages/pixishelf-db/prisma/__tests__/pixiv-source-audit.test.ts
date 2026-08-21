import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const prismaDirectory = path.resolve(process.cwd(), 'prisma')
const schema = readFileSync(path.join(prismaDirectory, 'schema.prisma'), 'utf8')
const migration = readFileSync(
  path.join(prismaDirectory, 'migrations/20260820200000_add_pixiv_source_audit/migration.sql'),
  'utf8'
)

describe('Pixiv source audit migration', () => {
  it('is expand-only and leaves PostgreSQL enums untouched', () => {
    expect(migration).not.toMatch(/^\s*(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\b/im)
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|TYPE)\b/i)
    expect(migration).not.toMatch(/ALTER\s+TYPE/i)
    expect(migration).toContain('CREATE TABLE "pixiv_source_audit_items"')
  })

  it('adds nullable operation and count fields for old-client compatibility', () => {
    expect(schema).toMatch(/operationKind\s+String\?\s+@db\.VarChar\(40\)/)
    for (const field of ['auditNewInputs', 'auditChangedInputs', 'auditInvalidInputs', 'auditIdentityConflictInputs']) {
      expect(schema).toMatch(new RegExp(`${field}\\s+Int\\?`))
      expect(migration).toContain(`ADD COLUMN "${field}" INTEGER`)
    }
    expect(migration).toContain('scan_runs_operation_kind_check')
    expect(migration).toContain('NOT VALID')
    expect(migration).toContain('VALIDATE CONSTRAINT "scan_runs_operation_kind_check"')
  })

  it('stores self-contained apply evidence without domain foreign keys', () => {
    for (const field of [
      'sourceAuditItemId',
      'auditDifferenceKind',
      'expectedExternalId',
      'expectedInventoryId',
      'expectedExternalRefId',
      'expectedArtworkId'
    ]) {
      expect(schema).toContain(field)
      expect(migration).toContain(`"${field}"`)
    }
    expect(migration).toContain('scan_metadata_inputs_audit_difference_kind_check')
    expect(migration).toContain("'IDENTITY_CONFLICT', 'UNCHANGED'")
    expect(migration).not.toMatch(
      /FOREIGN KEY \("(?:sourceAuditItemId|expectedInventoryId|expectedExternalRefId|expectedArtworkId)"\)/
    )
  })

  it('keeps audit evidence immutable from mutable domain row lifecycles', () => {
    expect(schema).toContain('model PixivSourceAuditItem {')
    expect(migration).toContain('FOREIGN KEY ("scanRunId") REFERENCES "scan_runs"("id") ON DELETE CASCADE')
    expect(migration).not.toMatch(/FOREIGN KEY \("(?:inventoryId|externalRefId|artworkId)"\)/)
    expect(migration).toContain("'NEW', 'CHANGED', 'MISSING', 'INVALID', 'IDENTITY_CONFLICT'")
    expect(schema).toContain('expectedExternalId')
    expect(schema).toContain('observedExternalId')
    expect(schema).toContain('title')
    expect(schema).toContain('artistName')
    expect(migration).toContain('pixiv_source_audit_items_run_kind_ordinal_idx')
  })

  it('adds root filesystem identity and a separate audit sighting index', () => {
    expect(schema).toMatch(/rootDeviceId\s+BigInt\?/)
    expect(schema).toMatch(/rootInode\s+BigInt\?/)
    expect(schema).toMatch(/lastSeenAuditRunId\s+String\?\s+@db\.VarChar\(30\)/)
    expect(migration).toContain('pixiv_metadata_inventory_last_audit_idx')
    expect(migration).toContain('pixiv_inventory_state_root_identity_check')
  })

  it('keeps every PostgreSQL identifier within the catalog limit', () => {
    const identifiers = [...migration.matchAll(/(?:INDEX|CONSTRAINT)\s+"([^"]+)"/g)].map((match) => match[1]!)
    expect(identifiers.length).toBeGreaterThan(0)
    for (const identifier of identifiers) {
      expect(Buffer.byteLength(identifier, 'utf8'), identifier).toBeLessThanOrEqual(63)
    }
  })
})
