import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const prismaDirectory = path.resolve(import.meta.dirname, '..')
const migration = readFileSync(
  path.join(prismaDirectory, 'migrations/20260902193000_add_archive_uploader_ignored_items/migration.sql'),
  'utf8'
)
const schema = readFileSync(path.join(prismaDirectory, 'schema.prisma'), 'utf8')

describe('archive uploader ignored items migration', () => {
  it('adds durable globally unique uploader decisions without storing canonical gallery URLs', () => {
    expect(migration).toContain('CREATE TABLE "archive_uploader_ignored_items"')
    expect(migration).toContain('archive_uploader_ignored_items_provider_external_key')
    expect(migration).toContain('ON DELETE SET NULL')
    expect(migration).not.toContain('canonicalUrl')
  })

  it('keeps the Prisma schema aligned with the additive migration', () => {
    const ignoredModel = schema.match(/model ArchiveUploaderIgnoredItem \{([\s\S]*?)\n\}/)?.[1]
    expect(schema).toContain('model ArchiveUploaderIgnoredItem')
    expect(schema).toContain(
      '@@unique([providerKey, externalId], map: "archive_uploader_ignored_items_provider_external_key")'
    )
    expect(schema).toContain('ignoredItems              ArchiveUploaderIgnoredItem[]')
    expect(ignoredModel).toBeTruthy()
    expect(ignoredModel).not.toContain('canonicalUrl')
  })
})
