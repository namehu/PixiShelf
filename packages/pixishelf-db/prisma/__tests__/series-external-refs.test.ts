import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const prismaDirectory = path.resolve(process.cwd(), 'prisma')
const schema = readFileSync(path.join(prismaDirectory, 'schema.prisma'), 'utf8')
const migration = readFileSync(
  path.join(prismaDirectory, 'migrations/20260827090000_add_series_external_refs/migration.sql'),
  'utf8'
)
const audit = readFileSync(path.join(prismaDirectory, 'diagnostics/series-source-identity-audit.sql'), 'utf8')
const verification = readFileSync(
  path.join(prismaDirectory, 'diagnostics/series-external-ref-verification.sql'),
  'utf8'
)

describe('series external identity migration', () => {
  it('adds provider-scoped Series identities and keeps legacy columns for compatibility', () => {
    expect(schema).toContain('model SeriesExternalRef {')
    expect(schema).toContain('@@unique([providerKey, externalId])')
    expect(schema).toContain('@@unique([seriesId, providerKey])')
    expect(schema).toMatch(/source\s+String\s+@default\("LOCAL"\)/)
    expect(schema).toMatch(/externalId\s+String\?/)
    expect(migration).not.toMatch(/DROP\s+COLUMN\s+"(?:source|externalId|seriesId)"/i)
  })

  it('makes the join table the provenance-aware source of membership truth', () => {
    expect(schema).toContain('enum SeriesArtworkProvenance {')
    expect(schema).toContain('sourceRefId     String?                 @unique')
    expect(schema).toContain('@relation("SeriesArtworkSourceRef"')
    expect(migration).toContain('"SeriesArtwork_source_provenance_check"')
    expect(migration).toContain('ON DELETE CASCADE')
  })

  it('classifies supported LOCAL writes as manual and claims only unambiguous legacy PIXIV identities', () => {
    expect(migration).toContain("upper(btrim(series.\"source\")) = 'LOCAL'")
    expect(migration).toContain('unique_legacy_external_ids AS MATERIALIZED')
    expect(migration).toContain('single_membership_artworks AS MATERIALIZED')
    expect(migration).toContain('HAVING count(*) = 1')
    expect(migration).toContain('min("externalId") ~ \'^[1-9][0-9]*$\'')
    expect(migration).not.toContain('ArtworkRawMetadata')
    expect(migration).toContain('"provenance" = \'SOURCE\'')
  })

  it('ships read-only preflight and verification SQL', () => {
    expect(audit).toContain('multi_series_artwork_count')
    expect(audit).toContain('direct_only_count')
    expect(audit).toContain('strong_series_count')
    expect(audit).toContain('strong_membership_count')
    expect(audit).not.toContain('ArtworkRawMetadata')
    expect(audit).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b/im)
    expect(verification).toContain('invalid_source_membership_count')
    expect(verification).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b/im)
  })
})
