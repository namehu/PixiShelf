import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  cleanupScanRunHistoryMock,
  cleanupTriggerLogsMock,
  completeJobMock,
  createScanRunRetentionCleanupJobMock,
  createTriggerLogRetentionCleanupJobMock,
  createVideoMediaProbeJobMock,
  createVideoChapterPreviewGenerationJobMock,
  failJobMock,
  getActiveJobByTypeMock,
  getJobMock,
  getScanPathMock,
  markAsCancelledMock,
  runVideoMediaProbeJobMock,
  runVideoChapterPreviewGenerationJobMock,
  runVideoPosterGenerationJobMock,
  updateProgressMock,
  enqueueVideoKeyframeBatchMock
} = vi.hoisted(() => ({
  cleanupScanRunHistoryMock: vi.fn(),
  cleanupTriggerLogsMock: vi.fn(),
  completeJobMock: vi.fn(),
  createScanRunRetentionCleanupJobMock: vi.fn(),
  createTriggerLogRetentionCleanupJobMock: vi.fn(),
  createVideoMediaProbeJobMock: vi.fn(),
  createVideoChapterPreviewGenerationJobMock: vi.fn(),
  failJobMock: vi.fn(),
  getActiveJobByTypeMock: vi.fn(),
  getJobMock: vi.fn(),
  getScanPathMock: vi.fn(),
  markAsCancelledMock: vi.fn(),
  runVideoMediaProbeJobMock: vi.fn(),
  runVideoChapterPreviewGenerationJobMock: vi.fn(),
  runVideoPosterGenerationJobMock: vi.fn(),
  updateProgressMock: vi.fn(),
  enqueueVideoKeyframeBatchMock: vi.fn()
}))

vi.mock('server-only', () => ({}))

vi.mock('@/services/job-service', () => ({
  completeJob: completeJobMock,
  createScanRunRetentionCleanupJob: createScanRunRetentionCleanupJobMock,
  createTriggerLogRetentionCleanupJob: createTriggerLogRetentionCleanupJobMock,
  createVideoMediaProbeJob: createVideoMediaProbeJobMock,
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
  runVideoMediaProbeJob: runVideoMediaProbeJobMock
}))

vi.mock('@/services/video-chapter-preview-service', () => ({
  runVideoChapterPreviewGenerationJob: runVideoChapterPreviewGenerationJobMock
}))

vi.mock('@/services/video-poster-service', () => ({
  runVideoPosterGenerationJob: runVideoPosterGenerationJobMock
}))

vi.mock('@/services/video-keyframe-queue', () => ({
  enqueueVideoKeyframeBatch: enqueueVideoKeyframeBatchMock
}))

vi.mock('@/services/webp-animation-scan-service', () => ({
  runWebpAnimationScanJob: vi.fn()
}))

import { SCHEDULED_TASK_DEFINITIONS, SCHEDULED_TASK_TYPES } from '../scheduled-task-registry'

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
    createVideoMediaProbeJobMock.mockReset().mockResolvedValue({ id: 'job-video-probe' })
    createVideoChapterPreviewGenerationJobMock.mockReset().mockResolvedValue({ id: 'job-chapter-preview' })
    failJobMock.mockReset().mockResolvedValue(undefined)
    getActiveJobByTypeMock.mockReset().mockResolvedValue(null)
    getJobMock.mockReset().mockResolvedValue({ id: 'job-chapter-preview', status: 'RUNNING' })
    getScanPathMock.mockReset().mockResolvedValue('C:/scan')
    markAsCancelledMock.mockReset().mockResolvedValue(undefined)
    runVideoMediaProbeJobMock.mockReset().mockImplementation(async ({ mode = 'INCREMENTAL' } = {}) => ({
      mode,
      classifiedVideos: 0,
      classifiedImages: 0,
      classifiedAnimations: 0,
      unknown: 0,
      metadataRowsCreated: 0,
      processed: 0,
      failed: 0,
      remainingPending: 0,
      failedSamples: []
    }))
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
    runVideoPosterGenerationJobMock.mockReset().mockResolvedValue({
      pending: 0,
      processed: 0,
      generated: 0,
      failed: 0,
      remainingPending: 0,
      failedSamples: []
    })
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
})
