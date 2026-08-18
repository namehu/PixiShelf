import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  cleanupScanRunHistoryMock,
  cleanupTriggerLogsMock,
  completeJobMock,
  createScanRunRetentionCleanupJobMock,
  createTriggerLogRetentionCleanupJobMock,
  createVideoChapterPreviewGenerationJobMock,
  failJobMock,
  getActiveJobByTypeMock,
  getJobMock,
  getScanPathMock,
  markAsCancelledMock,
  runVideoChapterPreviewGenerationJobMock,
  updateProgressMock,
  enqueueVideoKeyframeBatchMock
} = vi.hoisted(() => ({
  cleanupScanRunHistoryMock: vi.fn(),
  cleanupTriggerLogsMock: vi.fn(),
  completeJobMock: vi.fn(),
  createScanRunRetentionCleanupJobMock: vi.fn(),
  createTriggerLogRetentionCleanupJobMock: vi.fn(),
  createVideoChapterPreviewGenerationJobMock: vi.fn(),
  failJobMock: vi.fn(),
  getActiveJobByTypeMock: vi.fn(),
  getJobMock: vi.fn(),
  getScanPathMock: vi.fn(),
  markAsCancelledMock: vi.fn(),
  runVideoChapterPreviewGenerationJobMock: vi.fn(),
  updateProgressMock: vi.fn(),
  enqueueVideoKeyframeBatchMock: vi.fn()
}))

vi.mock('server-only', () => ({}))

vi.mock('@/services/job-service', () => ({
  completeJob: completeJobMock,
  createScanRunRetentionCleanupJob: createScanRunRetentionCleanupJobMock,
  createTriggerLogRetentionCleanupJob: createTriggerLogRetentionCleanupJobMock,
  createVideoChapterPreviewGenerationJob: createVideoChapterPreviewGenerationJobMock,
  failJob: failJobMock,
  getActiveJobByType: getActiveJobByTypeMock,
  getJob: getJobMock,
  markAsCancelled: markAsCancelledMock,
  updateProgress: updateProgressMock
}))

vi.mock('@/services/scan-run-service', () => ({
  cleanupScanRunHistory: cleanupScanRunHistoryMock
}))

vi.mock('@/services/trigger-log-service', () => ({
  cleanupTriggerLogs: cleanupTriggerLogsMock,
  TRIGGER_LOG_RETENTION_DAYS: 30
}))

vi.mock('@/services/setting.service', () => ({
  getScanPath: getScanPathMock
}))

vi.mock('@/services/video-media-probe-service', () => ({
  runVideoMediaProbeJob: vi.fn()
}))

vi.mock('@/services/video-chapter-preview-service', () => ({
  runVideoChapterPreviewGenerationJob: runVideoChapterPreviewGenerationJobMock
}))

vi.mock('@/services/video-poster-service', () => ({
  runVideoPosterGenerationJob: vi.fn()
}))

vi.mock('@/services/video-keyframe-queue', () => ({
  enqueueVideoKeyframeBatch: enqueueVideoKeyframeBatchMock
}))

vi.mock('@/services/webp-animation-scan-service', () => ({
  runWebpAnimationScanJob: vi.fn()
}))

import { getScheduledTaskHandler, SCHEDULED_TASK_DEFINITIONS, SCHEDULED_TASK_TYPES } from '../scheduled-task-registry'

describe('scheduled-task-registry', () => {
  beforeEach(() => {
    cleanupScanRunHistoryMock.mockReset().mockResolvedValue({ deletedRuns: 7 })
    cleanupTriggerLogsMock.mockReset().mockResolvedValue({
      deletedLogs: 12,
      retentionDays: 30,
      cutoff: '2026-07-09T00:00:00.000Z'
    })
    completeJobMock.mockReset().mockResolvedValue(undefined)
    createScanRunRetentionCleanupJobMock.mockReset().mockResolvedValue({ id: 'job-cleanup' })
    createTriggerLogRetentionCleanupJobMock.mockReset().mockResolvedValue({ id: 'job-trigger-cleanup' })
    createVideoChapterPreviewGenerationJobMock.mockReset().mockResolvedValue({ id: 'job-chapter-preview' })
    failJobMock.mockReset().mockResolvedValue(undefined)
    getActiveJobByTypeMock.mockReset().mockResolvedValue(null)
    getJobMock.mockReset().mockResolvedValue({ id: 'job-chapter-preview', status: 'RUNNING' })
    getScanPathMock.mockReset().mockResolvedValue('C:/scan')
    markAsCancelledMock.mockReset().mockResolvedValue(undefined)
    runVideoChapterPreviewGenerationJobMock.mockReset().mockResolvedValue({
      mode: 'INCREMENTAL',
      pending: 0,
      processed: 0,
      reused: 0,
      generated: 0,
      failed: 0,
      orphanedFilesDeleted: 0,
      failedSamples: []
    })
    updateProgressMock.mockReset().mockResolvedValue(undefined)
    enqueueVideoKeyframeBatchMock.mockReset().mockResolvedValue({ jobId: 'job-keyframes', status: 'PENDING' })
  })

  it('registers scan run retention cleanup as a disabled-by-default scheduled task', () => {
    expect(SCHEDULED_TASK_DEFINITIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'scan_run_retention_cleanup',
          type: SCHEDULED_TASK_TYPES.SCAN_RUN_RETENTION_CLEANUP,
          defaultEnabled: false,
          mutexKey: 'audit-maintenance'
        })
      ])
    )
  })

  it('registers trigger log retention cleanup as an enabled daily maintenance task', () => {
    expect(SCHEDULED_TASK_DEFINITIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'trigger_log_retention_cleanup',
          type: SCHEDULED_TASK_TYPES.TRIGGER_LOG_RETENTION_CLEANUP,
          defaultEnabled: true,
          mutexKey: 'audit-maintenance'
        })
      ])
    )
  })

  it('registers archive intake retention cleanup as an enabled daily writer task', () => {
    expect(SCHEDULED_TASK_DEFINITIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'archive_intake_retention_cleanup',
          type: SCHEDULED_TASK_TYPES.ARCHIVE_INTAKE_RETENTION_CLEANUP,
          defaultTime: '02:15',
          defaultPriority: 15,
          defaultEnabled: true,
          mutexKey: 'audit-maintenance'
        })
      ])
    )
    expect(getScheduledTaskHandler(SCHEDULED_TASK_TYPES.ARCHIVE_INTAKE_RETENTION_CLEANUP)?.start).toBeTypeOf('function')
  })

  it('registers archive reconciliation as enabled daily writer maintenance', () => {
    expect(SCHEDULED_TASK_DEFINITIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'archive_maintenance_reconcile',
          type: SCHEDULED_TASK_TYPES.ARCHIVE_MAINTENANCE,
          defaultTime: '02:05',
          defaultPriority: 12,
          defaultEnabled: true,
          mutexKey: 'audit-maintenance'
        })
      ])
    )
    expect(getScheduledTaskHandler(SCHEDULED_TASK_TYPES.ARCHIVE_MAINTENANCE)?.start).toBeTypeOf('function')
  })

  it('registers chapter preview generation after video probing and disabled by default', () => {
    expect(SCHEDULED_TASK_DEFINITIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'video_chapter_preview_generation',
          type: SCHEDULED_TASK_TYPES.VIDEO_CHAPTER_PREVIEW_GENERATION,
          defaultTime: '04:30',
          defaultPriority: 50,
          defaultEnabled: false,
          mutexKey: 'media-maintenance'
        })
      ])
    )
  })

  it('registers keyframe discovery at 05:00 and disabled by default', () => {
    expect(SCHEDULED_TASK_DEFINITIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'video_keyframe_generation',
          type: SCHEDULED_TASK_TYPES.VIDEO_KEYFRAME_DISCOVERY,
          defaultTime: '05:00',
          defaultEnabled: false,
          mutexKey: 'media-maintenance'
        })
      ])
    )
  })

  it('registers daily derived-media intent GC after media jobs and disabled until central cutover', () => {
    expect(SCHEDULED_TASK_DEFINITIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'derived_media_gc',
          type: SCHEDULED_TASK_TYPES.DERIVED_MEDIA_GC,
          defaultTime: '05:30',
          defaultPriority: 70,
          defaultEnabled: false,
          mutexKey: 'media-maintenance'
        })
      ])
    )
  })

  it('registers an independent weekly reconciliation dry-run without a new schedule enum', () => {
    expect(SCHEDULED_TASK_DEFINITIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'derived_media_gc_reconciliation',
          type: SCHEDULED_TASK_TYPES.DERIVED_MEDIA_GC,
          defaultPriority: 71,
          defaultEnabled: false,
          mutexKey: 'media-maintenance'
        })
      ])
    )
  })

  it('refuses to run derived-media GC through the detached legacy handler', async () => {
    const handler = getScheduledTaskHandler(SCHEDULED_TASK_TYPES.DERIVED_MEDIA_GC)

    await expect(handler?.start({ trigger: 'manual' })).rejects.toThrow(
      'Derived media GC requires central dispatcher cutover'
    )
  })

  it('runs keyframe discovery with the scheduled task filter', async () => {
    const handler = getScheduledTaskHandler(SCHEDULED_TASK_TYPES.VIDEO_KEYFRAME_DISCOVERY)
    const config = { minDuration: 600, maxDuration: null, includePaths: [], excludePaths: [] }

    await expect(handler?.start({ trigger: 'schedule', taskConfig: config })).resolves.toEqual({
      jobId: 'job-keyframes'
    })
    expect(enqueueVideoKeyframeBatchMock).toHaveBeenCalledWith({
      trigger: 'schedule',
      previewOnly: false,
      filter: config
    })
  })

  it('turns a manual scheduled-task trigger into a preview instead of direct generation', async () => {
    const handler = getScheduledTaskHandler(SCHEDULED_TASK_TYPES.VIDEO_KEYFRAME_DISCOVERY)

    await handler?.start({ trigger: 'manual', taskConfig: {} })

    expect(enqueueVideoKeyframeBatchMock).toHaveBeenCalledWith({
      trigger: 'manual',
      previewOnly: true,
      filter: {}
    })
  })

  it('runs trigger log retention cleanup and records its result', async () => {
    const handler = getScheduledTaskHandler(SCHEDULED_TASK_TYPES.TRIGGER_LOG_RETENTION_CLEANUP)

    const result = await handler?.start({ trigger: 'schedule' })

    expect(getActiveJobByTypeMock).toHaveBeenCalledWith(SCHEDULED_TASK_TYPES.TRIGGER_LOG_RETENTION_CLEANUP)
    expect(createTriggerLogRetentionCleanupJobMock).toHaveBeenCalled()
    expect(result).toEqual({ jobId: 'job-trigger-cleanup' })
    await vi.waitFor(() => {
      expect(cleanupTriggerLogsMock).toHaveBeenCalled()
      expect(completeJobMock).toHaveBeenCalledWith('job-trigger-cleanup', {
        deletedLogs: 12,
        retentionDays: 30,
        cutoff: '2026-07-09T00:00:00.000Z',
        trigger: 'schedule'
      })
    })
  })

  it('starts scan run retention cleanup in the background and stores the deleted count in job result', async () => {
    const handler = getScheduledTaskHandler(SCHEDULED_TASK_TYPES.SCAN_RUN_RETENTION_CLEANUP)

    const result = await handler?.start({ trigger: 'manual' })

    expect(getActiveJobByTypeMock).toHaveBeenCalledWith(SCHEDULED_TASK_TYPES.SCAN_RUN_RETENTION_CLEANUP)
    expect(createScanRunRetentionCleanupJobMock).toHaveBeenCalled()
    expect(result).toEqual({ jobId: 'job-cleanup' })
    await vi.waitFor(() => {
      expect(cleanupScanRunHistoryMock).toHaveBeenCalled()
      expect(completeJobMock).toHaveBeenCalledWith('job-cleanup', {
        deletedRuns: 7,
        trigger: 'manual'
      })
    })
  })

  it('marks the cleanup job as failed when cleanup throws', async () => {
    cleanupScanRunHistoryMock.mockRejectedValueOnce(new Error('cleanup failed'))
    const handler = getScheduledTaskHandler(SCHEDULED_TASK_TYPES.SCAN_RUN_RETENTION_CLEANUP)

    const result = await handler?.start({ trigger: 'schedule' })

    expect(result).toEqual({ jobId: 'job-cleanup' })
    await vi.waitFor(() => {
      expect(failJobMock).toHaveBeenCalledWith('job-cleanup', 'cleanup failed')
      expect(completeJobMock).not.toHaveBeenCalled()
    })
  })

  it('runs the daily chapter preview task in incremental mode', async () => {
    const handler = getScheduledTaskHandler(SCHEDULED_TASK_TYPES.VIDEO_CHAPTER_PREVIEW_GENERATION)

    const result = await handler?.start({ trigger: 'schedule' })

    expect(result).toEqual({ jobId: 'job-chapter-preview' })
    await vi.waitFor(() => {
      expect(runVideoChapterPreviewGenerationJobMock).toHaveBeenCalledWith(
        expect.objectContaining({
          scanPath: 'C:/scan',
          mode: 'INCREMENTAL'
        })
      )
      expect(completeJobMock).toHaveBeenCalledWith(
        'job-chapter-preview',
        expect.objectContaining({ mode: 'INCREMENTAL', trigger: 'schedule' })
      )
    })
  })

  it('keeps manual chapter preview execution full by default', async () => {
    runVideoChapterPreviewGenerationJobMock.mockResolvedValueOnce({
      mode: 'FULL',
      pending: 0,
      processed: 0,
      reused: 0,
      generated: 0,
      failed: 0,
      orphanedFilesDeleted: 0,
      failedSamples: []
    })
    const handler = getScheduledTaskHandler(SCHEDULED_TASK_TYPES.VIDEO_CHAPTER_PREVIEW_GENERATION)

    await handler?.start({ trigger: 'manual' })

    await vi.waitFor(() => {
      expect(runVideoChapterPreviewGenerationJobMock).toHaveBeenCalledWith(expect.objectContaining({ mode: 'FULL' }))
    })
  })
})
