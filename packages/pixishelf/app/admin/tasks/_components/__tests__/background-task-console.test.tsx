import type { JobDto, JobEventDto, JobStatus, WorkerHealthDto } from '@pixishelf/job-contracts'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BackgroundTaskConsole,
  BackgroundTaskConsoleView,
  type BackgroundControlsView,
  type BackgroundDashboardView
} from '../background-task-console'
import { formatBackgroundJobStatus, getWorkerHealth, getWorkerSummary, mergeJobEvents } from '../background-task-format'

const mocks = vi.hoisted(() => ({
  dashboardQuery: {
    data: undefined as BackgroundDashboardView | undefined,
    isPending: false,
    isError: false,
    isFetching: false,
    error: null as { message: string } | null,
    refetch: vi.fn()
  },
  eventQuery: {
    events: [] as JobEventDto[],
    isPending: false,
    isError: false,
    error: null as { message: string } | null,
    isPolling: false,
    refetch: vi.fn()
  },
  confirm: vi.fn()
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: null, isPending: false, isFetching: false, refetch: vi.fn() })
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({ job: { backgroundDetail: { queryOptions: () => ({}) } } })
}))

vi.mock('@/components/shared/global-confirm', () => ({ confirm: mocks.confirm }))

vi.mock('../use-background-dashboard', () => ({
  useBackgroundDashboard: () => mocks.dashboardQuery,
  useBackgroundJobDetail: () => ({
    data: null,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn()
  }),
  useBackgroundJobEvents: () => mocks.eventQuery,
  useBackgroundJobControls: () => createControls()
}))

const statuses: JobStatus[] = [
  'PENDING',
  'RETRY_WAIT',
  'RUNNING',
  'PAUSING',
  'PAUSED',
  'CANCELLING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'SKIPPED'
]

function createJob(status: JobStatus = 'PENDING', id = `job-${status.toLowerCase()}`): JobDto {
  return {
    id,
    type: 'VIDEO_MEDIA_PROBE',
    definitionVersion: 1,
    status,
    triggerSource: 'MANUAL',
    requestedByUserId: null,
    scheduledTaskId: null,
    scheduledForDate: null,
    idempotencyKey: null,
    payload: { path: '/selectable/video.mp4' },
    progress: status === 'COMPLETED' ? 100 : 42,
    stage: 'probe',
    message: '正在处理 /selectable/video.mp4',
    result: null,
    errorCode: status === 'FAILED' ? 'FFPROBE_FAILED' : null,
    error: status === 'FAILED' ? '无法读取 /selectable/video.mp4' : null,
    skipReason: status === 'SKIPPED' ? 'PRECONDITION_NOT_MET' : null,
    attempt: 1,
    maxAttempts: 3,
    parentJobId: null,
    queuePriority: 20,
    effectivePriority: 20,
    availableAt: '2026-08-17T02:00:00.000Z',
    deadlineAt: null,
    workerId: status === 'RUNNING' ? 'worker-a' : null,
    leaseToken: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    startedAt: status === 'RUNNING' ? '2026-08-17T02:01:00.000Z' : null,
    finishedAt: null,
    createdAt: '2026-08-17T02:00:00.000Z',
    updatedAt: '2026-08-17T02:01:00.000Z'
  }
}

function createWorker(
  status: WorkerHealthDto['status'] = 'READY',
  heartbeatAt = '2026-08-17T02:00:00.000Z'
): WorkerHealthDto {
  return {
    workerId: `worker-${status.toLowerCase()}`,
    status,
    serviceVersion: '1.2.3',
    hostname: 'pixishelf-worker',
    processId: 42,
    capabilities: [{ jobType: 'VIDEO_MEDIA_PROBE', definitionVersions: [1] }],
    startedAt: '2026-08-17T01:00:00.000Z',
    heartbeatAt,
    lastError: status === 'DEGRADED' ? 'ffmpeg unavailable' : null,
    updatedAt: heartbeatAt
  }
}

function createDashboard(overrides: Partial<BackgroundDashboardView> = {}): BackgroundDashboardView {
  const counts = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<JobStatus, number>
  return { counts, queuedCount: 0, activeCount: 0, runningJob: null, recentJobs: [], workers: [], ...overrides }
}

function createControls(): BackgroundControlsView {
  const mutation = () => ({ isPending: false, mutate: vi.fn() })
  return { cancel: mutation(), pause: mutation(), resume: mutation(), retry: mutation(), priority: mutation() }
}

describe('background task console', () => {
  beforeEach(() => {
    mocks.dashboardQuery.data = undefined
    mocks.dashboardQuery.isPending = false
    mocks.dashboardQuery.isError = false
    mocks.dashboardQuery.isFetching = false
    mocks.dashboardQuery.error = null
    mocks.dashboardQuery.refetch.mockReset()
    mocks.eventQuery.events = []
    mocks.eventQuery.isPending = false
    mocks.eventQuery.isError = false
    mocks.eventQuery.error = null
    mocks.eventQuery.isPolling = false
    mocks.eventQuery.refetch.mockReset()
    mocks.confirm.mockReset()
  })

  afterEach(cleanup)

  it('keeps queued and completed counts distinct and exposes the empty queue', () => {
    const dashboard = createDashboard({ counts: { ...createDashboard().counts, COMPLETED: 8 }, queuedCount: 0 })
    render(
      <BackgroundTaskConsoleView
        dashboard={dashboard}
        selectedJob={null}
        selectedJobLoading={false}
        onSelectJob={vi.fn()}
        onRefresh={vi.fn()}
        refreshing={false}
        controls={createControls()}
      />
    )

    expect(screen.getByText('当前没有任务占用执行槽，队列中有 0 项等待。')).toBeTruthy()
    expect(screen.getByText('队列为空，还没有中央后台任务记录。')).toBeTruthy()
    expect(screen.getByText('已完成').parentElement?.textContent).toContain('8')
  })

  it('labels every runbook job state without treating queued work as complete', () => {
    expect(statuses.map((status) => formatBackgroundJobStatus(status))).toEqual([
      '排队中',
      '等待重试',
      '执行中',
      '暂停中',
      '已暂停',
      '取消中',
      '已完成',
      '失败',
      '已取消',
      '已跳过'
    ])
  })

  it('shows the single execution slot, worker health, and native keyboard-operable recent jobs', () => {
    const running = createJob('RUNNING')
    const selectJob = vi.fn()
    const dashboard = createDashboard({
      runningJob: running,
      recentJobs: [running],
      activeCount: 1,
      workers: [createWorker('READY', new Date().toISOString())]
    })
    const { container } = render(
      <BackgroundTaskConsoleView
        dashboard={dashboard}
        selectedJob={running}
        selectedJobLoading={false}
        onSelectJob={selectJob}
        onRefresh={vi.fn()}
        refreshing={false}
        controls={createControls()}
      />
    )

    expect(screen.getByText('唯一执行槽')).toBeTruthy()
    expect(screen.getByText('1 个可用')).toBeTruthy()
    const recentButton = screen.getByRole('button', { name: /视频媒体探测.*执行中/ })
    recentButton.focus()
    expect(document.activeElement).toBe(recentButton)
    expect(recentButton.tagName).toBe('BUTTON')
    fireEvent.click(recentButton)
    expect(selectJob).toHaveBeenCalledWith(running.id)
    expect(container.firstElementChild?.className).toContain('overflow-hidden')
    expect(container.innerHTML).toContain('lg:grid-cols')
    expect(container.innerHTML).toContain('min-w-0')
  })

  it('reports no worker, lifecycle states, and stale heartbeat semantics', () => {
    expect(getWorkerSummary([]).label).toBe('无 Worker')
    const now = new Date('2026-08-17T02:02:00.000Z').getTime()
    expect(getWorkerHealth(createWorker('STARTING'), now).stale).toBe(true)
    expect(getWorkerHealth(createWorker('READY', '2026-08-17T02:01:30.000Z'), now).healthy).toBe(true)
    expect(getWorkerHealth(createWorker('DEGRADED', '2026-08-17T02:01:30.000Z'), now).healthy).toBe(false)
    expect(getWorkerHealth(createWorker('STOPPING', '2026-08-17T02:01:30.000Z'), now).healthy).toBe(false)
  })

  it('keeps stale worker records in neutral collapsed history', () => {
    const current = { ...createWorker('READY', new Date().toISOString()), workerId: 'worker-current' }
    const historical = {
      ...createWorker('READY', '2026-08-17T02:00:00.000Z'),
      workerId: 'worker-historical'
    }
    render(
      <BackgroundTaskConsoleView
        dashboard={createDashboard({ workers: [current, historical] })}
        selectedJob={null}
        selectedJobLoading={false}
        onSelectJob={vi.fn()}
        onRefresh={vi.fn()}
        refreshing={false}
        controls={createControls()}
      />
    )

    expect(screen.getByText('1 个可用')).toBeTruthy()
    expect(screen.getByText('历史实例')).toBeTruthy()
    expect(screen.getByText('1 条 · 不参与任务执行')).toBeTruthy()
    expect(screen.queryByText('心跳陈旧')).toBeNull()
    expect(screen.getByText(/不会领取任务，并会按保留策略自动清理/)).toBeTruthy()
    expect(screen.getByText('历史实例').closest('details')?.open).toBe(false)
  })

  it('merges incremental events in bigint order without duplicates and renders selectable event data', () => {
    const base = {
      jobId: 'job-running',
      level: 'INFO' as const,
      attempt: 1,
      workerId: 'worker-a',
      stage: 'probe',
      progress: 50,
      message: '/selectable/video.mp4',
      data: { path: '/selectable/video.mp4' },
      createdAt: '2026-08-17T02:01:00.000Z'
    }
    const first: JobEventDto = { ...base, id: '9', type: 'job.started' }
    const second: JobEventDto = { ...base, id: '10', type: 'job.progress' }
    expect(mergeJobEvents([second], [first, second]).map((event) => event.id)).toEqual(['9', '10'])

    mocks.eventQuery.events = [first, second]
    const job = createJob('RUNNING', 'job-running')
    render(
      <BackgroundTaskConsoleView
        dashboard={createDashboard({ runningJob: job, recentJobs: [job] })}
        selectedJob={job}
        selectedJobLoading={false}
        onSelectJob={vi.fn()}
        onRefresh={vi.fn()}
        refreshing={false}
        controls={createControls()}
      />
    )
    expect(screen.getByText('开始执行')).toBeTruthy()
    expect(screen.getByText('进度更新')).toBeTruthy()
    expect(screen.getAllByText('/selectable/video.mp4').length).toBeGreaterThan(0)
  })

  it('segments event DOM above 50 while keeping earlier events available on demand', () => {
    const job = createJob('COMPLETED', 'job-long-events')
    mocks.eventQuery.events = Array.from(
      { length: 75 },
      (_, index): JobEventDto => ({
        id: String(index + 1),
        jobId: job.id,
        type: 'job.progress',
        level: 'INFO',
        attempt: 1,
        workerId: 'worker-a',
        stage: 'probe',
        progress: Math.min(index, 100),
        message: `事件消息 ${index + 1}`,
        data: null,
        createdAt: '2026-08-17T02:01:00.000Z'
      })
    )
    const controls = createControls()
    const { rerender } = render(
      <BackgroundTaskConsoleView
        dashboard={createDashboard({ recentJobs: [job] })}
        selectedJob={job}
        selectedJobLoading={false}
        onSelectJob={vi.fn()}
        onRefresh={vi.fn()}
        refreshing={false}
        controls={controls}
      />
    )

    expect(screen.getByText('已保存 75 条事件，当前显示最近 50 条。')).toBeTruthy()
    expect(screen.queryByText('事件消息 1')).toBeNull()
    expect(screen.getByText('事件消息 75')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '显示更早事件（25）' }))
    expect(screen.getByText('事件消息 1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /显示更早事件/ })).toBeNull()

    const secondJob = createJob('COMPLETED', 'job-long-events-b')
    mocks.eventQuery.events = Array.from(
      { length: 75 },
      (_, index): JobEventDto => ({
        ...mocks.eventQuery.events[index]!,
        jobId: secondJob.id,
        message: `B 事件消息 ${index + 1}`
      })
    )
    rerender(
      <BackgroundTaskConsoleView
        dashboard={createDashboard({ recentJobs: [secondJob] })}
        selectedJob={secondJob}
        selectedJobLoading={false}
        onSelectJob={vi.fn()}
        onRefresh={vi.fn()}
        refreshing={false}
        controls={controls}
      />
    )
    expect(screen.getByText('已保存 75 条事件，当前显示最近 50 条。')).toBeTruthy()
    expect(screen.queryByText('B 事件消息 1')).toBeNull()
    expect(screen.getByText('B 事件消息 75')).toBeTruthy()
  })

  it('renders query errors and retries the dashboard request', () => {
    mocks.dashboardQuery.isError = true
    mocks.dashboardQuery.error = { message: 'database unavailable' }
    render(<BackgroundTaskConsole />)
    expect(screen.getByText('无法读取后台队列')).toBeTruthy()
    expect(screen.getByText('database unavailable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(mocks.dashboardQuery.refetch).toHaveBeenCalledOnce()
  })

  it('renders detail errors with an explicit retry while retaining the dashboard snapshot', () => {
    const job = createJob('RUNNING')
    const retry = vi.fn()
    render(
      <BackgroundTaskConsoleView
        dashboard={createDashboard({ runningJob: job, recentJobs: [job] })}
        selectedJob={job}
        selectedJobLoading={false}
        onSelectJob={vi.fn()}
        onRefresh={vi.fn()}
        refreshing={false}
        controls={createControls()}
        detailError={{ message: 'detail unavailable' }}
        onRetryDetail={retry}
      />
    )
    expect(screen.getByText('任务详情刷新失败：detail unavailable')).toBeTruthy()
    expect(screen.getByText(/当前显示最近一次队列快照/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试任务详情' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('retries event query errors and confirms destructive cancellation before mutating', () => {
    const job = createJob('RUNNING')
    const controls = createControls()
    mocks.eventQuery.isError = true
    mocks.eventQuery.error = { message: 'event stream unavailable' }
    render(
      <BackgroundTaskConsoleView
        dashboard={createDashboard({ runningJob: job, recentJobs: [job] })}
        selectedJob={job}
        selectedJobLoading={false}
        onSelectJob={vi.fn()}
        onRefresh={vi.fn()}
        refreshing={false}
        controls={controls}
      />
    )

    expect(screen.getByText('事件读取失败：event stream unavailable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试事件查询' }))
    expect(mocks.eventQuery.refetch).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(controls.cancel.mutate).not.toHaveBeenCalled()
    const confirmRequest = mocks.confirm.mock.calls[0]?.[0] as { description: string; onConfirm: () => void }
    expect(confirmRequest.description).toContain('已经完成并发布的产物会保留')
    confirmRequest.onConfirm()
    expect(controls.cancel.mutate).toHaveBeenCalledWith({ jobId: job.id })
  })

  it('validates priority against the trigger-specific range before submitting', () => {
    const job = createJob('PENDING')
    const controls = createControls()
    render(
      <BackgroundTaskConsoleView
        dashboard={createDashboard({ recentJobs: [job], queuedCount: 1 })}
        selectedJob={job}
        selectedJobLoading={false}
        onSelectJob={vi.fn()}
        onRefresh={vi.fn()}
        refreshing={false}
        controls={controls}
      />
    )
    const input = screen.getByLabelText('队列优先级')
    expect(input.getAttribute('name')).toBe(`background-job-${job.id}-priority`)
    expect(input.getAttribute('autocomplete')).toBe('off')
    expect(input.getAttribute('inputmode')).toBe('numeric')
    fireEvent.change(input, { target: { value: '120' } })
    expect(screen.getByText(/手动\/重试任务允许 0–99/).className).toContain('text-destructive')
    expect((screen.getByRole('button', { name: '更新优先级' }) as HTMLButtonElement).disabled).toBe(true)
    expect(controls.priority.mutate).not.toHaveBeenCalled()
  })
})
