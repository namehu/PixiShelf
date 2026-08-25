import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const prismaDirectory = path.resolve(process.cwd(), 'prisma')
const schema = readFileSync(path.join(prismaDirectory, 'schema.prisma'), 'utf8')
const migration = readFileSync(
  path.join(prismaDirectory, 'migrations/20260825103000_add_artist_external_refs/migration.sql'),
  'utf8'
)
const audit = readFileSync(path.join(prismaDirectory, 'diagnostics/artist-source-identity-audit.sql'), 'utf8')
const verification = readFileSync(
  path.join(prismaDirectory, 'diagnostics/artist-external-ref-verification.sql'),
  'utf8'
)

describe('artist external identity migration', () => {
  it('models multiple providers while allowing only one identity per artist and provider', () => {
    expect(schema).toContain('model ArtistExternalRef {')
    expect(schema).toContain('@@unique([providerKey, externalId])')
    expect(schema).toContain('@@unique([artistId, providerKey])')
    expect(migration).toContain('ON DELETE CASCADE')
  })

  it('backfills only unique numeric ids with explicit Pixiv artwork evidence', () => {
    expect(migration).toContain('artist."userId" ~ \'^[1-9][0-9]*$\'')
    expect(migration).toContain('JOIN "artwork_external_refs" artwork_ref')
    expect(migration).toContain('HAVING count(*) = 1')
    expect(migration).toContain('artwork_ref."providerKey" = \'pixiv\'')
    expect(migration).not.toContain("LIKE 'p\\_%'")
  })

  it('keeps the legacy Artist.userId column for the compatibility release', () => {
    expect(schema).toMatch(/userId\s+String\?/)
    expect(migration).not.toMatch(/DROP\s+COLUMN\s+"userId"/i)
    expect(migration).not.toMatch(/UPDATE\s+"Artist"/i)
  })

  it('ships a read-only audit for duplicates and ambiguous ids', () => {
    expect(audit).toContain('duplicate_numeric_user_id')
    expect(audit).toContain('automatic_claim_count')
    expect(audit).toContain("LIKE 'p\\_%'")
    expect(audit).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b/im)
    expect(verification).toContain('missing_expected_claims')
    expect(verification).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b/im)
  })
})
