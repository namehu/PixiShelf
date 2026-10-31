// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@pixishelf/db'
import { afterAll, describe, expect, it } from 'vitest'
import { enqueueJob, retryJobCommand, cancelJobCommand } from '../job-command-service'
const url =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
afterAll(() => db?.$disconnect())
describe.skipIf(!db)('playback queue concurrency', () => {
  it('deduplicates concurrent enqueue and retry while retaining the original media identity', async () => {
    const artwork = await db!.artwork.create({ data: { title: `playback-${randomUUID()}` } })
    const image = await db!.image.create({ data: { artworkId: artwork.id, path: 'test.mp4', mediaType: 'UNKNOWN' } })
    const request = {
      type: 'VIDEO_PLAYBACK_GENERATION' as const,
      triggerSource: 'MANUAL' as const,
      requestedByUserId: 'fixture-admin',
      payload: { imageId: image.id, relativePath: 'test.mp4' },
      priority: 10,
      maxAttempts: 1
    }
    try {
      const [a, b] = await Promise.all([enqueueJob(request, db!), enqueueJob(request, db!)])
      expect(a.id).toBe(b.id)
      expect(a.executionLane).toBe('BACKGROUND_WRITER')
      await cancelJobCommand({ jobId: a.id }, db!)
      const [c, d] = await Promise.all([retryJobCommand({ jobId: a.id }, db!), retryJobCommand({ jobId: a.id }, db!)])
      expect(c.id).toBe(d.id)
      expect(c.id).not.toBe(a.id)
      expect(await db!.image.findUnique({ where: { id: image.id } })).toMatchObject({
        path: 'test.mp4',
        artworkId: artwork.id
      })
      await cancelJobCommand({ jobId: c.id }, db!)
      await db!.image.update({ where: { id: image.id }, data: { path: 'moved.mp4' } })
      await expect(retryJobCommand({ jobId: c.id }, db!)).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
    } finally {
      await db!.systemJob.deleteMany({
        where: { type: 'VIDEO_PLAYBACK_GENERATION', payload: { path: ['imageId'], equals: image.id } }
      })
      await db!.artwork.delete({ where: { id: artwork.id } })
    }
  })
})
