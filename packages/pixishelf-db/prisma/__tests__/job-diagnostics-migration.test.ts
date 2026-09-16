import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  path.resolve(process.cwd(), 'prisma/migrations/20260916160000_job_diagnostics/migration.sql'),
  'utf8'
)

describe('execution diagnostic migration', () => {
  it('adds independent nullable identity without fabricating historical reports', () => {
    expect(migration).toContain('ADD COLUMN "currentDiagnosticExecutionId" UUID;')
    expect(migration).not.toMatch(/^\s*(?:UPDATE|INSERT INTO|DROP|DELETE)\b/im)
  })
  it('deduplicates by execution and key, indexes pagination and keeps detail retention separate', () => {
    expect(migration).toContain('"system_job_diagnostic_items_reportId_key_key"')
    expect(migration).toContain('"system_job_diagnostic_items_reportId_reasonKey_id_idx"')
    expect(migration).toContain('"expiredAt" TIMESTAMP(3)')
    expect(migration).toContain('"complete" BOOLEAN NOT NULL DEFAULT false')
  })
})
