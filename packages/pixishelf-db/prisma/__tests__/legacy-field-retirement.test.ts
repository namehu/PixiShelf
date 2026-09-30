import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const packageDirectory = process.cwd()
const repositoryRoot = path.resolve(packageDirectory, '../..')
const read = (file: string) => readFileSync(path.join(repositoryRoot, file), 'utf8')
const artistMigration = read(
  'packages/pixishelf-db/prisma/migrations/20260930120000_retire_artist_legacy_identity/migration.sql'
)
const seriesMigration = read(
  'packages/pixishelf-db/prisma/migrations/20260930121000_retire_series_legacy_fields/migration.sql'
)
const maintenance = read('packages/pixishelf-db/maintenance/retire-legacy-fields.mjs')

describe('legacy identity retirement boundary', () => {
  it('keeps each destructive migration transactional and data-gated', () => {
    for (const migration of [artistMigration, seriesMigration]) {
      expect(migration.trimStart()).toMatch(/^BEGIN;/u)
      expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
      expect(migration).toContain('migration_closure_blocker_count')
      expect(migration).toContain("item.status IN ('FAILED', 'CANCELLED')")
      expect(migration).toContain("item.phase = 'DISCOVERING'")
      expect(migration).toContain('RAISE EXCEPTION')
    }
    expect(artistMigration).toContain('series_identity_blocker_count')
    expect(seriesMigration).toContain('DROP COLUMN "seriesId"')
  })

  it('requires explicit fingerprints and has no force bypass', () => {
    expect(maintenance).toContain('Decision file auditFingerprint does not match the current audit')
    expect(maintenance).toContain("const allowed = new Set(['scope', 'decisions', 'manifest', 'report-dir', 'report', 'data-root'])")
    expect(maintenance).not.toContain("allowed.add('force')")
    expect(maintenance).toContain('operatorAssertions: manifest.operatorAssertions')
    expect(maintenance).toContain('cannot independently prove that external writers are stopped')
  })

  it('starts Prisma through Node and preserves failed migration state for review', () => {
    expect(maintenance).toContain("spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'")
    expect(maintenance).not.toContain('migrate resolve')
    expect(maintenance).toContain('services must remain stopped')
  })

  it('ships non-affirming checkpoint and decision templates', () => {
    const checkpoint = JSON.parse(read('packages/pixishelf-db/maintenance/checkpoint.example.json'))
    const decisions = JSON.parse(read('packages/pixishelf-db/maintenance/decisions.example.json'))
    expect(checkpoint.operatorAssertions).toEqual({
      schedulerStopped: false,
      appStopped: false,
      workersStopped: false,
      externalWritersStopped: false
    })
    expect(decisions.decisions[0]).toMatchObject({ action: 'KEEP_CURRENT' })
  })
})
