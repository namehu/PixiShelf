import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const prismaDirectory = path.resolve(process.cwd(), 'prisma')
const schema = readFileSync(path.join(prismaDirectory, 'schema.prisma'), 'utf8')
const migration = readFileSync(
  path.join(prismaDirectory, 'migrations/20260826120000_add_system_job_failure_acknowledgements/migration.sql'),
  'utf8'
)

describe('system job failure acknowledgements migration', () => {
  it('stores one immutable acknowledgement beside each job history', () => {
    expect(schema).toContain('model SystemJobFailureAcknowledgement {')
    expect(schema).toMatch(/jobId\s+String\s+@id/)
    expect(schema).toContain('failureAcknowledgement  SystemJobFailureAcknowledgement?')
    expect(migration).toContain('PRIMARY KEY ("jobId")')
    expect(migration).toContain('ON DELETE CASCADE ON UPDATE CASCADE')
  })

  it('records manual, retry, and migration acknowledgement sources', () => {
    expect(schema).toContain('enum JobFailureAcknowledgementSource {')
    expect(migration).toContain("('MANUAL', 'RETRY', 'MIGRATION')")
  })

  it('acknowledges existing v1 failures without changing their terminal state', () => {
    expect(migration).toContain('FROM "system_jobs"')
    expect(migration).toContain('WHERE "definitionVersion" >= 1')
    expect(migration).toContain('AND "status" = \'FAILED\'')
    expect(migration).toContain('\'MIGRATION\'::"JobFailureAcknowledgementSource"')
    expect(migration).not.toMatch(/UPDATE\s+"system_jobs"/i)
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"system_jobs"/i)
  })
})
