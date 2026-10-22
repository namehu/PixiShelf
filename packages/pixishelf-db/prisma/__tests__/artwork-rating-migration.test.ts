import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(path.resolve(process.cwd(), 'prisma/migrations/20261022140000_artwork_rating_levels/migration.sql'), 'utf8')

describe('artwork rating migration safety', () => {
  it('adds the level without replacing legacy likes or rewriting their timestamps', () => {
    expect(migration).toContain('ADD COLUMN "level" SMALLINT NOT NULL DEFAULT 2')
    expect(migration).toContain('CHECK ("level" BETWEEN 1 AND 4)')
    expect(migration).not.toMatch(/(?:DELETE FROM|INSERT INTO|UPDATE)\s+"ArtworkLike"/i)
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
    expect(migration).not.toContain('"updatedAt"')
    expect(migration).not.toContain('"createdAt"')
  })

  it('installs the column and all mutation-event counting behavior atomically', () => {
    expect(migration.trim()).toMatch(/^BEGIN;/)
    expect(migration.trim()).toMatch(/COMMIT;$/)
    expect(migration).toContain('AFTER INSERT OR UPDATE OR DELETE ON "ArtworkLike"')
  })
})
