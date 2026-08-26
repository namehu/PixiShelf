import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migrationUrl = new URL(
  '../../prisma/migrations/20260826143000_add_pixiv_artwork_online_sync/migration.sql',
  import.meta.url
)

describe('Pixiv artwork online synchronization migration', () => {
  it('stores only synchronization pointers and enforces an all-or-none snapshot pair', async () => {
    const sql = await readFile(migrationUrl, 'utf8')

    expect(sql).toContain('ADD COLUMN "onlineSnapshotHash" VARCHAR(64)')
    expect(sql).toContain('ADD COLUMN "onlineSnapshotPath" TEXT')
    expect(sql).toContain('("onlineSnapshotHash" IS NULL) = ("onlineSnapshotPath" IS NULL)')
    expect(sql).not.toContain('ADD COLUMN "onlineSnapshot" JSON')
  })

  it('clears historical text overrides only with one Pixiv ref and an exact latest snapshot value', async () => {
    const sql = await readFile(migrationUrl, 'utf8')

    expect(sql.match(/HAVING count\(\*\) = 1/g)).toHaveLength(2)
    expect(sql).toContain('snapshot."normalizedMetadata" ? \'title\'')
    expect(sql).toContain('artwork."title" IS NOT DISTINCT FROM snapshot."normalizedMetadata" ->> \'title\'')
    expect(sql).toContain('snapshot."normalizedMetadata" ? \'description\'')
    expect(sql).toContain(
      'artwork."description" IS NOT DISTINCT FROM snapshot."normalizedMetadata" ->> \'description\''
    )
    expect(sql).not.toMatch(/SET\s+"(?:title|description)"\s*=/)
  })
})
