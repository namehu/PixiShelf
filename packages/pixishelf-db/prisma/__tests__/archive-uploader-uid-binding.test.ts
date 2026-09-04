import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const prismaDirectory = path.resolve(import.meta.dirname, '..')
const migration = readFileSync(
  path.join(prismaDirectory, 'migrations/20260904120000_add_archive_uploader_uid_binding/migration.sql'),
  'utf8'
)
const schema = readFileSync(path.join(prismaDirectory, 'schema.prisma'), 'utf8')

describe('archive uploader UID binding migration', () => {
  it('refuses to rewrite scan identity while an uploader scan is active', () => {
    expect(migration).toContain(`WHERE "status" IN ('PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSED')`)
    expect(migration).toContain('requires all uploader scans to be terminal')
    expect(migration.indexOf('requires all uploader scans to be terminal')).toBeLessThan(
      migration.indexOf('ALTER TABLE "archive_uploader_sources"')
    )
  })

  it('backfills only existing UID identities and keeps NAME sources unbound', () => {
    expect(migration).toContain('SET "uploaderUid" = "normalizedIdentity"')
    expect(migration).toContain(`WHERE "identityKind" = 'UID'`)
    expect(migration).not.toMatch(/WHERE\s+"identityKind"\s*=\s*'NAME'/)
    expect(migration).toContain('archive_uploader_sources_provider_uid_key')
  })

  it('freezes the effective identity for every historical scan run', () => {
    expect(migration).toContain('"searchIdentityKind" = source."identityKind"')
    expect(migration).toContain('"searchIdentityValue" = source."identityValue"')
    expect(migration).toContain('ALTER COLUMN "searchIdentityKind" SET NOT NULL')
    expect(migration).toContain('ALTER COLUMN "searchIdentityValue" SET NOT NULL')
  })

  it('keeps Prisma source binding and run snapshot fields aligned', () => {
    expect(schema).toContain('uploaderUid               String?')
    expect(schema).toContain('uidRevalidationRequiredAt DateTime?')
    expect(schema).toContain('searchIdentityKind  ArchiveUploaderIdentityKind')
    expect(schema).toContain('searchIdentityValue String')
  })
})
