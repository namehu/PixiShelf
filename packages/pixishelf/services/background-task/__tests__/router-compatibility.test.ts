import { readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const serviceRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const routerSource = readFileSync(join(serviceRoot, '..', '..', 'server', 'routers', 'job.ts'), 'utf8')
const artworkRouterSource = readFileSync(join(serviceRoot, '..', '..', 'server', 'routers', 'artwork.ts'), 'utf8')
const localImportRouterSource = readFileSync(
  join(serviceRoot, '..', '..', 'server', 'routers', 'local-import.ts'),
  'utf8'
)
const archiveRouterSource = readFileSync(join(serviceRoot, '..', '..', 'server', 'routers', 'archive.ts'), 'utf8')
const videoOptimizationQueueSource = readFileSync(
  join(serviceRoot, '..', 'video-streaming-optimization-queue.ts'),
  'utf8'
)
const pendingReplaceServiceSource = readFileSync(join(serviceRoot, '..', 'pending-replace-service', 'index.ts'), 'utf8')
const schedulerRouteSource = readFileSync(
  join(serviceRoot, '..', '..', 'app', 'api', 'internal', 'scheduler', 'tick', 'route.ts'),
  'utf8'
)

describe('unified background task router integration', () => {
  it('keeps unified and legacy task mutations behind the explicit admin boundary', () => {
    for (const name of [
      'startRefillMetaSource',
      'cancelRefillMetaSource',
      'startMediaDerivedTagSync',
      'startWebpAnimationScan',
      'startVideoMediaProbe',
      'cancelVideoMediaProbe',
      'cancelVideoChapterPreviewGeneration',
      'reprobeVideoMediaByPath',
      'startVideoStreamingOptimization',
      'cancelVideoStreamingOptimization',
      'startVideoKeyframeGeneration',
      'startVideoKeyframeBatch',
      'controlVideoKeyframe',
      'retryVideoKeyframe',
      'retryFailedVideoKeyframes',
      'selectVideoKeyframePoster',
      'updateScheduledTask',
      'triggerScheduledTaskNow',
      'backgroundDashboard',
      'backgroundList',
      'backgroundDetail',
      'backgroundEvents',
      'enqueueBackgroundJob',
      'cancelBackgroundJob',
      'pauseBackgroundJob',
      'resumeBackgroundJob',
      'retryBackgroundJob',
      'changeBackgroundJobPriority'
    ]) {
      expect(routerSource).toMatch(new RegExp(`${name}: adminProcedure`))
    }

    for (const name of ['preview', 'enqueue', 'retryTaskItem', 'action']) {
      expect(archiveRouterSource).toMatch(new RegExp(`${name}: adminProcedure`))
    }
    for (const name of ['saveMappings', 'start', 'cancel']) {
      expect(localImportRouterSource).toMatch(new RegExp(`${name}: adminProcedure`))
    }
    expect(artworkRouterSource).toMatch(/reprobeVideoMedia: adminProcedure/)
  })

  it('passes the authenticated administrator to every scheduled-task manual enqueue path', () => {
    expect(routerSource.match(/triggerScheduledTaskNow\(/g)).toHaveLength(3)
    expect(routerSource).toContain("triggerScheduledTaskNow('webp_animation_scan', { requestedByUserId: ctx.userId })")
    expect(routerSource).toContain("triggerScheduledTaskNow('video_media_probe', { requestedByUserId: ctx.userId })")
    expect(routerSource).toMatch(
      /triggerScheduledTaskNow\(input\.key, \{[\s\S]*?requestedByUserId: ctx\.userId[\s\S]*?\}\)/
    )
  })

  it('contains no detached async execution in the new service boundary', () => {
    const productionSources = readdirSync(serviceRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && extname(entry.name) === '.ts')
      .map((entry) => readFileSync(join(serviceRoot, entry.name), 'utf8'))
    expect(productionSources.some((source) => /\(async\s*\(\)\s*=>/.test(source))).toBe(false)
  })

  it('routes scheduler ticks only through the materializer without queue wake side effects', () => {
    expect(schedulerRouteSource).toContain('runScheduleMaterializerTick()')
    expect(schedulerRouteSource).not.toContain('runSchedulerTick')
    expect(schedulerRouteSource).not.toContain('wakeVideoOptimizationQueue')
  })

  it('hard-guards the remaining router IIFEs after central cutover', () => {
    for (const operation of [
      'REFILL_META_SOURCE',
      'CANCEL_REFILL_META_SOURCE',
      'MEDIA_DERIVED_TAG_SYNC',
      'CANCEL_VIDEO_MEDIA_PROBE',
      'CANCEL_VIDEO_CHAPTER_PREVIEW_GENERATION',
      'VIDEO_MEDIA_REPROBE',
      'VIDEO_KEYFRAME_GENERATION',
      'VIDEO_KEYFRAME_BATCH',
      'VIDEO_KEYFRAME_CONTROL',
      'VIDEO_KEYFRAME_RETRY',
      'VIDEO_KEYFRAME_RETRY_FAILED'
    ]) {
      expect(routerSource).toContain(`assertLegacyRouterExecutionAllowed('${operation}')`)
    }
    expect(localImportRouterSource).toContain("assertLegacyBackgroundExecutionAllowed('LOCAL_DIRECTORY_IMPORT')")
    expect(archiveRouterSource).toContain('archiveModule.enqueue(input, { requestedByUserId: ctx.userId })')
    expect(archiveRouterSource).toContain(
      'archiveModule.retryTaskItem(input.taskId, input.itemId, { requestedByUserId: ctx.userId })'
    )
    expect(archiveRouterSource).toContain(
      'archiveModule.requestAction(input.taskId, input.action, { requestedByUserId: ctx.userId })'
    )
    expect(
      videoOptimizationQueueSource.match(/assertLegacyBackgroundExecutionAllowed\('VIDEO_STREAMING_OPTIMIZATION'\)/g)
    ).toHaveLength(4)
    expect(routerSource).toContain('enqueueVideoOptimization(input.imageId, ctx.userId)')
    expect(routerSource).toContain('cancelVideoOptimization(input.jobId)')
    expect(
      pendingReplaceServiceSource.match(/assertLegacyBackgroundExecutionAllowed\('PENDING_REPLACE'\)/g)
    ).toHaveLength(4)
  })

  it('uses durable manual enqueue for migrated maintenance tasks after central cutover', () => {
    for (const type of ['REFILL_META_SOURCE', 'MEDIA_DERIVED_TAG_SYNC']) {
      expect(routerSource).toContain(`type: '${type}'`)
    }
    expect(routerSource).toMatch(
      /if \(isCentralDispatcherCutoverEnabled\(\)\)[\s\S]*?type: 'REFILL_META_SOURCE'[\s\S]*?requestedByUserId: ctx\.userId/
    )
    expect(routerSource).toMatch(
      /if \(isCentralDispatcherCutoverEnabled\(\)\)[\s\S]*?type: 'MEDIA_DERIVED_TAG_SYNC'[\s\S]*?requestedByUserId: ctx\.userId/
    )
    expect(routerSource).toContain("triggerScheduledTaskNow('webp_animation_scan', { requestedByUserId: ctx.userId })")
  })
})
