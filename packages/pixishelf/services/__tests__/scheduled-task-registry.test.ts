import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  cleanupScanRunHistoryMock,
  completeJobMock,
  createScanRunRetentionCleanupJobMock,
  failJobMock,
  getActiveJobByTypeMock,
  updateProgressMock
} = vi.hoisted(() => ({
  cleanupScanRunHistoryMock: vi.fn(),
  completeJobMock: vi.fn(),
  createScanRunRetentionCleanupJobMock: vi.fn(),
  failJobMock: vi.fn(),
  getActiveJobByTypeMock: vi.fn(),
  updateProgressMock: vi.fn()
}))

vi.mock('server-only', () => ({}))

vi.mock('@/services/job-service', () => ({
  completeJob: completeJobMock,
  createScanRunRetentionCleanupJob: createScanRunRetentionCleanupJobMock,
  failJob: failJobMock,
  getActiveJobByType: getActiveJobByTypeMock,
  updateProgress: updateProgressMock
}))

vi.mock('@/services/scan-run-service', () => ({
  cleanupScanRunHistory: cleanupScanRunHistoryMock
}))

vi.mock('@/services/setting.service', () => ({
  getScanPath: vi.fn()
}))

vi.mock('@/services/video-media-probe-service', () => ({
  runVideoMediaProbeJob: vi.fn()
}))

vi.mock('@/services/webp-animation-scan-service', () => ({
  runWebpAnimationScanJob: vi.fn()
}))

import { getScheduledTaskHandler, SCHEDULED_TASK_DEFINITIONS, SCHEDULED_TASK_TYPES } from '../scheduled-task-registry'

describe('scheduled-task-registry', () => {
  beforeEach(() => {
    cleanupScanRunHistoryMock.mockReset().mockResolvedValue({ deletedRuns: 7 })
    completeJobMock.mockReset().mockResolvedValue(undefined)
    createScanRunRetentionCleanupJobMock.mockReset().mockResolvedValue({ id: 'job-cleanup' })
    failJobMock.mockReset().mockResolvedValue(undefined)
    getActiveJobByTypeMock.mockReset().mockResolvedValue(null)
    updateProgressMock.mockReset().mockResolvedValue(undefined)
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
})
