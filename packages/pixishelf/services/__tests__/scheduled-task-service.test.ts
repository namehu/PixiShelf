import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  enqueueJobMock,
  getActiveJobsByTypesMock,
  handlerStartMock,
  scheduledTaskFindManyMock,
  scheduledTaskFindUniqueMock,
  scheduledTaskUpdateMock,
  scheduledTaskUpsertMock,
  systemJobFindManyMock
} = vi.hoisted(() => ({
  enqueueJobMock: vi.fn(),
  getActiveJobsByTypesMock: vi.fn(),
  handlerStartMock: vi.fn(),
  scheduledTaskFindManyMock: vi.fn(),
  scheduledTaskFindUniqueMock: vi.fn(),
  scheduledTaskUpdateMock: vi.fn(),
  scheduledTaskUpsertMock: vi.fn(),
  systemJobFindManyMock: vi.fn()
}))

vi.mock('server-only', () => ({}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    scheduledTask: {
      upsert: scheduledTaskUpsertMock,
      findMany: scheduledTaskFindManyMock,
      findUnique: scheduledTaskFindUniqueMock,
      update: scheduledTaskUpdateMock
    },
    systemJob: {
      findMany: systemJobFindManyMock
    }
  }
}))

vi.mock('@/services/job-service', () => ({
  getActiveJobsByTypes: getActiveJobsByTypesMock
}))

vi.mock('@/services/background-task/job-command-service', () => ({
  enqueueJob: enqueueJobMock
}))

vi.mock('@/services/scheduled-task-registry', () => ({
  SCHEDULED_TASK_DEFINITIONS: [
    {
      key: 'scan_run_retention_cleanup',
      type: 'SCAN_RUN_RETENTION_CLEANUP',
      name: '清理扫描历史',
      description: 'cleanup task',
      defaultTime: '00:10',
      defaultTimezone: 'UTC',
      defaultPriority: 20,
      defaultEnabled: false,
      mutexKey: 'audit-maintenance'
    },
    {
      key: 'webp_animation_scan',
      type: 'WEBP_ANIMATION_SCAN',
      name: '识别 WebP 动图',
      description: 'test task',
      defaultTime: '00:30',
      defaultTimezone: 'UTC',
      defaultPriority: 30,
      defaultEnabled: false,
      mutexKey: 'media-maintenance'
    }
  ],
  getScheduledTaskDefinition: (key: string) =>
    key === 'scan_run_retention_cleanup'
      ? {
          key,
          type: 'SCAN_RUN_RETENTION_CLEANUP',
          name: '清理扫描历史',
          description: 'cleanup task',
          defaultTime: '00:10',
          defaultTimezone: 'UTC',
          defaultPriority: 20,
          defaultEnabled: false,
          mutexKey: 'audit-maintenance'
        }
      : key === 'webp_animation_scan'
        ? {
            key,
            type: 'WEBP_ANIMATION_SCAN',
            name: '识别 WebP 动图',
            description: 'test task',
            defaultTime: '00:30',
            defaultTimezone: 'UTC',
            defaultPriority: 30,
            defaultEnabled: false,
            mutexKey: 'media-maintenance'
          }
        : null,
  getScheduledTaskDefinitionByType: (type: string) =>
    type === 'OTHER_MEDIA_TASK'
      ? {
          key: 'other_media_task',
          type,
          name: 'Other',
          description: 'Other media task',
          defaultTime: '00:30',
          defaultTimezone: 'UTC',
          defaultPriority: 20,
          defaultEnabled: false,
          mutexKey: 'media-maintenance'
        }
      : null,
  getScheduledTaskHandler: (type: string) =>
    type === 'WEBP_ANIMATION_SCAN' || type === 'SCAN_RUN_RETENTION_CLEANUP'
      ? {
          start: handlerStartMock
        }
      : null
}))

import {
  ensureDefaultScheduledTasks,
  listScheduledTasks,
  runSchedulerTick,
  triggerScheduledTaskNow
} from '../scheduled-task-service'

function createTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    key: 'webp_animation_scan',
    type: 'WEBP_ANIMATION_SCAN',
    enabled: true,
    scheduleMode: 'DAILY',
    time: '00:30',
    timezone: 'UTC',
    priority: 30,
    mutexKey: 'media-maintenance',
    lastTriggeredAt: null,
    lastTriggeredDate: null,
    lastJobId: null,
    config: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides
  }
}

function createCleanupTask(overrides: Record<string, unknown> = {}) {
  return createTask({
    id: 'task-cleanup',
    key: 'scan_run_retention_cleanup',
    type: 'SCAN_RUN_RETENTION_CLEANUP',
    time: '00:10',
    priority: 20,
    mutexKey: 'audit-maintenance',
    ...overrides
  })
}

describe('scheduled-task-service', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'false')
    enqueueJobMock.mockReset().mockResolvedValue({ id: 'queued-job-1' })
    scheduledTaskUpsertMock.mockReset().mockResolvedValue({})
    scheduledTaskUpdateMock.mockReset().mockResolvedValue({})
    scheduledTaskFindUniqueMock.mockReset()
    systemJobFindManyMock.mockReset().mockResolvedValue([])
    getActiveJobsByTypesMock.mockReset().mockResolvedValue([])
    handlerStartMock.mockReset().mockResolvedValue({ jobId: 'job-1' })
  })

  it('creates default scheduled tasks with per-definition enabled defaults', async () => {
    await ensureDefaultScheduledTasks()

    expect(scheduledTaskUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'scan_run_retention_cleanup' },
        create: expect.objectContaining({
          key: 'scan_run_retention_cleanup',
          enabled: false
        })
      })
    )
    expect(scheduledTaskUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'webp_animation_scan' },
        create: expect.objectContaining({
          key: 'webp_animation_scan',
          enabled: false
        })
      })
    )
  })

  it('shows the shared 00:00-08:00 Shanghai window after central cutover', async () => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-02T01:00:00.000Z'))
    scheduledTaskFindManyMock.mockResolvedValueOnce([createTask({ time: '04:30', timezone: 'UTC' })])

    const [task] = await listScheduledTasks()

    expect(task).toMatchObject({
      nextRunAt: '2026-06-03 00:00 Asia/Shanghai',
      executionWindow: {
        timezone: 'Asia/Shanghai',
        startAt: '2026-06-02T16:00:00.000Z',
        endAt: '2026-06-03T00:00:00.000Z'
      }
    })
  })

  it('does not trigger before the configured daily time', async () => {
    scheduledTaskFindManyMock.mockReset().mockResolvedValueOnce([createTask()])

    const result = await runSchedulerTick(new Date('2026-06-01T00:29:00.000Z'))

    expect(handlerStartMock).not.toHaveBeenCalled()
    expect(result.decisions).toEqual([
      {
        key: 'webp_animation_scan',
        type: 'WEBP_ANIMATION_SCAN',
        action: 'skipped',
        reason: 'not_due'
      }
    ])
  })

  it('does not trigger twice on the same local day', async () => {
    scheduledTaskFindManyMock.mockReset().mockResolvedValueOnce([createTask({ lastTriggeredDate: '2026-06-01' })])

    const result = await runSchedulerTick(new Date('2026-06-01T01:00:00.000Z'))

    expect(handlerStartMock).not.toHaveBeenCalled()
    expect(result.decisions[0]).toMatchObject({
      action: 'skipped',
      reason: 'already_triggered'
    })
  })

  it('triggers due tasks and records last trigger state', async () => {
    scheduledTaskFindManyMock.mockReset().mockResolvedValueOnce([createTask()])

    const now = new Date('2026-06-01T00:30:00.000Z')
    const result = await runSchedulerTick(now)

    expect(handlerStartMock).toHaveBeenCalledWith({ trigger: 'schedule', taskConfig: null })
    expect(scheduledTaskUpdateMock).toHaveBeenCalledWith({
      where: { key: 'webp_animation_scan' },
      data: {
        lastTriggeredAt: now,
        lastTriggeredDate: '2026-06-01',
        lastJobId: 'job-1'
      }
    })
    expect(result.decisions[0]).toMatchObject({
      action: 'triggered',
      jobId: 'job-1'
    })
  })

  it('triggers due scan run retention cleanup tasks', async () => {
    scheduledTaskFindManyMock.mockReset().mockResolvedValueOnce([createCleanupTask()])

    const now = new Date('2026-06-01T00:10:00.000Z')
    const result = await runSchedulerTick(now)

    expect(handlerStartMock).toHaveBeenCalledWith({ trigger: 'schedule', taskConfig: null })
    expect(scheduledTaskUpdateMock).toHaveBeenCalledWith({
      where: { key: 'scan_run_retention_cleanup' },
      data: {
        lastTriggeredAt: now,
        lastTriggeredDate: '2026-06-01',
        lastJobId: 'job-1'
      }
    })
    expect(result.decisions[0]).toMatchObject({
      key: 'scan_run_retention_cleanup',
      type: 'SCAN_RUN_RETENTION_CLEANUP',
      action: 'triggered',
      jobId: 'job-1'
    })
  })

  it('skips due tasks when a mutex task is already running', async () => {
    scheduledTaskFindManyMock.mockReset().mockResolvedValueOnce([createTask()])
    getActiveJobsByTypesMock.mockResolvedValueOnce([{ id: 'job-active', type: 'OTHER_MEDIA_TASK' }])

    const result = await runSchedulerTick(new Date('2026-06-01T00:30:00.000Z'))

    expect(handlerStartMock).not.toHaveBeenCalled()
    expect(result.decisions[0]).toMatchObject({
      action: 'skipped',
      reason: 'mutex_busy'
    })
  })

  it('skips due tasks when the same task type is already running', async () => {
    scheduledTaskFindManyMock.mockReset().mockResolvedValueOnce([createCleanupTask()])
    getActiveJobsByTypesMock.mockResolvedValueOnce([{ id: 'job-active', type: 'SCAN_RUN_RETENTION_CLEANUP' }])

    const result = await runSchedulerTick(new Date('2026-06-01T00:10:00.000Z'))

    expect(handlerStartMock).not.toHaveBeenCalled()
    expect(result.decisions[0]).toMatchObject({
      action: 'skipped',
      reason: 'already_running'
    })
  })

  it('triggers scheduled tasks manually and records the job id', async () => {
    scheduledTaskFindUniqueMock.mockResolvedValueOnce(createCleanupTask())

    const result = await triggerScheduledTaskNow('scan_run_retention_cleanup')

    expect(handlerStartMock).toHaveBeenCalledWith({ trigger: 'manual', taskConfig: null })
    expect(scheduledTaskUpdateMock).toHaveBeenCalledWith({
      where: { key: 'scan_run_retention_cleanup' },
      data: {
        lastJobId: 'job-1'
      }
    })
    expect(result).toEqual({ jobId: 'job-1' })
  })

  it('only enqueues a manual job after central dispatcher cutover', async () => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    scheduledTaskFindUniqueMock.mockResolvedValueOnce(createCleanupTask())

    const result = await triggerScheduledTaskNow('scan_run_retention_cleanup', {
      requestedByUserId: 'admin-1'
    })

    expect(enqueueJobMock).toHaveBeenCalledWith({
      type: 'SCAN_RUN_RETENTION_CLEANUP',
      triggerSource: 'MANUAL',
      requestedByUserId: 'admin-1',
      payload: {},
      priority: 20
    })
    expect(handlerStartMock).not.toHaveBeenCalled()
    expect(getActiveJobsByTypesMock).not.toHaveBeenCalled()
    expect(scheduledTaskUpdateMock).toHaveBeenCalledWith({
      where: { key: 'scan_run_retention_cleanup' },
      data: { lastJobId: 'queued-job-1' }
    })
    expect(result).toEqual({ jobId: 'queued-job-1' })
  })

  it('forwards an explicit incremental chapter preview mode for manual execution', async () => {
    scheduledTaskFindUniqueMock.mockResolvedValueOnce(createTask())

    await triggerScheduledTaskNow('webp_animation_scan', { chapterPreviewMode: 'INCREMENTAL' })

    expect(handlerStartMock).toHaveBeenCalledWith({
      trigger: 'manual',
      taskConfig: null,
      chapterPreviewMode: 'INCREMENTAL'
    })
  })

  it('blocks manual execution when another task holds the same mutex', async () => {
    scheduledTaskFindUniqueMock.mockResolvedValueOnce(createTask())
    getActiveJobsByTypesMock.mockResolvedValueOnce([{ id: 'job-active', type: 'OTHER_MEDIA_TASK' }])

    await expect(triggerScheduledTaskNow('webp_animation_scan')).rejects.toThrow(
      'Scheduled task mutex is busy: media-maintenance'
    )
    expect(handlerStartMock).not.toHaveBeenCalled()
  })
})
