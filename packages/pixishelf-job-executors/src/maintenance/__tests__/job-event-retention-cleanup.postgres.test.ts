import { randomUUID } from 'node:crypto'
import { PrismaClient, type Prisma } from '@pixishelf/db'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { cleanupJobEvents } from '../job-event-retention-cleanup.js'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const rollback = new Error('rollback job event retention fixture')

describePostgres('job event retention PostgreSQL integration', () => {
  afterAll(() => prisma?.$disconnect())

  it('uses the seven-day progress and ninety-day lifecycle cutoffs without overlap', async () => {
    const jobId = `job-event-retention-${randomUUID()}`
    const now = new Date('2026-09-04T00:00:00.000Z')
    const eightDaysOld = new Date('2026-08-27T00:00:00.000Z')
    const ninetyOneDaysOld = new Date('2026-06-05T00:00:00.000Z')

    await expect(
      db().$transaction(async (transaction) => {
        await transaction.systemJob.create({
          data: {
            id: jobId,
            type: 'WEBP_ANIMATION_SCAN',
            executionLane: 'BACKGROUND_WRITER',
            definitionVersion: 1,
            status: 'COMPLETED',
            triggerSource: 'SYSTEM',
            progress: 100,
            finishedAt: now
          }
        })
        await transaction.systemJobEvent.createMany({
          data: [
            event(jobId, 'expired-progress', 'job.progress', 'INFO', eightDaysOld),
            event(jobId, 'retained-stage', 'job.stage_changed', 'INFO', eightDaysOld),
            event(jobId, 'expired-stage', 'job.stage_changed', 'INFO', ninetyOneDaysOld),
            event(jobId, 'expired-warning', 'job.progress', 'WARN', ninetyOneDaysOld),
            event(jobId, 'recent-progress', 'job.progress', 'INFO', now)
          ]
        })

        const result = await cleanupJobEvents({
          database: transaction,
          mutate: (operation) => operation(transaction),
          signal: new AbortController().signal,
          progress: vi.fn(),
          dryRun: false,
          now
        })
        const remaining = await transaction.systemJobEvent.findMany({
          where: { jobId },
          orderBy: { message: 'asc' },
          select: { message: true }
        })

        expect(result).toMatchObject({
          progressCandidates: 1,
          lifecycleCandidates: 2,
          deletedProgressEvents: 1,
          deletedLifecycleEvents: 2
        })
        expect(remaining.map(({ message }) => message)).toEqual(['recent-progress', 'retained-stage'])
        throw rollback
      })
    ).rejects.toBe(rollback)
  })
})

function event(
  jobId: string,
  message: string,
  type: string,
  level: 'INFO' | 'WARN',
  createdAt: Date
): Prisma.SystemJobEventCreateManyInput {
  return { jobId, message, type, level, createdAt }
}

function db() {
  if (!prisma) throw new Error('QUEUE_KERNEL_TEST_DATABASE_URL is required')
  return prisma
}
