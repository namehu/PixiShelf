import { beforeEach, describe, expect, it, vi } from 'vitest'

const { enqueueJobMock, ensureDefaultsMock, legacyTickMock, loggerWarnMock } = vi.hoisted(() => ({
  enqueueJobMock: vi.fn(),
  ensureDefaultsMock: vi.fn(),
  legacyTickMock: vi.fn(),
  loggerWarnMock: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/logger', () => ({ default: { warn: loggerWarnMock } }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/services/background-task/job-command-service', () => ({ enqueueJob: enqueueJobMock }))
vi.mock('@/services/scheduled-task-service', () => ({
  ensureDefaultScheduledTasks: ensureDefaultsMock,
  runSchedulerTick: legacyTickMock
}))

import {
  getShanghaiScheduleWindow,
  runScheduleMaterializerTick,
  toScheduledQueuePriority
} from '../schedule-materializer'

interface FakeTask {
  id: string
  key: string
  type: string
  priority: number
  config: unknown
}

function createDatabase(tasks: FakeTask[]) {
  const jobsBySchedule = new Map<string, { id: string }>()
  const scheduledTaskUpdate = vi.fn().mockResolvedValue({})
  const queryRaw = vi.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }])
  const transaction = {
    $queryRaw: queryRaw,
    scheduledTask: {
      findMany: vi.fn().mockResolvedValue(tasks),
      update: scheduledTaskUpdate
    },
    systemJob: {
      findFirst: vi.fn().mockImplementation(({ where }) => {
        return jobsBySchedule.get(`${where.scheduledTaskId}:${where.scheduledForDate}`) ?? null
      })
    }
  }
  let transactionTail = Promise.resolve()
  const database = {
    $transaction<T>(callback: (current: typeof transaction) => Promise<T>): Promise<T> {
      const result = transactionTail.then(() => callback(transaction))
      transactionTail = result.then(
        () => undefined,
        () => undefined
      )
      return result
    }
  }

  enqueueJobMock.mockImplementation(async (input) => {
    const key = `${input.scheduledTaskId}:${input.scheduledForDate}`
    const job = { id: `job-${jobsBySchedule.size + 1}` }
    jobsBySchedule.set(key, job)
    return job
  })

  return { database, jobsBySchedule, queryRaw, scheduledTaskUpdate, transaction }
}

describe('schedule materializer', () => {
  beforeEach(() => {
    enqueueJobMock.mockReset()
    ensureDefaultsMock.mockReset().mockResolvedValue(undefined)
    legacyTickMock.mockReset().mockResolvedValue({ now: 'legacy-now', decisions: [] })
    loggerWarnMock.mockReset()
  })

  it('uses the fixed Shanghai [00:00, 08:00) window', () => {
    expect(getShanghaiScheduleWindow(new Date('2026-06-01T16:00:00.000Z'))).toMatchObject({
      scheduledForDate: '2026-06-02',
      isOpen: true
    })
    expect(getShanghaiScheduleWindow(new Date('2026-06-01T23:59:59.999Z')).isOpen).toBe(true)
    expect(getShanghaiScheduleWindow(new Date('2026-06-02T00:00:00.000Z')).isOpen).toBe(false)
  })

  it('preserves all six legacy priority levels in the scheduled priority band', () => {
    expect([10, 20, 30, 40, 50, 60].map(toScheduledQueuePriority)).toEqual([110, 120, 130, 140, 150, 160])
    expect(toScheduledQueuePriority(100)).toBe(100)
    expect(toScheduledQueuePriority(1_200)).toBe(999)
  })

  it('materializes every enabled daily task without consulting its legacy time', async () => {
    const tasks: FakeTask[] = [
      {
        id: 'task-cleanup',
        key: 'scan_run_retention_cleanup',
        type: 'SCAN_RUN_RETENTION_CLEANUP',
        priority: 20,
        config: null
      },
      {
        id: 'task-keyframe',
        key: 'video_keyframe_generation',
        type: 'VIDEO_KEYFRAME_DISCOVERY',
        priority: 60,
        config: {
          minDuration: 30,
          maxDuration: null,
          includePaths: ['series'],
          excludePaths: [],
          statuses: ['MISSING']
        }
      }
    ]
    const harness = createDatabase(tasks)
    const now = new Date('2026-06-01T17:00:00.000Z')

    const result = await runScheduleMaterializerTick(now, {
      cutoverEnabled: true,
      database: harness.database as never,
      ensureDefaults: ensureDefaultsMock
    })

    expect(result).toMatchObject({
      mode: 'CENTRAL',
      scheduledForDate: '2026-06-02',
      windowState: 'OPEN',
      requiresDispatcherExpiryCleanup: false
    })
    expect(result.decisions.map((decision) => decision.action)).toEqual(['materialized', 'materialized'])
    expect(enqueueJobMock).toHaveBeenCalledTimes(2)
    expect(enqueueJobMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        triggerSource: 'SCHEDULE',
        scheduledTaskId: 'task-cleanup',
        scheduledForDate: '2026-06-02',
        priority: 120,
        payload: {},
        availableAt: new Date('2026-06-01T16:00:00.000Z'),
        deadlineAt: new Date('2026-06-02T00:00:00.000Z')
      }),
      expect.any(Object),
      expect.any(Function)
    )
    expect(enqueueJobMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        priority: 160,
        payload: expect.objectContaining({
          trigger: 'schedule',
          previewOnly: false,
          filter: expect.objectContaining({ minDuration: 30, statuses: ['MISSING'] })
        })
      }),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('serializes concurrent ticks and creates only one job for the task and date', async () => {
    const harness = createDatabase([
      {
        id: 'task-1',
        key: 'webp_animation_scan',
        type: 'WEBP_ANIMATION_SCAN',
        priority: 30,
        config: null
      }
    ])
    const now = new Date('2026-06-01T18:00:00.000Z')
    const dependencies = {
      cutoverEnabled: true,
      database: harness.database as never,
      ensureDefaults: ensureDefaultsMock
    }

    const [first, second] = await Promise.all([
      runScheduleMaterializerTick(now, dependencies),
      runScheduleMaterializerTick(now, dependencies)
    ])

    expect(enqueueJobMock).toHaveBeenCalledTimes(1)
    expect(harness.queryRaw).toHaveBeenCalledTimes(2)
    expect(first.decisions[0]?.action).toBe('materialized')
    expect(second.decisions[0]?.action).toBe('existing')
  })

  it('materializes weekly reconciliation only on Shanghai Monday and keeps it dry-run', async () => {
    const task = {
      id: 'task-weekly-gc',
      key: 'derived_media_gc_reconciliation',
      type: 'DERIVED_MEDIA_GC',
      priority: 71,
      config: null
    }
    const dailyTask = {
      id: 'task-daily-gc',
      key: 'derived_media_gc',
      type: 'DERIVED_MEDIA_GC',
      priority: 70,
      config: null
    }
    const mondayHarness = createDatabase([dailyTask, task])
    const monday = new Date('2026-06-07T16:01:00.000Z')

    const first = await runScheduleMaterializerTick(monday, {
      cutoverEnabled: true,
      database: mondayHarness.database as never,
      ensureDefaults: ensureDefaultsMock
    })
    const duplicate = await runScheduleMaterializerTick(monday, {
      cutoverEnabled: true,
      database: mondayHarness.database as never,
      ensureDefaults: ensureDefaultsMock
    })

    expect(first).toMatchObject({ scheduledForDate: '2026-06-08' })
    expect(first.decisions.map((decision) => decision.action)).toEqual(['materialized', 'materialized'])
    expect(duplicate.decisions.map((decision) => decision.action)).toEqual(['existing', 'existing'])
    expect(enqueueJobMock).toHaveBeenCalledTimes(2)
    expect(enqueueJobMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ payload: { dryRun: false, reconcile: false } }),
      expect.any(Object),
      expect.any(Function)
    )
    expect(enqueueJobMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ payload: { dryRun: true, reconcile: true } }),
      expect.any(Object),
      expect.any(Function)
    )

    enqueueJobMock.mockClear()
    const tuesdayHarness = createDatabase([task])
    const ordinaryDay = await runScheduleMaterializerTick(new Date('2026-06-08T16:01:00.000Z'), {
      cutoverEnabled: true,
      database: tuesdayHarness.database as never,
      ensureDefaults: ensureDefaultsMock
    })
    expect(ordinaryDay).toMatchObject({ scheduledForDate: '2026-06-09' })
    expect(ordinaryDay.decisions[0]).toEqual({
      key: task.key,
      type: task.type,
      action: 'skipped',
      reason: 'not_scheduled_today'
    })
    expect(enqueueJobMock).not.toHaveBeenCalled()
  })

  it('returns the dispatcher expiry boundary at and after 08:00 without enqueueing', async () => {
    const result = await runScheduleMaterializerTick(new Date('2026-06-02T00:00:00.000Z'), {
      cutoverEnabled: true
    })

    expect(result).toMatchObject({
      mode: 'CENTRAL',
      windowState: 'CLOSED',
      requiresDispatcherExpiryCleanup: true,
      decisions: []
    })
    expect(enqueueJobMock).not.toHaveBeenCalled()
    expect(ensureDefaultsMock).not.toHaveBeenCalled()
  })

  it('keeps legacy scheduling behavior by default and logs the detached-work boundary', async () => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'false')
    const result = await runScheduleMaterializerTick(new Date('2026-06-01T18:00:00.000Z'), {
      runLegacyTick: legacyTickMock
    })

    expect(legacyTickMock).toHaveBeenCalledOnce()
    expect(enqueueJobMock).not.toHaveBeenCalled()
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'scheduler.tick.legacy_dispatch_path',
      expect.objectContaining({ centralDispatcherCutoverEnabled: false })
    )
    expect(result.mode).toBe('LEGACY')
  })
})
