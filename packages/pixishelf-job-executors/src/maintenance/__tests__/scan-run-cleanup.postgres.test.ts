import { randomUUID } from 'node:crypto'
import { SINGLETON_JOB_ADVISORY_LOCK_NAMESPACE } from '@pixishelf/job-contracts'
import { PrismaClient } from '@pixishelf/db'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanupScanRunHistory } from '../scan-run-cleanup.js'
import type { RunMaintenanceMutation } from '../types.js'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const concurrentPrisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const prefix = `src-${randomUUID().slice(0, 6)}`
const oldDate = new Date('2026-06-01T00:00:00.000Z')
const recentDate = new Date('2026-08-19T00:00:00.000Z')
const now = new Date('2026-08-20T00:00:00.000Z')

describePostgres('scan run retention PostgreSQL integration', () => {
  beforeEach(cleanupDatabase)

  afterAll(async () => {
    await cleanupDatabase()
    await Promise.all([prisma?.$disconnect(), concurrentPrisma?.$disconnect()])
  })

  it('expires an audit and every terminal apply child but preserves a parent with active apply work', async () => {
    const parent = await seedRun('expired-parent', {
      operationKind: 'CONSISTENCY_AUDIT',
      status: 'COMPLETED',
      finishedAt: oldDate
    })
    const completedChild = await seedRun('completed-child', {
      operationKind: 'AUDIT_APPLY',
      sourceAuditRunId: parent.id,
      status: 'COMPLETED',
      finishedAt: recentDate
    })
    const failedChild = await seedRun('failed-child', {
      operationKind: 'AUDIT_APPLY',
      sourceAuditRunId: parent.id,
      status: 'FAILED',
      finishedAt: recentDate
    })
    const blockedParent = await seedRun('blocked-parent', {
      operationKind: 'CONSISTENCY_AUDIT',
      status: 'COMPLETED',
      finishedAt: oldDate
    })
    const activeChild = await seedRun('active-child', {
      operationKind: 'AUDIT_APPLY',
      sourceAuditRunId: blockedParent.id,
      status: 'RUNNING',
      finishedAt: null
    })
    const ordinary = await seedRun('ordinary', { status: 'FAILED', finishedAt: oldDate })
    const recent = await seedRun('recent', { status: 'COMPLETED', finishedAt: recentDate })

    const result = await cleanupScanRunHistory(cleanupInput({ maxAgeDays: 30 }))

    expect(result).toEqual({ deletedRuns: 4, expiredRuns: 4, overflowRuns: 0 })
    expect(await existingIds()).toEqual(expect.arrayContaining([blockedParent.id, activeChild.id, recent.id]))
    expect(await existingIds()).not.toEqual(
      expect.arrayContaining([parent.id, completedChild.id, failedChild.id, ordinary.id])
    )
  })

  it('applies the same parent-child safety rules to overflow deletion', async () => {
    const recent = await seedRun('overflow-recent', { status: 'COMPLETED', finishedAt: recentDate })
    const parent = await seedRun('overflow-parent', {
      operationKind: 'CONSISTENCY_AUDIT',
      status: 'COMPLETED',
      finishedAt: oldDate
    })
    const child = await seedRun('overflow-child', {
      operationKind: 'AUDIT_APPLY',
      sourceAuditRunId: parent.id,
      status: 'CANCELLED',
      finishedAt: oldDate
    })

    const result = await cleanupScanRunHistory(cleanupInput({ maxAgeDays: 365, maxRunsPerType: 1 }))

    expect(result).toEqual({ deletedRuns: 2, expiredRuns: 0, overflowRuns: 2 })
    expect(await existingIds()).toEqual([recent.id])
    expect(await db().scanRun.findUnique({ where: { id: parent.id } })).toBeNull()
    expect(await db().scanRun.findUnique({ where: { id: child.id } })).toBeNull()
  })

  it('preserves an overflow apply child while its audit parent is inside the retained window', async () => {
    const parent = await seedRun('retained-parent', {
      operationKind: 'CONSISTENCY_AUDIT',
      status: 'COMPLETED',
      finishedAt: recentDate
    })
    const child = await seedRun('overflow-only-child', {
      operationKind: 'AUDIT_APPLY',
      sourceAuditRunId: parent.id,
      status: 'COMPLETED',
      finishedAt: oldDate
    })

    const result = await cleanupScanRunHistory(cleanupInput({ maxAgeDays: 365, maxRunsPerType: 1 }))

    expect(result).toEqual({ deletedRuns: 0, expiredRuns: 0, overflowRuns: 0 })
    expect(await existingIds()).toEqual(expect.arrayContaining([parent.id, child.id]))
  })

  it('holds the shared SCAN advisory lock until its fenced delete transaction commits', async () => {
    await seedRun('lock-proof', { status: 'FAILED', finishedAt: oldDate })
    let competingLockSettled = false
    let competingLock: Promise<void> | null = null
    const mutate: RunMaintenanceMutation = (operation) =>
      db().$transaction(async (transaction) => {
        const wrapped = new Proxy(transaction, {
          get(target, property, receiver) {
            if (property !== '$queryRawUnsafe') return Reflect.get(target, property, receiver)
            return async (...args: unknown[]) => {
              const result = await transaction.$queryRawUnsafe(...(args as [string, ...unknown[]]))
              competingLock = otherDb()
                .$transaction(async (other) => {
                  await other.$queryRawUnsafe(
                    'SELECT pg_advisory_xact_lock($1::integer, hashtext($2::text))::text AS "lock"',
                    SINGLETON_JOB_ADVISORY_LOCK_NAMESPACE,
                    'SCAN'
                  )
                })
                .then(() => {
                  competingLockSettled = true
                })
              await new Promise((resolve) => setTimeout(resolve, 40))
              expect(competingLockSettled).toBe(false)
              return result
            }
          }
        })
        return operation(wrapped)
      })

    await cleanupScanRunHistory(cleanupInput({ maxAgeDays: 30 }, mutate))
    await competingLock

    expect(competingLockSettled).toBe(true)
  })
})

function cleanupInput(
  options: { maxAgeDays?: number; maxRunsPerType?: number },
  mutate: RunMaintenanceMutation = (operation) => db().$transaction((transaction) => operation(transaction))
) {
  return {
    database: db(),
    mutate,
    signal: new AbortController().signal,
    progress: vi.fn(),
    now,
    ...options
  }
}

async function seedRun(
  suffix: string,
  input: {
    operationKind?: 'CONSISTENCY_AUDIT' | 'AUDIT_APPLY'
    sourceAuditRunId?: string
    status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
    finishedAt: Date | null
  }
) {
  return db().scanRun.create({
    data: {
      id: `${prefix}-${suffix}`,
      type: 'PIXIV',
      mode: 'INCREMENTAL',
      status: input.status,
      startedAt: oldDate,
      finishedAt: input.finishedAt,
      createdAt: oldDate,
      ...(input.operationKind ? { operationKind: input.operationKind } : {}),
      ...(input.sourceAuditRunId ? { sourceAuditRunId: input.sourceAuditRunId } : {})
    }
  })
}

async function existingIds() {
  const rows = await db().scanRun.findMany({
    where: { id: { startsWith: prefix } },
    orderBy: { id: 'asc' },
    select: { id: true }
  })
  return rows.map(({ id }) => id)
}

async function cleanupDatabase() {
  if (!prisma) return
  await prisma.scanRun.deleteMany({ where: { id: { startsWith: prefix } } })
}

function db() {
  if (!prisma) throw new Error('QUEUE_KERNEL_TEST_DATABASE_URL is required')
  return prisma
}

function otherDb() {
  if (!concurrentPrisma) throw new Error('QUEUE_KERNEL_TEST_DATABASE_URL is required')
  return concurrentPrisma
}
