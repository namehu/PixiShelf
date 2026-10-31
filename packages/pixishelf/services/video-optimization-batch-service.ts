import { Prisma } from '@pixishelf/db'
import { ACTIVE_JOB_STATUSES } from '@pixishelf/job-contracts'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  listVideoStreamingOptimizationCandidatesInputSchema,
  previewVideoStreamingOptimizationBatchInputSchema,
  submitVideoStreamingOptimizationBatchInputSchema,
  type VideoOptimizationStatus
} from '@/schemas/video-optimization.dto'
import type {
  VideoOptimizationBatchItem,
  VideoOptimizationBatchPreview,
  VideoOptimizationBatchResult,
  VideoOptimizationCandidate,
  VideoOptimizationCandidatePage
} from '@/types/video-optimization'
import { enqueueJob, retryJobCommand } from './background-task/job-command-service'
import { BackgroundTaskError } from './background-task/background-task-error'
import { lockActiveVideoStreamingOptimization } from './video-streaming-optimization-lock'

type QueryClient = Pick<Prisma.TransactionClient, '$queryRaw'>
type Filters = z.output<typeof listVideoStreamingOptimizationCandidatesInputSchema>['filters']

function matchingMediaQuery(filters: Filters, artworkIds?: number[], excludedArtworkIds?: number[]) {
  const clauses = [Prisma.sql`a."deletedAt" IS NULL`, Prisma.sql`a."archiveLifecycleState" = 'ACTIVE'`]
  if (filters.artworkId) clauses.push(Prisma.sql`a.id = ${filters.artworkId}`)
  if (filters.title) clauses.push(Prisma.sql`a.title ILIKE ${`%${filters.title}%`}`)
  if (filters.artistName) {
    const needle = `%${filters.artistName}%`
    clauses.push(Prisma.sql`EXISTS (
      SELECT 1 FROM effective_artwork_creators c JOIN "Artist" ca ON ca.id = c."artistId"
      WHERE c."artworkId" = a.id AND (
        ca.name ILIKE ${needle}
        OR EXISTS (SELECT 1 FROM artist_external_refs er WHERE er."artistId" = ca.id
          AND er."providerKey" = 'pixiv' AND er."externalId" ~ '^[1-9][0-9]*$' AND er."externalId" ILIKE ${needle})
        OR EXISTS (SELECT 1 FROM artist_source_tag_mappings sm WHERE sm."artistId" = ca.id AND sm."sourceName" ILIKE ${needle})
      ))`)
  }
  if (filters.tags.length) {
    clauses.push(Prisma.sql`EXISTS (
    SELECT 1 FROM "ArtworkTag" at JOIN "Tag" t ON t.id = at."tagId"
    WHERE at."artworkId" = a.id AND t.name IN (${Prisma.join(filters.tags)})
  )`)
  }
  if (filters.excludeTags.length) {
    clauses.push(Prisma.sql`NOT EXISTS (
    SELECT 1 FROM "ArtworkTag" at JOIN "Tag" t ON t.id = at."tagId"
    WHERE at."artworkId" = a.id AND t.name IN (${Prisma.join(filters.excludeTags)})
  )`)
  }
  if (filters.sources.length) clauses.push(Prisma.sql`a.source::text IN (${Prisma.join(filters.sources)})`)
  if (artworkIds) clauses.push(Prisma.sql`a.id IN (${Prisma.join([...new Set(artworkIds)])})`)
  if (excludedArtworkIds?.length) {
    clauses.push(Prisma.sql`a.id NOT IN (${Prisma.join([...new Set(excludedArtworkIds)])})`)
  }
  return Prisma.sql`WITH media AS (
    SELECT a.id AS "artworkId", a.title, a.source, i.id AS "imageId", latest.id AS "latestJobId",
      CASE WHEN latest.id IS NULL THEN 'NONE'
        WHEN latest.status::text IN (${Prisma.join([...ACTIVE_JOB_STATUSES])}) THEN 'ACTIVE'
        ELSE latest.status::text END AS status
    FROM "Artwork" a JOIN "Image" i ON i."artworkId" = a.id
    LEFT JOIN LATERAL (
      SELECT recent.id, recent.status FROM (
        (SELECT j.id, j.status, j."createdAt" FROM system_jobs j
          WHERE j.type = 'VIDEO_STREAMING_OPTIMIZATION' AND j."definitionVersion" > 0
            AND j.payload #> '{imageId}' = to_jsonb(i.id)
          ORDER BY j."createdAt" DESC, j.id DESC LIMIT 1)
        UNION ALL
        (SELECT j.id, j.status, j."createdAt" FROM system_jobs j
          WHERE j.type = 'VIDEO_STREAMING_OPTIMIZATION' AND j."definitionVersion" = 0
            AND j."legacyDisplay" #> '{targetImageId}' = to_jsonb(i.id)
          ORDER BY j."createdAt" DESC, j.id DESC LIMIT 1)
      ) recent ORDER BY recent."createdAt" DESC, recent.id DESC LIMIT 1
    ) latest ON true
    WHERE ${Prisma.join(clauses, ' AND ')} AND lower(i.path) LIKE '%.mp4'
  )`
}

export async function listVideoStreamingOptimizationCandidates(
  input: z.output<typeof listVideoStreamingOptimizationCandidatesInputSchema>,
  client: QueryClient = prisma
): Promise<VideoOptimizationCandidatePage> {
  const { filters, page, pageSize } = input
  const base = matchingMediaQuery(filters)
  const matches = Prisma.sql`status IN (${Prisma.join(filters.statuses)})`
  const [items, totals] = await Promise.all([
    client.$queryRaw<VideoOptimizationCandidate[]>(Prisma.sql`${base}
      SELECT "artworkId", title, source, count(*)::int AS "mp4Count",
        count(*) FILTER (WHERE ${matches})::int AS "matchingMp4Count",
        count(*) FILTER (WHERE ${matches} AND status <> 'ACTIVE')::int AS "actionableMp4Count",
        jsonb_build_object(
          'NONE', count(*) FILTER (WHERE status = 'NONE'),
          'ACTIVE', count(*) FILTER (WHERE status = 'ACTIVE'),
          'COMPLETED', count(*) FILTER (WHERE status = 'COMPLETED'),
          'FAILED', count(*) FILTER (WHERE status = 'FAILED'),
          'CANCELLED', count(*) FILTER (WHERE status = 'CANCELLED'),
          'SKIPPED', count(*) FILTER (WHERE status = 'SKIPPED')
        ) AS "statusCounts",
        (SELECT coalesce(jsonb_agg(creators ORDER BY creators.name, creators.id), '[]'::jsonb)
          FROM (SELECT DISTINCT ca.id, ca.name FROM effective_artwork_creators c
            JOIN "Artist" ca ON ca.id = c."artistId" WHERE c."artworkId" = media."artworkId") creators) AS artists
      FROM media GROUP BY "artworkId", title, source
      HAVING count(*) FILTER (WHERE ${matches}) > 0
      ORDER BY "artworkId" DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    client.$queryRaw<Array<{ total: number }>>(Prisma.sql`${base}
      SELECT count(DISTINCT "artworkId")::int AS total FROM media WHERE ${matches}`)
  ])
  return { items, total: totals[0]!.total, page, pageSize }
}

export async function previewVideoStreamingOptimizationBatch(
  input: z.output<typeof previewVideoStreamingOptimizationBatchInputSchema>,
  client: QueryClient = prisma
): Promise<VideoOptimizationBatchPreview> {
  const { filters, selection } = input
  const base = matchingMediaQuery(
    filters,
    selection.mode === 'SELECTED' ? selection.artworkIds : undefined,
    selection.mode === 'ALL_MATCHING' ? selection.excludedArtworkIds : undefined
  )
  const targets = await client.$queryRaw<VideoOptimizationBatchPreview['targets']>(Prisma.sql`${base}
    SELECT "imageId", "artworkId", "latestJobId", status FROM media
    WHERE status IN (${Prisma.join(filters.statuses)}) AND status <> 'ACTIVE'
    ORDER BY "artworkId" DESC, "imageId" DESC LIMIT 1001`)
  if (targets.length > 1000) {
    throw new BackgroundTaskError('PRECONDITION_FAILED', '本次匹配超过 1000 个 MP4，请缩小筛选范围后重新预览。')
  }
  return {
    targets,
    artworkCount: new Set(targets.map((target) => target.artworkId)).size,
    mp4Count: targets.length,
    successRedoCount: targets.filter((target) => target.status === 'COMPLETED').length
  }
}

export async function submitVideoStreamingOptimizationBatch(
  input: z.output<typeof submitVideoStreamingOptimizationBatchInputSchema>,
  requestedByUserId: string
): Promise<VideoOptimizationBatchResult> {
  const items: VideoOptimizationBatchItem[] = []
  const seen = new Set<number>()
  for (const target of input.targets) {
    const identity = { imageId: target.imageId, artworkId: target.artworkId }
    if (seen.has(target.imageId)) {
      items.push({ ...identity, outcome: 'SKIPPED', reason: '重复的视频目标' })
      continue
    }
    seen.add(target.imageId)
    try {
      const item = await prisma.$transaction(async (rawTransaction): Promise<VideoOptimizationBatchItem> => {
        const transaction = rawTransaction as unknown as Prisma.TransactionClient
        const image = await transaction.image.findFirst({
          where: {
            id: target.imageId,
            artworkId: target.artworkId,
            artwork: { is: { deletedAt: null, archiveLifecycleState: 'ACTIVE' } }
          },
          select: { id: true, path: true }
        })
        if (!image || !/\.mp4$/i.test(image.path)) {
          return { ...identity, outcome: 'SKIPPED', reason: '视频已失效或不再属于有效作品' }
        }
        const relativePath = image.path.replace(/^[/\\]+/, '')
        const active = await lockActiveVideoStreamingOptimization(transaction, image.id, relativePath)
        if (active) return { ...identity, outcome: 'REUSED', jobId: active.id }
        const latest = await transaction.systemJob.findFirst({
          where: {
            type: 'VIDEO_STREAMING_OPTIMIZATION',
            OR: [
              { definitionVersion: { gt: 0 }, payload: { path: ['imageId'], equals: image.id } },
              { definitionVersion: 0, legacyDisplay: { path: ['targetImageId'], equals: image.id } }
            ]
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true, status: true }
        })
        const status: VideoOptimizationStatus = !latest
          ? 'NONE'
          : ACTIVE_JOB_STATUSES.has(latest.status)
            ? 'ACTIVE'
            : (latest.status as VideoOptimizationStatus)
        if ((latest?.id ?? null) !== target.latestJobId || status !== target.status) {
          return { ...identity, outcome: 'SKIPPED', reason: '任务状态在预览后发生变化，请重新预览' }
        }
        const commandClient = {
          $transaction: <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => operation(transaction)
        }
        const job =
          latest && ['FAILED', 'CANCELLED', 'SKIPPED'].includes(status)
            ? await retryJobCommand({ jobId: latest.id, requestedByUserId }, commandClient)
            : await enqueueJob(
                {
                  type: 'VIDEO_STREAMING_OPTIMIZATION',
                  triggerSource: 'MANUAL',
                  requestedByUserId,
                  priority: 10,
                  maxAttempts: 3,
                  payload: { imageId: image.id, relativePath, mode: 'REMUX_FASTSTART' }
                },
                commandClient
              )
        return { ...identity, outcome: 'SUBMITTED', jobId: job.id }
      })
      items.push(item)
    } catch (error) {
      items.push({
        ...identity,
        outcome: error instanceof BackgroundTaskError ? 'SKIPPED' : 'FAILED',
        reason: error instanceof BackgroundTaskError ? error.message : '入队失败，请稍后重试'
      })
    }
  }
  return {
    submitted: items.filter((item) => item.outcome === 'SUBMITTED').length,
    reused: items.filter((item) => item.outcome === 'REUSED').length,
    skipped: items.filter((item) => item.outcome === 'SKIPPED').length,
    failed: items.filter((item) => item.outcome === 'FAILED').length,
    items
  }
}
