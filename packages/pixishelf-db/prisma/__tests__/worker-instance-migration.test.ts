import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const prismaDirectory = path.resolve(process.cwd(), 'prisma')
const schema = readFileSync(path.join(prismaDirectory, 'schema.prisma'), 'utf8')
const migration = readFileSync(
  path.join(
    prismaDirectory,
    'migrations/20260814100000_add_worker_instances/migration.sql',
  ),
  'utf8',
)

describe('worker instance migration contract', () => {
  it('is an isolated additive migration with an explicit transaction', () => {
    const transactionStart = migration.indexOf('BEGIN;')
    const transactionEnd = migration.lastIndexOf('COMMIT;')

    expect(transactionStart).toBeGreaterThanOrEqual(0)
    expect(transactionEnd).toBeGreaterThan(transactionStart)
    expect(migration.slice(transactionEnd + 'COMMIT;'.length).trim()).toBe('')
    expect(migration).toContain('CREATE TYPE "WorkerInstanceStatus" AS ENUM')
    expect(migration).toContain('CREATE TABLE "worker_instances"')
    expect(migration).toContain(
      'CREATE INDEX "worker_instances_status_heartbeatAt_idx"',
    )
    expect(migration).not.toMatch(/\b(?:ALTER|UPDATE|DELETE|INSERT)\b/)
  })

  it('keeps the Prisma model and enum aligned with the SQL migration', () => {
    expect(schema).toMatch(/model WorkerInstance \{[\s\S]*@@map\("worker_instances"\)/)
    expect(schema).toMatch(/workerId\s+String\s+@id\s+@db\.VarChar\(120\)/)
    expect(schema).toMatch(/status\s+WorkerInstanceStatus\s+@default\(STARTING\)/)
    expect(schema).toMatch(/serviceVersion\s+String\s+@db\.VarChar\(50\)/)
    expect(schema).toMatch(/hostname\s+String\s+@db\.VarChar\(255\)/)
    expect(schema).toMatch(/capabilities\s+Json\?/)
    expect(schema).toContain('@@index([status, heartbeatAt])')

    for (const status of ['STARTING', 'READY', 'DEGRADED', 'STOPPING']) {
      expect(schema).toMatch(
        new RegExp(`enum WorkerInstanceStatus \\{[\\s\\S]*\\b${status}\\b`),
      )
      expect(migration).toContain(`'${status}'`)
    }
  })
})
