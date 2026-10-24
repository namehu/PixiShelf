import { randomUUID } from 'node:crypto'
import { createDatabaseClient, disconnectDatabase, Prisma, captureArtworkDedupSources } from '@pixishelf/db'
import { parseArtworkDedupSourceSnapshot } from '@pixishelf/job-contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryJobCommand } from '@/services/background-task/job-command-service'
import {
  createArchiveIntakeSubmission,
  replaceArchiveIntakeItem,
  retryArchiveIntakeMany
} from '../archive-intake-service'

const url = process.env.PIXISHELF_TEST_DATABASE_URL
if (url) {
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/dedup_app_inputs112') {
    throw new Error('Requires the dedicated synthetic App input database')
  }
}
const describePostgres = url ? describe : describe.skip
const database = createDatabaseClient(url ? { datasourceUrl: url } : undefined)
const prefix = `dedup-app-input-${randomUUID()}`
const userId = `${prefix}-user`
const externalIds: string[] = []
let sequence = 0
const firstId = 800_000_000_000 + Math.floor(Math.random() * 100_000_000)
function nextId() {
  const id = String(firstId + sequence++)
  externalIds.push(id)
  return id
}
function gallery(id: string) {
  return `https://e-hentai.org/g/${id}/token/`
}
function key(label: string) {
  return `${prefix}-${label}-${sequence++}`
}
async function markFailed(id: string) {
  const item = await database.archiveIntakeItem.update({ where: { id }, data: { status: 'FAILED', retryable: true } })
  await database.systemJob.update({ where: { id: item.currentSystemJobId! }, data: { status: 'FAILED' } })
  return item
}

describePostgres('Intake durable dedup source proof production transaction', () => {
  beforeAll(async () => {
    await database.$connect()
  })
  afterAll(async () => {
    await database.archiveBulkOperation.deleteMany({ where: { requestedByUserId: userId } })
    await database.archiveIntakeSubmission.deleteMany({ where: { requestedByUserId: userId } })
    await database.systemJob.deleteMany({ where: { requestedByUserId: userId } })
    await database.artworkDedupSourceIdentity.deleteMany({
      where: { providerKey: 'e-hentai', externalId: { in: externalIds } }
    })
    await disconnectDatabase(database)
  })

  it('captures /g and /s before RESOLVE with shared identity and hides proofs from the wire', async () => {
    const id = nextId()
    const request = {
      idempotencyKey: key('both'),
      urls: [gallery(id), `https://e-hentai.org/s/pagekey/${id}-2`],
      downloadMode: 'AUTO' as const
    }
    const submission = await createArchiveIntakeSubmission(request, userId, { database })
    expect(submission.acceptedCount).toBe(2)
    expect(submission.items.every((item) => item.sourceIntentValid)).toBe(true)
    expect(submission.items[0]).not.toHaveProperty('dedupSourceSnapshot')
    const rows = await database.archiveIntakeItem.findMany({
      where: { submissionId: submission.id },
      orderBy: { queueOrder: 'asc' }
    })
    const proofs = rows.map((row) => parseArtworkDedupSourceSnapshot(row.dedupSourceSnapshot))
    expect(proofs[0]).toEqual(proofs[1])
    expect(proofs[0]!.sources[0]!.identity).toEqual({ kind: 'PROVIDER', providerKey: 'e-hentai', externalId: id })
    expect(rows.every((row) => row.currentSystemJobId)).toBe(true)
    const replay = await createArchiveIntakeSubmission(request, userId, { database })
    expect(replay.id).toBe(submission.id)
    expect(
      await database.systemJob.count({
        where: { requestedByUserId: userId, id: { in: rows.map((row) => row.currentSystemJobId!) } }
      })
    ).toBe(2)
  })

  it('rolls back the whole new submission and queued jobs when one batched source is held', async () => {
    const held = nextId(),
      open = nextId()
    const [source] = await database.$transaction((tx) =>
      captureArtworkDedupSources(tx, { identities: [{ kind: 'PROVIDER', providerKey: 'e-hentai', externalId: held }] })
    )
    await database.artworkDedupSourceIdentity.update({
      where: { id: source!.sourceId },
      data: { status: 'HOLD', ownerOperationId: `${prefix}-synthetic-owner` }
    })
    const idempotencyKey = key('held')
    const before = await database.systemJob.count({ where: { requestedByUserId: userId } })
    await expect(
      createArchiveIntakeSubmission({ idempotencyKey, urls: [gallery(open), gallery(held)] }, userId, { database })
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(await database.archiveIntakeSubmission.findUnique({ where: { idempotencyKey } })).toBeNull()
    expect(await database.systemJob.count({ where: { requestedByUserId: userId } })).toBe(before)
    expect(
      await database.artworkDedupSourceIdentity.count({ where: { providerKey: 'e-hentai', externalId: open } })
    ).toBe(0)
  })

  it.each(['null', 'generation', 'identity'])(
    'rejects %s original proof on retry without changing the old intent',
    async (mode) => {
      const id = nextId()
      const submission = await createArchiveIntakeSubmission(
        { idempotencyKey: key(mode), urls: [gallery(id)] },
        userId,
        { database }
      )
      const item = await markFailed(submission.items[0]!.id)
      const proof = parseArtworkDedupSourceSnapshot(item.dedupSourceSnapshot)
      if (mode === 'null')
        {await database.archiveIntakeItem.update({
          where: { id: item.id },
          data: { dedupSourceSnapshot: Prisma.DbNull }
        })}
      if (mode === 'generation')
        {await database.artworkDedupSourceIdentity.update({
          where: { id: proof.sources[0]!.sourceId },
          data: { generation: { increment: 1 } }
        })}
      if (mode === 'identity')
        {await database.archiveIntakeItem.update({
          where: { id: item.id },
          data: {
            dedupSourceSnapshot: {
              ...proof,
              sources: [
                { ...proof.sources[0]!, identity: { kind: 'PROVIDER', providerKey: 'e-hentai', externalId: nextId() } }
              ]
            }
          }
        })}
      const original = await database.archiveIntakeItem.findUniqueOrThrow({ where: { id: item.id } })
      const result = await retryArchiveIntakeMany({ idempotencyKey: key('retry'), itemIds: [item.id] }, userId, {
        database
      })
      expect(result?.items[0]).toMatchObject({ result: 'CONFLICT', code: 'STATE_CONFLICT' })
      expect(await database.archiveIntakeItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
        currentSystemJobId: original.currentSystemJobId,
        status: original.status,
        dedupSourceSnapshot: original.dedupSourceSnapshot
      })
      await expect(
        retryJobCommand({ jobId: item.currentSystemJobId!, requestedByUserId: userId }, database)
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
      expect(await database.systemJob.count({ where: { parentJobId: item.currentSystemJobId } })).toBe(0)
    }
  )

  it('preserves valid retry proof and captures a new proof only for a corrected new item', async () => {
    const originalId = nextId(),
      replacementId = nextId()
    const submission = await createArchiveIntakeSubmission(
      { idempotencyKey: key('valid'), urls: [gallery(originalId)] },
      userId,
      { database }
    )
    const original = await markFailed(submission.items[0]!.id)
    const retry = await retryArchiveIntakeMany({ idempotencyKey: key('valid-retry'), itemIds: [original.id] }, userId, {
      database
    })
    expect(retry?.items[0]?.result).toBe('APPLIED')
    expect(
      (await database.archiveIntakeItem.findUniqueOrThrow({ where: { id: original.id } })).dedupSourceSnapshot
    ).toEqual(original.dedupSourceSnapshot)
    await markFailed(original.id)
    const replacement = await replaceArchiveIntakeItem(
      { idempotencyKey: key('replace'), itemId: original.id, url: gallery(replacementId) },
      userId,
      { database }
    )
    const fresh = await database.archiveIntakeItem.findUniqueOrThrow({ where: { id: replacement.items[0]!.id } })
    expect(fresh.supersedesItemId).toBe(original.id)
    expect(parseArtworkDedupSourceSnapshot(fresh.dedupSourceSnapshot).sources[0]!.identity).toEqual({
      kind: 'PROVIDER',
      providerKey: 'e-hentai',
      externalId: replacementId
    })
  })
})
