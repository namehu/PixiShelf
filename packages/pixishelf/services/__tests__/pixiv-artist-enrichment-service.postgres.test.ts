import { randomUUID } from 'node:crypto'
import { createDatabaseClient, disconnectDatabase } from '@pixishelf/db'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cancelPixivArtistEnrichment } from '../pixiv-artist-enrichment-service'

const testDatabaseUrl = Reflect.get(process.env, 'PIXISHELF_TEST_DATABASE_URL') as string | undefined
const describePostgres = testDatabaseUrl ? describe : describe.skip
const suitePrefix = `pixiv-artist-cancel-${randomUUID()}`
const requestedByUserId = `${suitePrefix}-admin`
const database = createDatabaseClient(testDatabaseUrl ? { datasourceUrl: testDatabaseUrl } : undefined)
const workerDatabase = createDatabaseClient(testDatabaseUrl ? { datasourceUrl: testDatabaseUrl } : undefined)
type SeedStatus = 'PENDING' | 'RETRY_WAIT' | 'PAUSED' | 'RUNNING'

describePostgres('Pixiv artist enrichment PostgreSQL cancellation', () => {
  beforeAll(async () => {
    await Promise.all([database.$connect(), workerDatabase.$connect()])
  })

  afterEach(async () => {
    await database.systemJob.deleteMany({ where: { requestedByUserId } })
  })

  afterAll(async () => {
    await Promise.all([disconnectDatabase(database), disconnectDatabase(workerDatabase)])
  })

  it('transitions the whole batch by child state and keeps repeated cancellation idempotent', async () => {
    const rootId = await seedBatchRoot('bulk')
    const childIds = await seedChildren(rootId, ['PENDING', 'RETRY_WAIT', 'PAUSED', 'RUNNING'])

    await expect(cancelPixivArtistEnrichment(rootId, database)).resolves.toMatchObject({
      batchId: rootId,
      affectedCount: 4
    })

    const children = await database.systemJob.findMany({
      where: { id: { in: childIds } },
      orderBy: { id: 'asc' },
      select: { id: true, status: true, cancelRequestedAt: true, finishedAt: true }
    })
    expect(children.map(({ status }) => status).sort()).toEqual(['CANCELLED', 'CANCELLED', 'CANCELLED', 'CANCELLING'])
    expect(children.filter(({ status }) => status === 'CANCELLED')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cancelRequestedAt: expect.any(Date), finishedAt: expect.any(Date) })
      ])
    )
    await expect(
      database.systemJobEvent.count({ where: { jobId: { in: childIds }, type: 'job.cancel_requested' } })
    ).resolves.toBe(4)
    await expect(
      database.systemJobEvent.count({ where: { jobId: { in: childIds }, type: 'job.cancelled' } })
    ).resolves.toBe(3)

    await expect(cancelPixivArtistEnrichment(rootId, database)).resolves.toMatchObject({ affectedCount: 0 })
    await expect(database.systemJobEvent.count({ where: { jobId: { in: childIds } } })).resolves.toBe(7)
  })

  it('turns a child claimed while cancellation waits for its row lock into cancelling', async () => {
    const rootId = await seedBatchRoot('claim-race')
    const [childId] = await seedChildren(rootId, ['PENDING'])
    let releaseClaim!: () => void
    let markClaimLocked!: () => void
    const claimLocked = new Promise<void>((resolve) => {
      markClaimLocked = resolve
    })
    const claimMayCommit = new Promise<void>((resolve) => {
      releaseClaim = resolve
    })

    const claim = workerDatabase.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id"
        FROM "system_jobs"
        WHERE "id" = ${childId}
        FOR UPDATE
      `
      markClaimLocked()
      await claimMayCommit
      const now = new Date()
      await transaction.systemJob.update({
        where: { id: childId },
        data: {
          status: 'RUNNING',
          attempt: { increment: 1 },
          workerId: `${suitePrefix}-worker`,
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(now.getTime() + 60_000),
          heartbeatAt: now,
          startedAt: now,
          lastAttemptStartedAt: now
        }
      })
    })
    await claimLocked

    const cancellation = cancelPixivArtistEnrichment(rootId, database)
    await new Promise((resolve) => setTimeout(resolve, 20))
    releaseClaim()
    await claim

    await expect(cancellation).resolves.toMatchObject({ affectedCount: 1 })
    await expect(database.systemJob.findUnique({ where: { id: childId }, select: { status: true } })).resolves.toEqual({
      status: 'CANCELLING'
    })
  })
})

async function seedBatchRoot(suffix: string) {
  const root = await database.systemJob.create({
    data: {
      id: `${suitePrefix}-${suffix}-root`,
      type: 'PIXIV_ARTIST_ENRICHMENT',
      executionLane: 'BACKGROUND_WRITER',
      status: 'COMPLETED',
      triggerSource: 'MANUAL',
      requestedByUserId,
      payload: { mode: 'DISCOVER', force: false },
      finishedAt: new Date()
    }
  })
  return root.id
}

async function seedChildren(rootId: string, statuses: SeedStatus[]) {
  const now = new Date()
  const children = statuses.map((status, index) => ({
    id: `${rootId}-child-${index.toString().padStart(2, '0')}`,
    type: 'PIXIV_ARTIST_ENRICHMENT',
    executionLane: 'BACKGROUND_WRITER' as const,
    status,
    triggerSource: 'MANUAL' as const,
    requestedByUserId,
    parentJobId: rootId,
    payload: {
      mode: 'ARTIST',
      artistId: index + 1,
      expectedExternalRefId: `ref-${index + 1}`,
      expectedPixivUserId: String(index + 101),
      force: false
    },
    attempt: status === 'RUNNING' ? 1 : 0,
    workerId: status === 'RUNNING' ? `${suitePrefix}-worker` : null,
    leaseToken: status === 'RUNNING' ? randomUUID() : null,
    leaseExpiresAt: status === 'RUNNING' ? new Date(now.getTime() + 60_000) : null,
    heartbeatAt: status === 'RUNNING' ? now : null,
    startedAt: status === 'RUNNING' ? now : null,
    lastAttemptStartedAt: status === 'RUNNING' ? now : null
  }))
  await database.systemJob.createMany({ data: children })
  return children.map(({ id }) => id)
}
