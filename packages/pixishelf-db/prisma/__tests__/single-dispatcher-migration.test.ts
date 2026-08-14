import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const prismaDirectory = path.resolve(process.cwd(), 'prisma')
const migration = readFileSync(
  path.join(prismaDirectory, 'migrations/20260814110000_add_single_dispatcher_execution_fence/migration.sql'),
  'utf8'
)

describe('single dispatcher database fence migration', () => {
  it('fails clearly when the pre-cutover database has even one executing job', () => {
    const guardEnd = migration.indexOf('$$;')
    const indexStart = migration.indexOf('CREATE UNIQUE INDEX')

    expect(migration).toContain('BEGIN;')
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true)
    expect(migration).toContain(`WHERE "status" IN ('RUNNING', 'PAUSING', 'CANCELLING')`)
    expect(migration).toContain('IF executing_count > 0 THEN')
    expect(migration).toContain('drain all jobs and stop old workers first')
    expect(guardEnd).toBeGreaterThan(0)
    expect(indexStart).toBeGreaterThan(guardEnd)
  })

  it('adds a partial unique expression index for all executing states', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "system_jobs_single_executing_job_idx"')
    expect(migration).toContain('ON "system_jobs" ((1))')
    expect(migration).toContain(`WHERE "status" IN ('RUNNING', 'PAUSING', 'CANCELLING')`)
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|INSERT)\b/)
  })
})
