import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const prismaDirectory = path.resolve(import.meta.dirname, '..')
const migration = readFileSync(
  path.join(prismaDirectory, 'migrations/20260903120000_add_archive_uploader_catalog/migration.sql'),
  'utf8'
)
const outcomeOrderingMigration = readFileSync(
  path.join(prismaDirectory, 'migrations/20260903124500_order_archive_uploader_catalog_outcomes/migration.sql'),
  'utf8'
)
const activeNormalizationMigration = readFileSync(
  path.join(
    prismaDirectory,
    'migrations/20260903133000_normalize_archive_uploader_catalog_active/migration.sql'
  ),
  'utf8'
)
const schema = readFileSync(path.join(prismaDirectory, 'schema.prisma'), 'utf8')

describe('archive uploader durable catalog migration', () => {
  it('adds the durable catalog identity and scan coverage stop reasons', () => {
    expect(migration).toContain('CREATE TABLE "archive_uploader_catalog_items"')
    expect(migration).toContain('archive_uploader_catalog_items_source_provider_external_key')
    expect(migration).toContain('ON "archive_uploader_catalog_items"("sourceId", "providerKey", "externalId")')
    expect(migration).toContain('CREATE TYPE "ArchiveUploaderScanStopReason"')
    for (const stopReason of ['LIMIT_REACHED', 'WATERMARK_REACHED', 'REMOTE_END']) {
      expect(migration).toContain(`'${stopReason}'`)
      expect(schema).toContain(stopReason)
    }
  })

  it('backfills only the latest completed scan item per source identity', () => {
    expect(migration).toContain('WHERE scan_run."status" = \'COMPLETED\'')
    expect(migration).toContain('PARTITION BY scan_run."sourceId", scan_item."providerKey", scan_item."externalId"')
    expect(migration).toContain('ROW_NUMBER() OVER')
    expect(migration).toContain('WHERE item_rank = 1')
    expect(migration).toContain('INSERT INTO "archive_uploader_catalog_items"')
  })

  it('marks known local identities archived without claiming a comparison snapshot', () => {
    expect(migration).toContain('LEFT JOIN "artwork_external_refs" AS artwork_ref')
    expect(migration).toContain(
      'WHEN catalog_seed."artworkExternalRefId" IS NOT NULL THEN \'ARCHIVED\'::"ArchiveUploaderScanClassification"'
    )
    expect(migration).toMatch(/'\[\]'::JSONB,\s+NULL,\s+NULL,\s+false,/)
    expect(schema).toContain('comparisonSnapshot    Json?')
    expect(schema).toContain('comparisonKnown       Boolean                        @default(false)')
    expect(schema).toContain('changeReasons         Json                           @default("[]")')
  })

  it('snapshots existing intake, import, outcome, and error state', () => {
    expect(migration).toContain('FROM "archive_intake_items" AS candidate')
    expect(migration).toContain('FROM "archive_imports" AS candidate')
    for (const outcome of ['SUBMITTED', 'FAILED', 'CANCELLED', 'DUPLICATE', 'ARCHIVED']) {
      expect(migration).toContain(`'${outcome}'::"ArchiveUploaderCatalogOutcome"`)
      expect(schema).toContain(outcome)
    }
    expect(migration).toContain('catalog_seed."archiveImportErrorCode"')
    expect(migration).toContain('catalog_seed."intakeErrorMessage"')
    expect(outcomeOrderingMigration).toContain('ORDER BY candidate."eventAt" DESC')
    expect(outcomeOrderingMigration).toContain('FROM "archive_intake_items" AS intake_item')
    expect(outcomeOrderingMigration).toContain('FROM "artwork_external_refs" AS external_ref')
  })

  it('retains catalog rows when scan history and workflow snapshots are cleaned up', () => {
    expect(migration).toContain(
      'FOREIGN KEY ("sourceId") REFERENCES "archive_uploader_sources"("id") ON DELETE CASCADE'
    )
    expect(migration).toContain(
      'FOREIGN KEY ("lastScanRunId") REFERENCES "archive_uploader_scan_runs"("id") ON DELETE SET NULL'
    )
    expect(migration).toContain(
      'FOREIGN KEY ("lastIntakeItemId") REFERENCES "archive_intake_items"("id") ON DELETE SET NULL'
    )
    expect(migration).toContain(
      'FOREIGN KEY ("lastArchiveImportId") REFERENCES "archive_imports"("id") ON DELETE SET NULL'
    )
    expect(migration).not.toMatch(/FOREIGN KEY \("lastScanRunId"\)[\s\S]{0,160}ON DELETE CASCADE/)
  })

  it('keeps ACTIVE in scan audit only and normalizes durable catalog recommendations', () => {
    expect(activeNormalizationMigration).toContain('WHERE catalog."classification" = \'ACTIVE\'')
    expect(activeNormalizationMigration).toContain("THEN 'ARCHIVED'::\"ArchiveUploaderScanClassification\"")
    expect(activeNormalizationMigration).toContain("THEN 'REPLACEMENT'::\"ArchiveUploaderScanClassification\"")
    expect(activeNormalizationMigration).toContain("ELSE 'NEW'::\"ArchiveUploaderScanClassification\"")
    expect(activeNormalizationMigration).toContain('"comparisonKnown" = NOT recommendation."hasExactReference"')
  })

  it('keeps the Prisma relations aligned with migration delete behavior', () => {
    const catalogModel = schema.match(/model ArchiveUploaderCatalogItem \{([\s\S]*?)\n\}/)?.[1]
    expect(catalogModel).toBeTruthy()
    expect(catalogModel).toContain('source                ArchiveUploaderSource')
    expect(catalogModel).toContain('lastScanRun           ArchiveUploaderScanRun?')
    expect(catalogModel).toContain('lastIntakeItem        ArchiveIntakeItem?')
    expect(catalogModel).toContain('lastArchiveImport     ArchiveImport?')
    expect(catalogModel).toContain('onDelete: Cascade')
    expect(catalogModel?.match(/onDelete: SetNull/g)).toHaveLength(3)
    expect(schema).toContain('stopReason          ArchiveUploaderScanStopReason?')
  })
})
