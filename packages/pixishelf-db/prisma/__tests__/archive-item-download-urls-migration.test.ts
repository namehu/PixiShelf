import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  path.resolve(process.cwd(), 'prisma/migrations/20260916200000_archive_item_download_urls/migration.sql'),
  'utf8'
)
describe('archive item observed download URL migration', () => {
  it('adds nullable observation fields without inventing historical URLs or changing download state', () => {
    expect(migration).toContain('ADD COLUMN "lastDownloadUrl" TEXT')
    expect(migration).toContain('ADD COLUMN "lastDownloadAt" TIMESTAMP(3)')
    expect(migration).toContain('ADD COLUMN "lastDownloadAttempt" INTEGER')
    expect(migration).not.toMatch(/\b(?:UPDATE|DEFAULT|NOT NULL|DROP)\b/i)
  })
})
