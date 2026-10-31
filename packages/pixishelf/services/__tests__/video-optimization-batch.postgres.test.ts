// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createDatabaseClient } from '@pixishelf/db'

vi.mock('@/lib/prisma', async () => {
  const { createDatabaseClient } = await import('@pixishelf/db')
  return { prisma: createDatabaseClient({ datasourceUrl: process.env.PIXISHELF_TEST_DATABASE_URL }) }
})
import { prisma } from '@/lib/prisma'
import {
  listVideoStreamingOptimizationCandidatesInputSchema as listSchema,
  previewVideoStreamingOptimizationBatchInputSchema as previewSchema
} from '@/schemas/video-optimization.dto'
import {
  listVideoStreamingOptimizationCandidates,
  previewVideoStreamingOptimizationBatch,
  submitVideoStreamingOptimizationBatch
} from '../video-optimization-batch-service'
import { enqueueCentralVideoStreamingOptimization } from '../video-processing-central-service'
import { retryJobCommand } from '../background-task/job-command-service'
import { backgroundHistoryInputSchema, listBackgroundHistory } from '../background-task/job-history-service'
import { getBackgroundJobDetail } from '../background-task/job-query-service'

const database = createDatabaseClient({ datasourceUrl: process.env.PIXISHELF_TEST_DATABASE_URL })
const prefix = `mp4-batch-${randomUUID()}`
const pg = process.env.PIXISHELF_TEST_DATABASE_URL ? describe.sequential : describe.skip
const artworkIds: number[] = []
const artistIds: number[] = []
const tagIds: number[] = []
let jobSequence = 0

async function artwork(title: string, count = 1) {
  const row = await database.artwork.create({ data: { title: `${prefix}-${title}`, source: 'LOCAL_CREATED' } })
  artworkIds.push(row.id)
  await database.image.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      artworkId: row.id,
      path: `${prefix}/${row.id}/${index}.mp4`,
      mediaType: 'VIDEO' as const
    }))
  })
  const images = await database.image.findMany({ where: { artworkId: row.id }, orderBy: { id: 'asc' } })
  return { ...row, images }
}
async function job(
  image: { id: number; path: string },
  status: 'FAILED' | 'CANCELLED' | 'SKIPPED' | 'COMPLETED' | 'PAUSED' | 'RETRY_WAIT' = 'FAILED',
  extra = {}
) {
  return database.systemJob.create({
    data: {
      id: `${prefix}-${++jobSequence}`,
      type: 'VIDEO_STREAMING_OPTIMIZATION',
      definitionVersion: 1,
      requestedByUserId: prefix,
      status,
      executionLane: 'BACKGROUND_WRITER',
      payload: { imageId: image.id, relativePath: image.path, mode: 'REMUX_FASTSTART' },
      ...(status === 'SKIPPED' ? { skipReason: 'WINDOW_EXPIRED' as const, skippedAt: new Date() } : {}),
      ...extra
    }
  })
}
function filters(title: string, extra = {}) {
  return { title: `${prefix}-${title}`, ...extra }
}

pg('MP4 batch optimization PostgreSQL', () => {
  afterAll(async () => {
    await database.systemJob.deleteMany({ where: { requestedByUserId: prefix } })
    await database.image.deleteMany({ where: { artworkId: { in: artworkIds } } })
    await database.artwork.deleteMany({ where: { id: { in: artworkIds } } })
    await database.artist.deleteMany({ where: { id: { in: artistIds } } })
    await database.tag.deleteMany({ where: { id: { in: tagIds } } })
    await database.$disconnect()
    await prisma.$disconnect()
  })

  it('filters latest statuses before artwork aggregation and pagination, using legacy JSON targets too', async () => {
    const rows: Awaited<ReturnType<typeof artwork>>[] = []
    for (let index = 0; index < 23; index++) {
      const row = await artwork(`page-${index}`, 2)
      await job(row.images[0]!, 'FAILED', { createdAt: new Date('2026-01-01') })
      await job(row.images[0]!, 'COMPLETED', { createdAt: new Date('2026-02-01') })
      rows.push(row)
    }
    const legacy = await job(rows[0]!.images[1]!, 'FAILED', {
      definitionVersion: 0,
      payload: { imageId: 'bad-json' },
      legacyDisplay: {
        schemaVersion: 1,
        targetImageId: rows[0]!.images[1]!.id,
        targetPath: 'history.mp4',
        mode: 'REMUX_FASTSTART'
      }
    })
    await job(rows[1]!.images[1]!, 'PAUSED')
    await job(rows[2]!.images[1]!, 'RETRY_WAIT')
    await database.artwork.update({ where: { id: rows[3]!.id }, data: { deletedAt: new Date() } })
    await database.artwork.update({ where: { id: rows[4]!.id }, data: { archiveLifecycleState: 'TRASHED' } })
    const first = await listVideoStreamingOptimizationCandidates(listSchema.parse({ filters: filters('page-') }))
    const second = await listVideoStreamingOptimizationCandidates(
      listSchema.parse({ filters: filters('page-'), page: 2 })
    )
    expect(first.total).toBe(19)
    expect(first.items).toHaveLength(19)
    expect(second.items).toHaveLength(0)
    expect(first.items.map((row) => row.artworkId)).toEqual(
      [...first.items.map((row) => row.artworkId)].sort((a, b) => b - a)
    )
    const legacyCandidate = first.items.find((row) => row.artworkId === rows[0]!.id)!
    expect(legacyCandidate).toMatchObject({
      mp4Count: 2,
      matchingMp4Count: 1,
      actionableMp4Count: 1,
      statusCounts: { COMPLETED: 1, FAILED: 1 }
    })
    const preview = await previewVideoStreamingOptimizationBatch(
      previewSchema.parse({ filters: filters('page-'), selection: { mode: 'ALL_MATCHING' } })
    )
    expect(preview.mp4Count).toBe(19)
    expect(preview.targets.find((target) => target.imageId === rows[0]!.images[1]!.id)?.latestJobId).toBe(legacy.id)
    const completed = await listVideoStreamingOptimizationCandidates(
      listSchema.parse({ filters: filters('page-', { statuses: ['COMPLETED'] }), pageSize: 20 })
    )
    expect(completed.total).toBe(21)
    expect(completed.items).toHaveLength(20)
    const last = await listVideoStreamingOptimizationCandidates(
      listSchema.parse({ filters: filters('page-', { statuses: ['COMPLETED'] }), page: 2 })
    )
    expect(last.items).toHaveLength(1)
    const active = await listVideoStreamingOptimizationCandidates(
      listSchema.parse({ filters: filters('page-', { statuses: ['ACTIVE'] }) })
    )
    expect(active.total).toBe(2)
    expect(active.items.every((row) => row.actionableMp4Count === 0)).toBe(true)
  })

  it('uses title only, effective creator aliases, existing OR tag semantics, exclusions and source', async () => {
    const included = await artwork('filters')
    const excluded = await artwork('filters')
    const descriptionOnly = await artwork('unrelated')
    await database.artwork.update({ where: { id: descriptionOnly.id }, data: { description: included.title } })
    const creator = await database.artist.create({ data: { name: `${prefix}-creator` } })
    artistIds.push(creator.id)
    for (const row of [included, excluded]) {
      await database.artworkArtist.create({
        data: {
          artworkId: row.id,
          artistId: creator.id,
          evidence: { create: { evidenceKey: 'manual', provenance: 'MANUAL', present: true } }
        }
      })
    }
    const tags = await Promise.all(
      ['include', 'absent', 'exclude'].map((name) => database.tag.create({ data: { name: `${prefix}-${name}` } }))
    )
    tagIds.push(...tags.map((tag) => tag.id))
    await database.artworkTag.createMany({
      data: [
        { artworkId: included.id, tagId: tags[0]!.id },
        { artworkId: excluded.id, tagId: tags[0]!.id },
        { artworkId: excluded.id, tagId: tags[2]!.id }
      ]
    })
    const input = listSchema.parse({
      filters: filters('filters', {
        artistName: 'creator',
        tags: [tags[0]!.name, tags[1]!.name],
        excludeTags: [tags[2]!.name],
        sources: ['LOCAL_CREATED']
      })
    })
    const page = await listVideoStreamingOptimizationCandidates(input)
    expect(page.items).toEqual([
      expect.objectContaining({ artworkId: included.id, artists: [{ id: creator.id, name: creator.name }] })
    ])
    expect(
      (
        await listVideoStreamingOptimizationCandidates(
          listSchema.parse({ filters: { ...input.filters, artworkId: excluded.id } })
        )
      ).total
    ).toBe(0)
  })

  it('accepts exactly 1000 fixed MP4 targets, rejects 1001 without writing, and excludes active-only matches', async () => {
    const large = await artwork('limit', 1000)
    const input = previewSchema.parse({
      filters: { artworkId: large.id },
      selection: { mode: 'SELECTED', artworkIds: [large.id] }
    })
    const preview = await previewVideoStreamingOptimizationBatch(input)
    expect(preview.mp4Count).toBe(1000)
    expect(preview.artworkCount).toBe(1)
    await database.image.create({
      data: { artworkId: large.id, path: `${prefix}/${large.id}/1001.mp4`, mediaType: 'VIDEO' }
    })
    await expect(previewVideoStreamingOptimizationBatch(input)).rejects.toThrow('超过 1000')
    expect(
      await database.systemJob.count({
        where: { requestedByUserId: prefix, payload: { path: ['imageId'], equals: large.images[0]!.id } }
      })
    ).toBe(0)
    expect(
      (
        await previewVideoStreamingOptimizationBatch(
          previewSchema.parse({ ...input, selection: { mode: 'ALL_MATCHING', excludedArtworkIds: [large.id] } })
        )
      ).targets
    ).toHaveLength(0)
  })

  it('submits only preview targets, retains retry parent/acknowledgement, shrinks changed targets and aggregates partial outcomes', async () => {
    const row = await artwork('submission', 10)
    const fresh = row.images[0]!
    const failed = row.images[1]!
    const cancelled = row.images[2]!
    const skipped = row.images[3]!
    const completed = row.images[4]!
    const legacy = row.images[5]!
    const moved = row.images[6]!
    const activated = row.images[7]!
    const changed = row.images[8]!
    const removed = row.images[9]!
    const failedJob = await job(failed)
    const cancelledJob = await job(cancelled, 'CANCELLED')
    const skippedJob = await job(skipped, 'SKIPPED')
    await job(completed, 'COMPLETED')
    await job(legacy, 'FAILED', {
      definitionVersion: 0,
      payload: {},
      legacyDisplay: { schemaVersion: 1, targetImageId: legacy.id, targetPath: legacy.path, mode: 'REMUX_FASTSTART' }
    })
    const movedJob = await job(moved)
    const preview = await previewVideoStreamingOptimizationBatch(
      previewSchema.parse({
        filters: { artworkId: row.id, statuses: ['NONE', 'FAILED', 'CANCELLED', 'SKIPPED', 'COMPLETED'] },
        selection: { mode: 'SELECTED', artworkIds: [row.id] }
      })
    )
    expect(preview.successRedoCount).toBe(1)
    await database.image.update({ where: { id: moved.id }, data: { path: `${prefix}/moved.mp4` } })
    const active = await enqueueCentralVideoStreamingOptimization({ imageId: activated.id, requestedByUserId: prefix })
    await job(changed, 'COMPLETED')
    await database.image.delete({ where: { id: removed.id } })
    const extra = await database.image.create({
      data: { artworkId: row.id, path: `${prefix}/late.mp4`, mediaType: 'VIDEO' }
    })
    const result = await submitVideoStreamingOptimizationBatch(
      { targets: [...preview.targets, preview.targets.find((target) => target.imageId === fresh.id)!] },
      prefix
    )
    expect(result).toMatchObject({ submitted: 5, reused: 1, skipped: 5, failed: 0 })
    expect(result.items.find((item) => item.imageId === activated.id)).toMatchObject({
      outcome: 'REUSED',
      jobId: active.jobId
    })
    for (const parent of [failedJob, cancelledJob, skippedJob]) {
      expect(await database.systemJob.findFirst({ where: { parentJobId: parent.id } })).toMatchObject({
        triggerSource: 'RETRY',
        status: 'PENDING'
      })
    }
    expect(await database.systemJobFailureAcknowledgement.findUnique({ where: { jobId: failedJob.id } })).toMatchObject(
      { source: 'RETRY' }
    )
    expect(await database.systemJobFailureAcknowledgement.findUnique({ where: { jobId: movedJob.id } })).toBeNull()
    expect(
      await database.systemJob.count({
        where: { type: 'VIDEO_STREAMING_OPTIMIZATION', payload: { path: ['imageId'], equals: extra.id } }
      })
    ).toBe(0)
    const submitted = result.items.find((item) => item.imageId === fresh.id)!
    await database.systemJob.update({ where: { id: submitted.jobId }, data: { status: 'COMPLETED' } })
    expect(
      (
        await submitVideoStreamingOptimizationBatch(
          { targets: [preview.targets.find((target) => target.imageId === fresh.id)!] },
          prefix
        )
      ).items[0]!.outcome
    ).toBe('SKIPPED')
  })

  it('serializes ordinary enqueue, batch enqueue and generic retry on the same active media target', async () => {
    const row = await artwork('race')
    const failed = await job(row.images[0]!)
    const preview = await previewVideoStreamingOptimizationBatch(
      previewSchema.parse({ filters: { artworkId: row.id }, selection: { mode: 'SELECTED', artworkIds: [row.id] } })
    )
    const [ordinary, retry, batch] = await Promise.all([
      enqueueCentralVideoStreamingOptimization({ imageId: row.images[0]!.id, requestedByUserId: prefix }),
      retryJobCommand({ jobId: failed.id, requestedByUserId: prefix }, database),
      submitVideoStreamingOptimizationBatch({ targets: preview.targets }, prefix)
    ])
    expect(ordinary.jobId).toBe(retry.id)
    expect(batch.items[0]!.jobId).toBe(retry.id)
    expect(
      await database.systemJob.count({
        where: { status: 'PENDING', payload: { path: ['imageId'], equals: row.images[0]!.id } }
      })
    ).toBe(1)
    const persisted = await database.systemJob.findUniqueOrThrow({ where: { id: retry.id } })
    const acknowledgement = await database.systemJobFailureAcknowledgement.findUnique({ where: { jobId: failed.id } })
    expect(Boolean(acknowledgement)).toBe(persisted.triggerSource === 'RETRY')
  })

  it('scopes history by current media ownership before paging and exposes only a safe current detail target', async () => {
    const row = await artwork('history')
    const other = await artwork('history-other')
    for (let index = 0; index < 5; index++) await job(row.images[0]!, 'COMPLETED', { message: prefix })
    const failed = await job(row.images[0]!, 'FAILED', { message: prefix })
    await job(other.images[0]!, 'FAILED', { message: prefix })
    const first = await listBackgroundHistory(
      backgroundHistoryInputSchema.parse({ artworkId: row.id, search: prefix, limit: 2 }),
      database
    )
    const second = await listBackgroundHistory(
      backgroundHistoryInputSchema.parse({ artworkId: row.id, search: prefix, limit: 2, cursor: first.nextCursor }),
      database
    )
    expect(first.items).toHaveLength(2)
    expect(second.items).toHaveLength(2)
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(4)
    expect(first.items[0]!).not.toHaveProperty('payload')
    expect(first.items[0]!).not.toHaveProperty('result')
    const detail = await getBackgroundJobDetail(failed.id, database)
    expect(detail?.videoOptimizationTarget).toEqual({
      imageId: row.images[0]!.id,
      artworkId: row.id,
      title: row.title,
      filename: '0.mp4'
    })
    const onlyFailed = await listBackgroundHistory(
      backgroundHistoryInputSchema.parse({ artworkId: row.id, statuses: ['FAILED'], search: prefix }),
      database
    )
    expect(onlyFailed.items.map((item) => item.id)).toEqual([failed.id])
    await database.image.update({ where: { id: row.images[0]!.id }, data: { artworkId: other.id } })
    expect(
      (await listBackgroundHistory(backgroundHistoryInputSchema.parse({ artworkId: row.id }), database)).items
    ).toHaveLength(0)
    expect(
      (await listBackgroundHistory(backgroundHistoryInputSchema.parse({ artworkId: other.id }), database)).items
    ).toHaveLength(7)
  })
})
