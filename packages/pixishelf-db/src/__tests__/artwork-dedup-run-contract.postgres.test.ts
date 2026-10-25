import { randomUUID } from 'node:crypto'
import { PrismaClient, type Prisma } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
if (url) {
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/dedup_containment_test') {
    throw new Error('Use only the authorized containment test database')
  }
}
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const prefix = `dedup-run-contract-${randomUUID()}`
let artistId: number
const createRun = (fields: Partial<Prisma.ArtworkDedupRunUncheckedCreateInput> = {}) =>
  db!.artworkDedupRun.create({
    data: {
      artistId,
      requestedBy: prefix,
      idempotencyKey: randomUUID(),
      mode: 'INCREMENTAL',
      status: 'COMPLETED',
      ...fields
    }
  })

describe.skipIf(!db)('restored detection run contract and containment cursors', () => {
  beforeAll(async () => {
    artistId = (await db!.artist.create({ data: { name: prefix } })).id
  })
  afterAll(async () => {
    if (!db) return
    await db.artworkDedupRun.deleteMany({ where: { requestedBy: prefix } })
    if (artistId !== undefined) await db.artist.delete({ where: { id: artistId } })
    await db.$disconnect()
  })

  it.each(['STAT', 'CANDIDATES', 'HASH', 'GROUP', 'MATCH', 'DONE'])('accepts stage %s', async (stage) => {
    expect(await createRun({ stage })).toMatchObject({ stage, relationAfterArtworkId: 0, relationAfterCandidateId: 0 })
  })
  it('retains both modes, all existing statuses and positive containment checkpoints', async () => {
    const run = await createRun({ mode: 'FULL', relationAfterArtworkId: 1, relationAfterCandidateId: 100 })
    for (const status of ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING', 'COMPLETED', 'FAILED', 'CANCELLED']) {
      expect(await db!.artworkDedupRun.update({ where: { id: run.id }, data: { status } })).toMatchObject({ status })
    }
  })
  it.each(['STARTING', 'ACTIVE', 'BLOCKED'])('accepts %s only with a reader token', async (readerState) => {
    const readerToken = randomUUID()
    expect(await createRun({ readerState, readerToken })).toMatchObject({ readerState, readerToken })
  })
  it.each([
    { mode: 'UNKNOWN' },
    { status: 'UNKNOWN' },
    { stage: 'UNKNOWN' },
    { version: 0 },
    { version: -1 },
    { executionVersion: 0 },
    { executionVersion: -1 },
    { algorithmVersion: 0 },
    { algorithmVersion: 2 },
    { readerState: 'UNKNOWN', readerToken: null },
    { readerState: 'IDLE', readerToken: 'must-not-be-held' },
    { readerState: 'STARTING', readerToken: null },
    { readerState: 'ACTIVE', readerToken: null },
    { readerState: 'BLOCKED', readerToken: null }
  ])('rejects invalid original invariant %#', async (fields) => {
    await expect(createRun(fields)).rejects.toThrow('ArtworkDedupRun_contract')
  })
  it.each([
    { relationAfterArtworkId: -1 },
    { relationAfterCandidateId: -1 }
  ])('rejects negative containment cursor %# on update', async (fields) => {
    const run = await createRun({ stage: 'MATCH' })
    await expect(db!.artworkDedupRun.update({ where: { id: run.id }, data: fields }))
      .rejects.toThrow('ArtworkDedupRun_relation_cursor_check')
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.id } }))
      .toMatchObject({ relationAfterArtworkId: 0, relationAfterCandidateId: 0 })
  })
})
