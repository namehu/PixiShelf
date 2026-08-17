import * as fs from 'node:fs/promises'
import { videoKeyframeDiscoveryPayloadSchema } from '@pixishelf/job-contracts'
import { resolveKeyframePath, resolveSourceFile } from './paths.js'
import { matchesVideoKeyframeFilter, type VideoKeyframeFilter } from './policy.js'
import type {
  VideoKeyframeDatabase,
  VideoKeyframeDiscoveryBaseResult,
  VideoKeyframeDiscoveryResult,
  VideoKeyframePreviewCandidate,
  VideoKeyframeProgress,
  VideoKeyframeRuntimeConfig
} from './types.js'

const DISCOVERY_PAGE_SIZE = 200
const PREVIEW_CANDIDATE_LIMIT = 1_000
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v', '.wmv', '.flv']

export type VideoKeyframeDiscoveryPayload = ReturnType<typeof videoKeyframeDiscoveryPayloadSchema.parse>

export interface VideoKeyframeChildRequest {
  type: 'VIDEO_KEYFRAME_GENERATION'
  payload: { imageId: number; relativePath: string; mode: 'AUTO_INCREMENTAL' | 'MANUAL_INCREMENTAL' | 'MANUAL_FORCE' }
  queuePriority: number
  idempotencyKey: string
}

export async function discoverVideoKeyframes(input: {
  jobId: string
  payload: VideoKeyframeDiscoveryPayload
  database: VideoKeyframeDatabase
  config: VideoKeyframeRuntimeConfig
  signal: AbortSignal
  progress(update: VideoKeyframeProgress): Promise<void>
  enqueueChild(request: VideoKeyframeChildRequest): Promise<{ id: string; created: boolean }>
}): Promise<VideoKeyframeDiscoveryResult> {
  const result: VideoKeyframeDiscoveryBaseResult = {
    discovered: 0,
    matched: 0,
    enqueued: 0,
    reused: 0,
    filtered: 0,
    current: 0,
    inaccessible: 0,
    failedSamples: []
  }
  const previewCandidates: VideoKeyframePreviewCandidate[] = []
  let previewTruncated = false
  const requestedIds = input.payload.imageIds ? [...new Set(input.payload.imageIds)].sort((a, b) => a - b) : undefined
  let cursor = input.payload.afterImageId ?? 0
  let exhausted = false
  await input.progress({ percentage: 1, stage: 'DISCOVERING', message: '正在发现需要生成代表帧的视频...' })

  while (!exhausted) {
    throwIfAborted(input.signal)
    const page = await input.database.image.findMany({
      where: {
        ...(requestedIds ? { id: { in: requestedIds, gt: cursor } } : { id: { gt: cursor } }),
        OR: [
          { mediaType: 'VIDEO' },
          ...VIDEO_EXTENSIONS.map((extension) => ({ path: { endsWith: extension, mode: 'insensitive' as const } }))
        ]
      },
      orderBy: { id: 'asc' },
      take: DISCOVERY_PAGE_SIZE,
      select: {
        id: true,
        path: true,
        videoMetadata: { select: { duration: true } },
        keyframeSets: {
          where: { status: 'PUBLISHED' },
          orderBy: { publishedAt: 'desc' },
          take: 1,
          select: {
            sourceSize: true,
            sourceMtimeMs: true,
            publishedCount: true,
            frames: {
              where: { selectedOrder: { not: null }, status: 'COMPLETED', path: { not: null } },
              select: { path: true }
            }
          }
        }
      }
    })
    exhausted = page.length < DISCOVERY_PAGE_SIZE || Boolean(requestedIds && page.length === 0)
    if (page.length === 0) break
    cursor = page.at(-1)!.id
    result.discovered += page.length

    const failures = await input.database.systemJob.groupBy({
      by: ['targetImageId'],
      where: {
        type: 'VIDEO_KEYFRAME_GENERATION',
        status: 'FAILED',
        targetImageId: { in: page.map((image) => image.id) }
      }
    })
    const failedImageIds = new Set(failures.flatMap((job) => (job.targetImageId ? [job.targetImageId] : [])))

    for (const image of page) {
      throwIfAborted(input.signal)
      let shouldEnqueue = false
      try {
        const source = await resolveSourceFile(input.config.scanRoot, image.path)
        const published = image.keyframeSets[0]
        const state = await resolveDiscoveryState({
          published,
          failed: failedImageIds.has(image.id),
          sourceSize: BigInt(source.stat.size),
          sourceMtimeMs: BigInt(Math.round(source.stat.mtimeMs)),
          keyframeStorageRoot: input.config.keyframeStorageRoot
        })
        if (state === 'CURRENT' && !input.payload.force) {
          result.current += 1
          continue
        }
        if (
          !matchesFilter(
            image.path,
            image.videoMetadata?.duration ?? null,
            state,
            input.payload.filter,
            input.payload.force
          )
        ) {
          result.filtered += 1
          continue
        }
        result.matched += 1
        if (input.payload.previewOnly) {
          if (previewCandidates.length < PREVIEW_CANDIDATE_LIMIT) {
            previewCandidates.push({
              imageId: image.id,
              path: image.path,
              duration: image.videoMetadata?.duration ?? null,
              status: state,
              publishedCount: published?.publishedCount ?? 0
            })
          } else {
            previewTruncated = true
          }
        }
        shouldEnqueue = !input.payload.previewOnly
      } catch (error) {
        result.inaccessible += 1
        if (result.failedSamples.length < 20) {
          result.failedSamples.push({
            imageId: image.id,
            path: image.path,
            error: error instanceof Error ? error.message : 'Unknown discovery error'
          })
        }
      }
      if (!shouldEnqueue) continue
      // Queue/fence failures are not per-media accessibility failures. Let the dispatcher retry the
      // discovery attempt; the stable idempotency key makes already-created children safe to replay.
      const child = await input.enqueueChild({
        type: 'VIDEO_KEYFRAME_GENERATION',
        payload: {
          imageId: image.id,
          relativePath: image.path.replace(/^[/\\]+/, ''),
          mode:
            input.payload.trigger === 'schedule'
              ? 'AUTO_INCREMENTAL'
              : input.payload.force
                ? 'MANUAL_FORCE'
                : 'MANUAL_INCREMENTAL'
        },
        queuePriority: 100,
        idempotencyKey: `keyframe:${input.jobId}:image:${image.id}:v1`
      })
      if (child.created) result.enqueued += 1
      else result.reused += 1
    }

    const denominator = requestedIds?.length
    const percentage = denominator
      ? Math.min(99, Math.max(1, Math.floor((result.discovered / denominator) * 100)))
      : Math.min(95, 5 + Math.floor(result.discovered / DISCOVERY_PAGE_SIZE) * 5)
    await input.progress({
      percentage,
      stage: 'DISCOVERING',
      message: input.payload.previewOnly
        ? `已检查 ${result.discovered} 个视频，匹配 ${result.matched} 个`
        : `已检查 ${result.discovered} 个视频，创建 ${result.enqueued} 个生成任务`,
      data: { matched: result.matched, enqueued: result.enqueued, inaccessible: result.inaccessible }
    })
  }
  if (!input.payload.previewOnly) return result
  return {
    ...result,
    previewOnly: true,
    previewTruncated,
    candidates: previewCandidates,
    force: input.payload.force,
    filter: {
      minDuration: input.payload.filter.minDuration,
      maxDuration: input.payload.filter.maxDuration,
      includePaths: [...input.payload.filter.includePaths],
      excludePaths: [...input.payload.filter.excludePaths],
      statuses: [...input.payload.filter.statuses]
    }
  }
}

async function resolveDiscoveryState(input: {
  published:
    | {
        sourceSize: bigint
        sourceMtimeMs: bigint
        publishedCount: number
        frames: Array<{ path: string | null }>
      }
    | undefined
  failed: boolean
  sourceSize: bigint
  sourceMtimeMs: bigint
  keyframeStorageRoot: string
}): Promise<'MISSING' | 'STALE' | 'FAILED' | 'CURRENT'> {
  if (!input.published) return input.failed ? 'FAILED' : 'MISSING'
  if (
    input.published.sourceSize !== input.sourceSize ||
    input.published.sourceMtimeMs !== input.sourceMtimeMs ||
    input.published.publishedCount <= 0 ||
    input.published.frames.length !== input.published.publishedCount
  ) {
    return 'STALE'
  }
  for (const frame of input.published.frames) {
    if (!frame.path) return 'STALE'
    const exists = await fs
      .stat(await resolveKeyframePath(input.keyframeStorageRoot, frame.path))
      .then((stat) => stat.isFile())
      .catch(() => false)
    if (!exists) return 'STALE'
  }
  return 'CURRENT'
}

function matchesFilter(
  path: string,
  duration: number | null,
  state: 'MISSING' | 'STALE' | 'FAILED' | 'CURRENT',
  filter: VideoKeyframeFilter,
  force: boolean
) {
  if (state !== 'CURRENT') return matchesVideoKeyframeFilter({ path, duration, status: state }, filter)
  if (!force) return false
  return matchesVideoKeyframeFilter({ path, duration, status: filter.statuses[0] ?? 'MISSING' }, filter)
}

function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('Video keyframe discovery was interrupted')
}
