// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createDatabaseClient } from '@pixishelf/db'

vi.mock('@/lib/prisma', async () => {
  const { createDatabaseClient } = await import('@pixishelf/db')
  return { prisma: createDatabaseClient({ datasourceUrl: process.env.PIXISHELF_TEST_DATABASE_URL }) }
})
import { prisma } from '@/lib/prisma'
import { latestMediaJobs } from '../media-job-query'
import { getLatestVideoKeyframeJobsByImageIds } from '@/services/video-keyframe-queue'
import { enqueueJob, retryJobCommand } from '../job-command-service'

const database = createDatabaseClient({ datasourceUrl: process.env.PIXISHELF_TEST_DATABASE_URL })
const prefix = `retirement-${randomUUID()}`
const pg = process.env.PIXISHELF_TEST_DATABASE_URL ? describe : describe.skip

pg('media task payload read model', () => {
  afterAll(async () => {
    await database.systemJob.deleteMany({ where: { requestedByUserId: prefix } })
    await database.image.deleteMany({ where: { artwork: { title: prefix } } })
    await database.artwork.deleteMany({ where: { title: prefix } })
    await database.$disconnect()
    await prisma.$disconnect()
  })
  async function seed(suffix: string, data: Record<string, unknown> = {}) {
    return database.systemJob.create({
      data: {
        id: `${prefix}-${suffix}`,
        requestedByUserId: prefix,
        type: 'VIDEO_KEYFRAME_GENERATION',
        status: 'COMPLETED',
        definitionVersion: 1,
        payload: { imageId: 2147000001, relativePath: 'fixture.mp4', mode: 'MANUAL_FORCE' },
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        ...data
      }
    })
  }
  it('keeps active-first keyframe ordering and projects payload instead of obsolete columns', async () => {
    await seed('completed', { createdAt: new Date('2026-02-01'), updatedAt: new Date('2026-02-01') })
    const active = await seed('paused', { status: 'PAUSED' })
    const rows = await latestMediaJobs('VIDEO_KEYFRAME_GENERATION', [2147000001])
    expect(rows).toEqual([
      expect.objectContaining({ id: active.id, targetImageId: 2147000001, targetPath: 'fixture.mp4' })
    ])
  })
  it('merges legacy and modern streaming history with deterministic ties, without casting malformed JSON', async () => {
    const type = 'VIDEO_STREAMING_OPTIMIZATION'
    await seed('bad-json', { type, payload: { imageId: 'broken' } })
    await seed('legacy', {
      type,
      definitionVersion: 0,
      triggerSource: 'LEGACY',
      payload: {},
      legacyDisplay: { schemaVersion: 1, targetImageId: 2147000002, targetPath: 'legacy.mp4', mode: 'REMUX_FASTSTART' }
    })
    await seed('a-modern', {
      type,
      payload: { imageId: 2147000002, relativePath: 'modern.mp4', mode: 'REMUX_FASTSTART' },
      createdAt: new Date('2026-03-01')
    })
    const latest = await seed('z-modern', {
      type,
      payload: { imageId: 2147000002, relativePath: 'modern.mp4', mode: 'REMUX_FASTSTART' },
      createdAt: new Date('2026-03-01')
    })
    const rows = await latestMediaJobs(type, [2147000002, 2147000003])
    expect(rows).toEqual([expect.objectContaining({ id: latest.id, targetImageId: 2147000002 })])
  })
  it('preserves historical targets through the public keyframe queue projection', async () => {
    const legacy = await seed('legacy-keyframe', {
      definitionVersion: 0,
      triggerSource: 'LEGACY',
      payload: {},
      legacyDisplay: { schemaVersion: 1, targetImageId: 2147000005, targetPath: '历史.mp4', mode: 'MANUAL_FORCE' }
    })
    expect(await getLatestVideoKeyframeJobsByImageIds([2147000005])).toEqual([
      expect.objectContaining({
        id: legacy.id,
        targetImageId: 2147000005,
        targetPath: '历史.mp4',
        mode: 'MANUAL_FORCE',
        queuePosition: null
      })
    ])
  })
  it('keeps initial enqueue and retry targets in payload after dropping legacy columns', async () => {
    const artwork = await database.artwork.create({ data: { title: prefix } })
    const image = await database.image.create({
      data: { artworkId: artwork.id, path: 'rollback.mp4', mediaType: 'VIDEO' }
    })
    const job = await enqueueJob(
      {
        type: 'VIDEO_STREAMING_OPTIMIZATION',
        triggerSource: 'MANUAL',
        priority: 10,
        requestedByUserId: prefix,
        payload: { imageId: image.id, relativePath: 'rollback.mp4', mode: 'REMUX_FASTSTART' }
      },
      database
    )
    const initial = await database.systemJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(initial.payload).toMatchObject({
      imageId: image.id,
      relativePath: 'rollback.mp4',
      mode: 'REMUX_FASTSTART'
    })
    expect(initial).not.toHaveProperty('targetImageId')
    await database.systemJob.update({ where: { id: job.id }, data: { status: 'FAILED' } })
    const retried = await retryJobCommand({ jobId: job.id, requestedByUserId: prefix }, database)
    expect((await database.systemJob.findUniqueOrThrow({ where: { id: retried.id } })).payload).toMatchObject({
      imageId: image.id,
      relativePath: 'rollback.mp4',
      mode: 'REMUX_FASTSTART'
    })
  })
})
