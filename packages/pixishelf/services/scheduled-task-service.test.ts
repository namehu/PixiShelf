import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getActiveJobsByTypesMock,
  handlerStartMock,
  scheduledTaskFindManyMock,
  scheduledTaskFindUniqueMock,
  scheduledTaskUpdateMock,
  scheduledTaskUpsertMock,
  systemJobFindManyMock
} = vi.hoisted(() => ({
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

vi.mock('@/services/scheduled-task-registry', () => ({
  SCHEDULED_TASK_DEFINITIONS: [
    {
      key: 'webp_animation_scan',
      type: 'WEBP_ANIMATION_SCAN',
      name: '识别 WebP 动图',
      description: 'test task',
      defaultTime: '00:30',
      defaultTimezone: 'UTC',
      defaultPriority: 30,
      mutexKey: 'media-maintenance'
    }
  ],
  getScheduledTaskDefinition: (key: string) =>
    key === 'webp_animation_scan'
      ? {
          key,
          type: 'WEBP_ANIMATION_SCAN',
          name: '识别 WebP 动图',
          description: 'test task',
          defaultTime: '00:30',
          defaultTimezone: 'UTC',
          defaultPriority: 30,
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
          mutexKey: 'media-maintenance'
        }
      : null,
  getScheduledTaskHandler: (type: string) =>
    type === 'WEBP_ANIMATION_SCAN'
      ? {
          start: handlerStartMock
        }
      : null
}))

import { runSchedulerTick } from './scheduled-task-service'

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

describe('scheduled-task-service', () => {
  beforeEach(() => {
    scheduledTaskUpsertMock.mockReset().mockResolvedValue({})
    scheduledTaskUpdateMock.mockReset().mockResolvedValue({})
    scheduledTaskFindUniqueMock.mockReset()
    systemJobFindManyMock.mockReset().mockResolvedValue([])
    getActiveJobsByTypesMock.mockReset().mockResolvedValue([])
    handlerStartMock.mockReset().mockResolvedValue({ jobId: 'job-1' })
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

    expect(handlerStartMock).toHaveBeenCalledWith({ trigger: 'schedule' })
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
})
