import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const prismaDirectory = path.resolve(import.meta.dirname, '..')
const migration = readFileSync(
  path.join(prismaDirectory, 'migrations/20260902120000_add_archive_uploader_manual_scan/migration.sql'),
  'utf8'
)
const schema = readFileSync(path.join(prismaDirectory, 'schema.prisma'), 'utf8')

describe('archive uploader manual scan migration', () => {
  it('adds only reusable source and disposable scan-history structures', () => {
    expect(migration).toContain('CREATE TABLE "archive_uploader_sources"')
    expect(migration).toContain('CREATE TABLE "archive_uploader_scan_runs"')
    expect(migration).toContain('CREATE TABLE "archive_uploader_scan_items"')
    expect(migration).toContain('ON DELETE CASCADE ON UPDATE CASCADE')
    expect(migration).toContain('ON DELETE SET NULL ON UPDATE CASCADE')
    expect(migration).not.toMatch(/^\s*(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\b/im)
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN|TYPE)\b/i)
  })

  it('enforces one active scan per source and the resolver lane mapping', () => {
    expect(migration).toContain('archive_uploader_scan_runs_one_active_per_source_idx')
    expect(migration).toContain(`WHERE "status" IN ('PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSED')`)
    expect(migration).toContain(`"type" IN ('ARCHIVE_RESOLVE_ITEM', 'ARCHIVE_UPLOADER_SCAN')`)
    expect(migration).toContain(`"executionLane" = 'ARCHIVE_RESOLVE'`)
    expect(migration).toContain(`"type" NOT IN ('ARCHIVE_RESOLVE_ITEM', 'ARCHIVE_UPLOADER_SCAN')`)
  })

  it('keeps Prisma identity, cursor, classification, and retention fields aligned', () => {
    expect(schema).toContain('model ArchiveUploaderSource')
    expect(schema).toContain('incrementalCursor')
    expect(schema).toContain('historyCursor')
    expect(schema).toContain('model ArchiveUploaderScanRun')
    expect(schema).toContain('model ArchiveUploaderScanItem')
    expect(schema).toContain('enum ArchiveUploaderScanClassification')
    for (const classification of ['NEW', 'ACTIVE', 'ARCHIVED', 'POSSIBLE_UPDATE', 'REPLACEMENT']) {
      expect(schema).toContain(classification)
    }
  })
})
