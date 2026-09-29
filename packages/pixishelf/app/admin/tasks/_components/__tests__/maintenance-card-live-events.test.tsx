import type { JobEventDto, JobEventStreamItem, JobStatus } from '@pixishelf/job-contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledTaskView } from '../task-ui'

const mocks = vi.hoisted(() => {
  const fetchTasks = vi.fn<() => Promise<ScheduledTaskView[]>>()
  const procedure = (name: string) => ({
    queryKey: () => [name],
    queryOptions: (_input: unknown, options: object) => ({
      queryKey: [name],
      queryFn: name === 'listScheduledTasks' ? fetchTasks : async () => null,
      ...options
    }),
    mutationOptions: (options: object) => ({ mutationFn: async () => ({}), ...options })
  })
  const procedures = new Map<string, ReturnType<typeof procedure>>()
  const trpc = {
    job: new Proxy(
      {},
      {
        get: (_target, name: string) => {
          if (!procedures.has(name)) procedures.set(name, procedure(name))
          return procedures.get(name)
        }
      }
    )
  }
  return {
    trpc,
    fetchTasks,
    expandedTask: 'scheduled-job_event_retention_cleanup',
    live: { status: 'connected', items: [] as JobEventStreamItem[], readyVersion: 1, resetVersion: 0 }
  }
})

vi.mock('@/lib/trpc', () => ({ useTRPC: () => mocks.trpc }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/admin/tasks',
  useSearchParams: () => new URLSearchParams({ task: mocks.expandedTask })
}))
vi.mock('../../../_components/background-job-event-provider', () => ({
  useBackgroundJobEventSubscription: () => mocks.live
}))
vi.mock('../video-keyframe-section', () => ({ VideoKeyframeSection: () => null }))
vi.mock('../video-streaming-optimization-section', () => ({ VideoStreamingOptimizationSection: () => null }))
vi.mock('../background-task-console', () => ({ BackgroundTaskConsole: () => null }))
vi.mock('@/components/shared/global-confirm', () => ({ confirm: vi.fn() }))

import { MaintenanceCard } from '../maintenance-card'

function scheduledTask(overrides: Partial<ScheduledTaskView> = {}): ScheduledTaskView {
  return {
    key: 'job_event_retention_cleanup',
    type: 'JOB_EVENT_RETENTION_CLEANUP',
    name: '清理后台任务事件',
    description: 'test',
    enabled: true,
    scheduleMode: 'DAILY',
    time: '02:20',
    timezone: 'Asia/Shanghai',
    priority: 18,
    mutexKey: 'audit-maintenance',
    lastTriggeredAt: null,
    lastTriggeredDate: null,
    lastJobId: 'previous-job',
    lastJobStatus: 'COMPLETED',
    nextRunAt: null,
    ...overrides
  }
}

function streamItem(id: string, type: JobEventDto['type'], status: JobStatus): JobEventStreamItem {
  const timestamp = '2026-09-05T00:00:00.000Z'
  return {
    event: {
      id,
      jobId: 'new-job',
      type,
      level: 'INFO',
      attempt: 1,
      workerId: 'worker-a',
      stage: null,
      progress: 5,
      message: null,
      data: null,
      createdAt: timestamp
    },
    job: {
      id: 'new-job',
      type: 'JOB_EVENT_RETENTION_CLEANUP',
      executionLane: 'BACKGROUND_WRITER',
      status,
      progress: 5,
      progressData: null,
      stage: null,
      message: null,
      errorCode: null,
      attempt: 1,
      parentJobId: null,
      heartbeatAt: timestamp,
      startedAt: timestamp,
      finishedAt: null,
      updatedAt: timestamp
    }
  }
}

describe('maintenance card live schedule updates', () => {
  beforeEach(() => {
    mocks.fetchTasks.mockReset()
    mocks.live.items = []
    mocks.expandedTask = 'scheduled-job_event_retention_cleanup'
  })
  afterEach(cleanup)

  it.each([
    ['job.queued', 'PENDING', '等待执行…'],
    ['job.started', 'RUNNING', '执行中…'],
    ['job.paused', 'PAUSED', '任务已暂停']
  ] as const)('discovers the new scheduled job on %s without polling', async (eventType, status, actionLabel) => {
    mocks.fetchTasks.mockResolvedValue([scheduledTask()])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
      <QueryClientProvider client={client}>
        <MaintenanceCard />
      </QueryClientProvider>
    )
    await screen.findByRole('button', { name: '运行只读预检' })
    await waitFor(() => expect(client.isFetching()).toBe(0))
    const initialRequests = mocks.fetchTasks.mock.calls.length

    mocks.fetchTasks.mockResolvedValue([scheduledTask({ lastJobId: 'new-job', lastJobStatus: status })])
    // The last event in a delivered batch need not be the lifecycle event.
    mocks.live.items = [streamItem('100', eventType, status), streamItem('101', 'job.progress', status)]
    view.rerender(
      <QueryClientProvider client={client}>
        <MaintenanceCard />
      </QueryClientProvider>
    )
    const action = await screen.findByRole('button', { name: actionLabel })
    expect(action.hasAttribute('disabled')).toBe(true)
    expect(client.getQueryData<ScheduledTaskView[]>(['listScheduledTasks'])?.[0]?.lastJobId).toBe('new-job')
    expect(mocks.fetchTasks).toHaveBeenCalledTimes(initialRequests + 1)

    mocks.live.items = [...mocks.live.items, streamItem('102', 'job.progress', status)]
    view.rerender(
      <QueryClientProvider client={client}>
        <MaintenanceCard />
      </QueryClientProvider>
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.fetchTasks).toHaveBeenCalledTimes(initialRequests + 1)
  })

  it('reconciles a lifecycle event received before the initial schedule query finishes', async () => {
    let resolveInitial!: (tasks: ScheduledTaskView[]) => void
    mocks.fetchTasks
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInitial = resolve
          })
      )
      .mockResolvedValue([scheduledTask({ lastJobId: 'new-job', lastJobStatus: 'RUNNING' })])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
      <QueryClientProvider client={client}>
        <MaintenanceCard />
      </QueryClientProvider>
    )
    await waitFor(() => expect(mocks.fetchTasks).toHaveBeenCalledOnce())

    mocks.live.items = [streamItem('100', 'job.started', 'RUNNING')]
    view.rerender(
      <QueryClientProvider client={client}>
        <MaintenanceCard />
      </QueryClientProvider>
    )
    await act(async () => {
      resolveInitial([scheduledTask()])
    })

    expect((await screen.findByRole('button', { name: '执行中…' })).hasAttribute('disabled')).toBe(true)
    expect(mocks.fetchTasks).toHaveBeenCalledTimes(2)
  })

  it('refreshes all schedules sharing a type without assigning the live job to the wrong schedule', async () => {
    mocks.expandedTask = 'scheduled-derived_media_gc_reconciliation'
    const formal = scheduledTask({ key: 'derived_media_gc', type: 'DERIVED_MEDIA_GC' })
    const preview = scheduledTask({
      key: 'derived_media_gc_reconciliation',
      type: 'DERIVED_MEDIA_GC',
      lastJobId: null,
      lastJobStatus: null
    })
    mocks.fetchTasks.mockResolvedValue([formal, preview])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
      <QueryClientProvider client={client}>
        <MaintenanceCard />
      </QueryClientProvider>
    )
    await screen.findByRole('button', { name: '开始只读核对' })
    await waitFor(() => expect(client.isFetching()).toBe(0))
    const initialRequests = mocks.fetchTasks.mock.calls.length

    const currentPreview = { ...preview, lastJobId: 'new-job', lastJobStatus: 'RUNNING' as const }
    mocks.fetchTasks.mockResolvedValue([formal, currentPreview])
    const item = streamItem('100', 'job.started', 'RUNNING')
    mocks.live.items = [{ ...item, job: { ...item.job, type: 'DERIVED_MEDIA_GC' } }]
    view.rerender(
      <QueryClientProvider client={client}>
        <MaintenanceCard />
      </QueryClientProvider>
    )
    await screen.findByRole('button', { name: '执行中…' })

    expect(client.getQueryData(['listScheduledTasks'])).toEqual([formal, currentPreview])
    mocks.expandedTask = 'scheduled-derived_media_gc'
    view.rerender(
      <QueryClientProvider client={client}>
        <MaintenanceCard />
      </QueryClientProvider>
    )
    expect(screen.getByRole('button', { name: '执行到期清理' }).hasAttribute('disabled')).toBe(false)
    expect(mocks.fetchTasks).toHaveBeenCalledTimes(initialRequests + 1)
  })
})
