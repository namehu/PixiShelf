import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const prismaDirectory = path.resolve(process.cwd(), 'prisma')
const schema = readFileSync(path.join(prismaDirectory, 'schema.prisma'), 'utf8')
const migration = readFileSync(
  path.join(prismaDirectory, 'migrations/20260904200000_add_system_job_progress_data/migration.sql'),
  'utf8'
)

describe('system job structured progress migration', () => {
  it('adds a nullable JSON column without rewriting historical jobs', () => {
    expect(schema).toMatch(/progressData\s+Json\?/)
    expect(migration).toContain('ADD COLUMN "progressData" JSONB')
    expect(migration).not.toMatch(/\bUPDATE\b/i)
    expect(migration).not.toMatch(/NOT NULL/i)
  })

  it('indexes the two event retention tiers by type and age', () => {
    expect(schema).toContain('@@index([type, level, createdAt, id])')
    expect(migration).toContain('"system_job_events"("type", "level", "createdAt", "id")')
  })
})
