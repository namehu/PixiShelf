import { randomUUID } from 'node:crypto'
import { createDatabaseClient, disconnectDatabase, type Prisma } from '@pixishelf/db'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { acknowledgeJobFailuresCommand, retryJobCommand } from '../job-command-service'
import { backgroundFailuresInputSchema, listBackgroundFailures } from '../job-history-service'

const url = Reflect.get(process.env, 'PIXISHELF_TEST_DATABASE_URL') as string | undefined
const client = createDatabaseClient(url ? { datasourceUrl: url } : undefined)
const prefix = `failure-pg-${randomUUID()}`
const suite = url ? describe : describe.skip
const where = { id: { startsWith: prefix } }

function scopedTransaction(
  hooks: { afterRead?: () => Promise<void>; beforeBatch?: (index: number) => void | Promise<void> } = {}
) {
  return {
    $transaction: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
      client.$transaction(
        async (tx) => {
          let batch = 0
          // All-mode must never acknowledge fixtures owned by another test suite.
          const scoped = {
            ...tx,
            systemJob: {
              ...tx.systemJob,
              findMany: async (args: Prisma.SystemJobFindManyArgs) => {
                const records = await tx.systemJob.findMany({ ...args, where: { AND: [args.where ?? {}, where] } })
                await hooks.afterRead?.()
                return records
              }
            },
            systemJobFailureAcknowledgement: {
              ...tx.systemJobFailureAcknowledgement,
              createMany: async (args: Prisma.SystemJobFailureAcknowledgementCreateManyArgs) => {
                await hooks.beforeBatch?.(++batch)
                return tx.systemJobFailureAcknowledgement.createMany(args)
              }
            }
          } as unknown as Prisma.TransactionClient
          return fn(scoped)
        },
        { timeout: 30_000 }
      )
  }
}

async function seed(count: number) {
  const data = Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${String(index).padStart(5, '0')}`,
    type: 'VIDEO_MEDIA_PROBE',
    status: 'FAILED' as const,
    triggerSource: 'MANUAL' as const,
    definitionVersion: 1,
    payload: { force: false },
    error: 'fixture failure',
    createdAt: new Date('2026-09-08T00:00:00Z')
  }))
  await client.systemJob.createMany({ data })
  return data.map(({ id }) => id)
}

suite('failure acknowledgement PostgreSQL atomicity and pagination', () => {
  beforeAll(() => client.$connect())
  afterEach(async () => {
    await client.systemJob.deleteMany({
      where: { OR: [where, { idempotencyKey: { startsWith: prefix } }, { requestedByUserId: prefix }] }
    })
  })
  afterAll(() => disconnectDatabase(client))

  it('ignores more than one insert batch while retaining failures arriving after candidate capture', async () => {
    const ids = await seed(501)
    const result = await acknowledgeJobFailuresCommand(
      { scope: 'all' },
      prefix,
      scopedTransaction({
        afterRead: async () => {
          await client.systemJob.create({
            data: {
              id: `${prefix}-late`,
              type: 'VIDEO_MEDIA_PROBE',
              status: 'FAILED',
              triggerSource: 'MANUAL',
              definitionVersion: 1
            }
          })
        }
      })
    )
    expect(result).toEqual({ acknowledgedCount: 501, skippedCount: 0 })
    expect(await client.systemJobFailureAcknowledgement.count({ where: { jobId: { in: ids } } })).toBe(501)
    expect(await client.systemJobFailureAcknowledgement.findUnique({ where: { jobId: `${prefix}-late` } })).toBeNull()
    expect(await client.systemJob.count({ where: { ...where, status: 'FAILED', error: 'fixture failure' } })).toBe(501)
  })

  it('rolls back earlier batches when a later database operation fails', async () => {
    const ids = await seed(501)
    await expect(
      acknowledgeJobFailuresCommand(
        { scope: 'all' },
        prefix,
        scopedTransaction({
          beforeBatch: (index) => {
            if (index === 2) throw new Error('injected failure')
          }
        })
      )
    ).rejects.toThrow('injected failure')
    expect(await client.systemJobFailureAcknowledgement.count({ where: { jobId: { in: ids } } })).toBe(0)
  })

  it('deduplicates concurrent ignores and preserves the first acknowledgement actor and time', async () => {
    const [id] = await seed(1)
    const request = { scope: 'selected' as const, jobIds: [id!] }
    const results = await Promise.all([
      acknowledgeJobFailuresCommand(request, 'actor-one', scopedTransaction()),
      acknowledgeJobFailuresCommand(request, 'actor-two', scopedTransaction())
    ])
    expect(results.reduce((sum, result) => sum + result.acknowledgedCount, 0)).toBe(1)
    const first = await client.systemJobFailureAcknowledgement.findUnique({ where: { jobId: id! } })
    await acknowledgeJobFailuresCommand(request, 'actor-three', scopedTransaction())
    expect(await client.systemJobFailureAcknowledgement.findUnique({ where: { jobId: id! } })).toEqual(first)
  })

  it('keeps retry acknowledgement provenance and supports an ignore racing with a retry', async () => {
    const [id, concurrentId] = await seed(2)
    await retryJobCommand({ jobId: id!, requestedByUserId: prefix }, client)
    const first = await client.systemJobFailureAcknowledgement.findUnique({ where: { jobId: id! } })
    expect(first?.source).toBe('RETRY')
    await acknowledgeJobFailuresCommand({ scope: 'selected', jobIds: [id!] }, prefix, scopedTransaction())
    expect(await client.systemJobFailureAcknowledgement.findUnique({ where: { jobId: id! } })).toEqual(first)
    let waiting = 0
    let releaseWrites!: () => void
    const writesReady = new Promise<void>((resolve) => {
      releaseWrites = resolve
    })
    const waitForBothWrites = async () => {
      waiting += 1
      if (waiting === 2) releaseWrites()
      await writesReady
    }
    const retryAt = new Date('2026-09-08T01:00:00Z')
    const manualAt = new Date('2026-09-08T01:00:01Z')
    const manualActor = `${prefix}-manual`
    const [retried] = await Promise.all([
      retryJobCommand(
        { jobId: concurrentId!, requestedByUserId: prefix },
        scopedTransaction({ beforeBatch: waitForBothWrites }),
        () => retryAt
      ),
      acknowledgeJobFailuresCommand(
        { scope: 'selected', jobIds: [concurrentId!] },
        manualActor,
        scopedTransaction({ beforeBatch: waitForBothWrites }),
        () => manualAt
      )
    ])
    const concurrentAcknowledgement = await client.systemJobFailureAcknowledgement.findUnique({
      where: { jobId: concurrentId! }
    })
    const expectedFirstAcknowledgement =
      concurrentAcknowledgement?.source === 'RETRY'
        ? { acknowledgedAt: retryAt, acknowledgedByUserId: prefix, source: 'RETRY' }
        : { acknowledgedAt: manualAt, acknowledgedByUserId: manualActor, source: 'MANUAL' }
    expect(concurrentAcknowledgement).toMatchObject({ jobId: concurrentId!, ...expectedFirstAcknowledgement })
    expect(await client.systemJobFailureAcknowledgement.count({ where: { jobId: concurrentId! } })).toBe(1)
    expect((await client.systemJob.findUnique({ where: { id: concurrentId! } }))?.status).toBe('FAILED')
    expect(await client.systemJob.findUnique({ where: { id: retried.id } })).toMatchObject({
      id: retried.id,
      parentJobId: concurrentId!,
      status: 'PENDING'
    })
    await acknowledgeJobFailuresCommand(
      { scope: 'selected', jobIds: [concurrentId!] },
      `${prefix}-later`,
      scopedTransaction(),
      () => new Date('2026-09-08T01:00:02Z')
    )
    expect(await client.systemJobFailureAcknowledgement.findUnique({ where: { jobId: concurrentId! } })).toEqual(
      concurrentAcknowledgement
    )
  })

  it('continues a tied-timestamp cursor after its last item is ignored and excludes ineligible rows', async () => {
    const ids = await seed(53)
    await client.systemJob.update({ where: { id: ids[0]! }, data: { status: 'COMPLETED' } })
    await client.systemJob.update({ where: { id: ids[1]! }, data: { definitionVersion: 0 } })
    const reader = {
      systemJob: {
        findMany: (args: Prisma.SystemJobFindManyArgs) =>
          client.systemJob.findMany({ ...args, where: { AND: [args.where ?? {}, where] } })
      }
    } as never
    const first = await listBackgroundFailures(backgroundFailuresInputSchema.parse({}), reader)
    expect(first.items).toHaveLength(50)
    await acknowledgeJobFailuresCommand(
      { scope: 'selected', jobIds: [first.items.at(-1)!.id] },
      prefix,
      scopedTransaction()
    )
    const second = await listBackgroundFailures(
      backgroundFailuresInputSchema.parse({ cursor: first.nextCursor }),
      reader
    )
    expect(second.items).toHaveLength(1)
    expect(first.items.map(({ id }) => id)).not.toContain(second.items[0]!.id)
  })
})
