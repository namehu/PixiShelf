import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(new URL('../migrations/20261029000300_artwork_dedup_visual_search_v2/migration.sql', import.meta.url), 'utf8')
const previous = readFileSync(new URL('../migrations/20261029000200_artwork_dedup_quick_confirmation/migration.sql', import.meta.url), 'utf8')

describe('visual search v2 additive migration', () => {
  it('admits only scan v8 while retaining maintenance and old scan policy', () => {
    const marker = 'ALTER TABLE "system_jobs" DROP CONSTRAINT "system_jobs_dedup_policy";'
    expect(migration.slice(migration.indexOf(marker))).toBe(previous.slice(previous.indexOf(marker))
      .replace("type='ARTWORK_DEDUP_SCAN' AND \"definitionVersion\" IN(2,3,4,5,6,7)", "type='ARTWORK_DEDUP_SCAN' AND \"definitionVersion\" IN(2,3,4,5,6,7,8)"))
  })
  it('does not infer old coverage, rewrite features or scan media', () => {
    expect(migration).toContain('ADD COLUMN "visualSearchComplete" BOOLEAN NOT NULL DEFAULT false')
    expect(migration).toContain('ADD COLUMN "performanceSummary" JSONB')
    expect(migration).toContain('ADD COLUMN "visualSearchVersion" TEXT')
    expect(migration).toContain('ADD COLUMN "visualInputDigest" TEXT')
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|SELECT|DROP TABLE)\b/)
  })
})
