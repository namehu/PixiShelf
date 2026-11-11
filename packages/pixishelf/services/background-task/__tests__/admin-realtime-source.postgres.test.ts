// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@pixishelf/db'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createArchiveIntakeSubmission,
  listArchiveIntakeItems,
  setArchiveIntakePaused
} from '../../archive-intake/archive-intake-service'
import { PostgresAdminRealtimeSource } from '../admin-realtime-source'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const prefix = `sse-${randomUUID()}`

describe.skipIf(!db)('admin realtime with actual intake transactions', () => {
  afterAll(async () => {
    if (!db) return
    await db.archiveIntakeSubmission.deleteMany({ where: { requestedByUserId: prefix } })
    await db.systemJob.deleteMany({ where: { requestedByUserId: prefix } })
    await db.$disconnect()
  })

  it('observes committed batches, queue control and natural expiry without a Worker or polling summaries', async () => {
    const database = db!
    const source = new PostgresAdminRealtimeSource(database)
    const now = new Date()
    await source.readChanges(now)
    const token = randomUUID().replaceAll('-', '')
    const base = Math.floor(Date.now() / 1000)
    const submission = await createArchiveIntakeSubmission(
      {
        idempotencyKey: prefix,
        urls: Array.from({ length: 100 }, (_, index) => `https://e-hentai.org/g/${base + index}/${token}/`),
        downloadMode: 'MANUAL',
        quality: 'DISPLAY'
      },
      prefix,
      { database }
    )
    expect(submission.acceptedCount).toBe(100)
    expect(new Set(submission.items.map((item) => item.queueOrder)).size).toBe(100)
    expect(await source.readChanges(now)).toContain('archiveInbox')
    expect(await source.readChanges(now)).toEqual([])

    const control = await database.archiveResolveQueueControl.findUnique({ where: { id: 'archive-resolve' } })
    await setArchiveIntakePaused(!control?.paused, prefix, { database })
    expect(await source.readChanges(now)).toEqual(['archiveInbox'])
    await setArchiveIntakePaused(control?.paused ?? false, prefix, { database })
    await source.readChanges(now)

    const item = submission.items[0]!
    await database.archiveIntakeItem.update({
      where: { id: item.id },
      data: {
        status: 'READY',
        expiresAt: new Date(now.getTime() + 1000)
      }
    })
    expect(await source.readChanges(now)).toEqual(['archiveInbox'])
    const expiredAt = new Date(now.getTime() + 1001)
    expect(await source.readChanges(expiredAt)).toEqual(['archiveInbox'])
    expect(await source.readChanges(expiredAt)).toEqual([])
    const list = await listArchiveIntakeItems({ itemId: item.id }, { database, now: () => expiredAt })
    expect(list.items[0]?.status).toBe('STALE')

    const rollback = new Error('fixture rollback')
    await expect(
      database.$transaction(async (tx) => {
        await tx.archiveIntakeItem.update({ where: { id: item.id }, data: { status: 'FAILED' } })
        throw rollback
      })
    ).rejects.toBe(rollback)
    expect(await source.readChanges(expiredAt)).toEqual([])
    await database.archiveIntakeItem.deleteMany({ where: { submissionId: submission.id } })
    expect(await source.readChanges(expiredAt)).toEqual(['archiveInbox'])
  })
})
