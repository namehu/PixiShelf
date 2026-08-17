import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '../../../pixishelf-db/src/index.js'
import { cleanupStaleWorkerInstances } from '../worker-presence.js'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe : describe.skip
const workerId = `worker-retention-race-${randomUUID()}`
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null

describePostgres('WorkerInstance retention integration', () => {
  afterAll(async () => {
    if (!prisma) return
    await prisma.workerInstance.deleteMany({ where: { workerId } })
    await prisma.$disconnect()
  })

  it('preserves an instance whose heartbeat refreshes after selection and before the guarded delete', async () => {
    const client = databaseClient()
    const now = new Date('2026-08-17T00:00:00.000Z')
    const staleHeartbeat = new Date('2026-08-01T00:00:00.000Z')
    await client.workerInstance.create({
      data: {
        workerId,
        status: 'READY',
        serviceVersion: 'retention-test',
        hostname: 'retention-test',
        processId: 1,
        capabilities: [],
        startedAt: staleHeartbeat,
        heartbeatAt: staleHeartbeat,
        lastError: null
      }
    })

    const result = await cleanupStaleWorkerInstances(
      {
        workerInstance: {
          findMany: async (args) => {
            const selected = await client.workerInstance.findMany({
              ...args,
              where: { AND: [args.where, { workerId }] }
            } as never)
            await client.workerInstance.update({ where: { workerId }, data: { heartbeatAt: now } })
            return selected
          },
          deleteMany: (args) =>
            client.workerInstance.deleteMany({
              where: { AND: [args.where, { workerId }] }
            } as never)
        }
      },
      now
    )

    expect(result).toEqual({ selected: 1, deleted: 0, hasMore: false })
    await expect(
      client.workerInstance.findUnique({ where: { workerId }, select: { heartbeatAt: true } })
    ).resolves.toEqual({
      heartbeatAt: now
    })
  })
})

function databaseClient() {
  if (!prisma) throw new Error('QUEUE_KERNEL_TEST_DATABASE_URL is required')
  return prisma
}
