import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@pixishelf/db'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  backgroundHistoryInputSchema,
  getBackgroundHistorySnapshots,
  listBackgroundHistory
} from '../job-history-service'
import { getBackgroundJobDetail, getJobDashboard, listJobs } from '../job-query-service'
import { PostgresJobEventStreamSource } from '../job-event-stream-service'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const suite = url ? describe.sequential : describe.skip
const prefix = `logical-${randomUUID()}`
const yesterday = new Date('2026-10-22T10:00:00Z')
const today = new Date('2026-10-23T10:00:00Z')

suite('stable archive task aggregation in PostgreSQL', () => {
  beforeEach(cleanup)
  afterAll(async () => {
    await cleanup()
    await db?.$disconnect()
  })

  it('keeps the archive business date and cursor across a next-day handoff without duplicate or missing rows', async () => {
    const a = await seed('z')
    const b = await seed('m')
    const c = await seed('a')
    const ordinary = `${prefix}-n`
    await db!.systemJob.create({
      data: {
        id: ordinary,
        type: 'SCAN',
        executionLane: 'BACKGROUND_WRITER',
        status: 'PENDING',
        triggerSource: 'MANUAL',
        createdAt: yesterday,
        message: prefix
      }
    })
    const query = { search: prefix, limit: 1, createdFrom: '2026-10-22T00:00:00Z', createdTo: '2026-10-23T00:00:00Z' }
    const first = await listBackgroundHistory(backgroundHistoryInputSchema.parse(query), db!)
    expect(first.items[0]?.archiveImportId).toBe(a)
    const cursor = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString())
    expect(cursor).toEqual({ createdAt: yesterday.toISOString(), id: a })
    await handoff(a)
    await handoff(b)
    const second = await listBackgroundHistory(
      backgroundHistoryInputSchema.parse({ ...query, cursor: first.nextCursor }),
      db!
    )
    const third = await listBackgroundHistory(
      backgroundHistoryInputSchema.parse({ ...query, cursor: second.nextCursor }),
      db!
    )
    const fourth = await listBackgroundHistory(
      backgroundHistoryInputSchema.parse({ ...query, cursor: third.nextCursor }),
      db!
    )
    expect(
      [...first.items, ...second.items, ...third.items, ...fourth.items].map((item) => item.archiveImportId ?? item.id)
    ).toEqual([a, ordinary, b, c])
    expect(fourth.nextCursor).toBeNull()
    const fresh = await listBackgroundHistory(backgroundHistoryInputSchema.parse({ ...query, limit: 100 }), db!)
    expect(fresh.items.map((item) => item.archiveImportId ?? item.id)).toEqual([a, ordinary, b, c])
    expect(fresh.items.every((item) => item.createdAt === yesterday.toISOString())).toBe(true)
    const snapshots = await getBackgroundHistorySnapshots({ ids: [`${a}-download`, `${b}-download`] }, db!)
    expect(snapshots.items.map((item) => item.id).sort()).toEqual([`${a}-publish`, `${b}-publish`].sort())
    expect(snapshots.items.every((item) => item.createdAt === yesterday.toISOString())).toBe(true)
  })

  it('aggregates list, dashboard, detail and SSE by the current stage without reporting handoff as completion', async () => {
    const a = await seed('one')
    const before = await getJobDashboard(db!)
    await handoff(a)
    const after = await getJobDashboard(db!)
    expect(after.counts.COMPLETED).toBe(before.counts.COMPLETED)
    expect(after.counts.PENDING).toBe(before.counts.PENDING)
    expect(after.lanes.map((lane) => lane.executionLane)).toEqual([
      'ARCHIVE_RESOLVE',
      'ARCHIVE_DOWNLOAD',
      'BACKGROUND_WRITER'
    ])
    const recent = after.recentJobs.filter((job) => job.archiveImportId === a)
    expect(recent).toHaveLength(1)
    expect(recent[0]).toMatchObject({
      id: `${a}-publish`,
      status: 'PENDING',
      progress: 95,
      createdAt: yesterday.toISOString()
    })
    const page = await listJobs({ limit: 100, types: ['ARCHIVE_IMPORT', 'ARCHIVE_DOWNLOAD', 'ARCHIVE_PUBLISH'] }, db!)
    expect(page.items.filter((job) => job.archiveImportId === a)).toHaveLength(1)
    const detail = await getBackgroundJobDetail(`${a}-download`, db!)
    expect(detail).toMatchObject({
      id: `${a}-publish`,
      archiveImportId: a,
      activeExecutionId: `${a}-publish`,
      status: 'PENDING'
    })
    const events = await new PostgresJobEventStreamSource(db!).readAfter('0', 200)
    expect(events.items.filter(({ job }) => job.archiveImportId === a).map(({ event }) => event.type)).toEqual([
      'job.queued'
    ])
  })
})

async function seed(label: string) {
  const id = `${prefix}-${label}`
  const jobId = `${id}-download`
  await db!.systemJob.create({
    data: {
      id: jobId,
      type: 'ARCHIVE_DOWNLOAD',
      executionLane: 'ARCHIVE_DOWNLOAD',
      status: 'PENDING',
      triggerSource: 'MANUAL',
      payload: { archiveImportId: id, defaultTagIds: [] },
      createdAt: yesterday,
      message: prefix
    }
  })
  await db!.archiveImport.create({
    data: {
      id,
      systemJobId: jobId,
      phase: 'DOWNLOAD',
      origin: 'MANUAL',
      providerKey: 'test',
      externalId: id,
      submittedUrl: 'https://example.test',
      canonicalUrl: `https://example.test/${id}`,
      locator: {},
      normalizedMetadata: {},
      rawMetadata: {},
      metadataHash: 'a'.repeat(64),
      creatorBucket: 'bucket',
      stagingPath: `.archive-staging/${id}`,
      totalItems: 1,
      createdAt: yesterday,
      executions: { create: { jobId, phase: 'DOWNLOAD' } }
    }
  })
  return id
}

async function handoff(id: string) {
  await db!.$transaction(async (tx) => {
    const jobId = `${id}-publish`
    await tx.systemJob.create({
      data: {
        id: jobId,
        type: 'ARCHIVE_PUBLISH',
        executionLane: 'BACKGROUND_WRITER',
        status: 'PENDING',
        triggerSource: 'MANUAL',
        payload: { archiveImportId: id, defaultTagIds: [] },
        createdAt: today,
        progress: 95,
        message: prefix,
        parentJobId: `${id}-download`
      }
    })
    await tx.archiveImportExecution.create({ data: { archiveImportId: id, jobId, phase: 'PUBLISH' } })
    await tx.archiveImport.update({ where: { id }, data: { systemJobId: jobId, phase: 'PUBLISH' } })
    await tx.systemJob.update({
      where: { id: `${id}-download` },
      data: { status: 'COMPLETED', result: { outcome: 'HANDOFF', successorJobId: jobId } }
    })
    await tx.systemJobEvent.create({
      data: { jobId: `${id}-download`, type: 'job.completed', level: 'INFO', attempt: 1, data: { outcome: 'HANDOFF' } }
    })
    await tx.systemJobEvent.create({ data: { jobId, type: 'job.queued', level: 'INFO', attempt: 0 } })
  })
}

async function cleanup() {
  if (!db) return
  await db.archiveImport.deleteMany({ where: { id: { startsWith: prefix } } })
  await db.systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
}
