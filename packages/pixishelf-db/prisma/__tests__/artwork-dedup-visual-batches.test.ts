import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const migration = readFileSync(new URL('../migrations/20261027000200_artwork_dedup_visual_batches/migration.sql', import.meta.url), 'utf8')
const previous = readFileSync(new URL('../migrations/20261026000100_artwork_dedup_partial/migration.sql', import.meta.url), 'utf8')
describe('F03 durable visual work migration', () => {
  it('changes only scan version admission in the existing job policy', () => {
    const marker = 'ALTER TABLE "system_jobs" DROP CONSTRAINT "system_jobs_dedup_policy";'
    expect(migration.slice(migration.indexOf(marker))).toBe(previous.slice(previous.indexOf(marker)).replace("type='ARTWORK_DEDUP_SCAN' AND \"definitionVersion\" IN(2,3,4)", "type='ARTWORK_DEDUP_SCAN' AND \"definitionVersion\" IN(2,3,4,5)"))
  })
  it('keeps work run-local, cascade-cleanable and adds no inferred historical completion', () => {
    expect(migration).toContain('ADD COLUMN "visualCheckpoint" JSONB')
    expect(migration).toContain('ADD COLUMN "visualReuseSignature" TEXT')
    expect(migration.match(/ON DELETE CASCADE/g)).toHaveLength(2)
    expect(migration).toContain('CHECK ("multiplicity" BETWEEN 1 AND 4)')
    expect(migration).not.toMatch(/UPDATE\s+"(?:ArtworkDedup|MediaVisual)/)
  })
})

const rounds = readFileSync(new URL('../migrations/20261028000100_artwork_dedup_visual_rounds/migration.sql', import.meta.url), 'utf8')
describe('F03 visual round migration', () => {
  it('admits scan v6 while preserving maintenance policy and initializes no historical round', () => {
    const marker = 'ALTER TABLE "system_jobs" DROP CONSTRAINT "system_jobs_dedup_policy";'
    expect(rounds.slice(rounds.indexOf(marker))).toBe(migration.slice(migration.indexOf(marker)).replace("type='ARTWORK_DEDUP_SCAN' AND \"definitionVersion\" IN(2,3,4,5)", "type='ARTWORK_DEDUP_SCAN' AND \"definitionVersion\" IN(2,3,4,5,6)"))
    expect(rounds).toContain('ADD COLUMN "visualComparisonRound" INTEGER NOT NULL DEFAULT 0')
    expect(rounds).not.toMatch(/UPDATE\s+"(?:ArtworkDedupMedia|MediaVisualFingerprint)"/)
    expect(rounds).toContain("NEW.status IN ('FAILED','SKIPPED','CANCELLED')")
    expect(rounds).not.toContain("NEW.status IN ('COMPLETED','FAILED'")
  })
})
