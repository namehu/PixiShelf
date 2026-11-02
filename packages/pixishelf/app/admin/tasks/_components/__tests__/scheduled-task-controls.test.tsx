import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledTaskView } from '../task-ui'

type ScheduleUpdate = { key: string; enabled?: boolean; priority?: number; config?: unknown }

const mocks = vi.hoisted(() => {
  const fetchTasks = vi.fn<() => Promise<ScheduledTaskView[]>>()
  const updateTask = vi.fn<(input: ScheduleUpdate) => Promise<{ success: boolean }>>()
  const replace = vi.fn()
  const errorToast = vi.fn()
  const procedures = new Map()
  const trpc = {
    job: new Proxy(
      {},
      {
        get: (_target, name: string) => {
          if (!procedures.has(name)) {
            procedures.set(name, {
              queryKey: () => [name],
              queryOptions: (_input: unknown, options: object = {}) => ({
                queryKey: [name],
                queryFn: name === 'listScheduledTasks' ? fetchTasks : async () => null,
                ...options
              }),
              mutationOptions: (options: object) => ({
                mutationFn: name === 'updateScheduledTask' ? updateTask : async () => ({}),
                ...options
              })
            })
          }
          return procedures.get(name)
        }
      }
    )
  }
  return { trpc, fetchTasks, updateTask, replace, errorToast, expandedTask: 'none' }
})

vi.mock('@/lib/trpc', () => ({ useTRPC: () => mocks.trpc }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => '/admin/tasks',
  useSearchParams: () => new URLSearchParams({ task: mocks.expandedTask })
}))
vi.mock('../../../_components/background-job-event-provider', () => ({
  useBackgroundJobEventSubscription: () => ({ status: 'connected', items: [], readyVersion: 0, resetVersion: 0 })
}))
vi.mock('../video-streaming-optimization-section', () => ({ VideoStreamingOptimizationSection: () => null }))
vi.mock('../background-task-console', () => ({ BackgroundTaskConsole: () => null }))
vi.mock('@/components/shared/global-confirm', () => ({ confirm: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: mocks.errorToast, success: vi.fn() } }))

import { MaintenanceCard } from '../maintenance-card'

const plans = [
  ['trigger_log_retention_cleanup', 'TRIGGER_LOG_RETENTION_CLEANUP'],
  ['archive_maintenance_reconcile', 'ARCHIVE_MAINTENANCE'],
  ['archive_intake_retention_cleanup', 'ARCHIVE_INTAKE_RETENTION_CLEANUP'],
  ['job_event_retention_cleanup', 'JOB_EVENT_RETENTION_CLEANUP'],
  ['scan_run_retention_cleanup', 'SCAN_RUN_RETENTION_CLEANUP'],
  ['webp_animation_scan', 'WEBP_ANIMATION_SCAN'],
  ['animation_duration_probe', 'ANIMATION_DURATION_PROBE'],
  ['video_media_probe', 'VIDEO_MEDIA_PROBE'],
  ['video_chapter_preview_generation', 'VIDEO_CHAPTER_PREVIEW_GENERATION'],
  ['video_keyframe_generation', 'VIDEO_KEYFRAME_DISCOVERY'],
  ['derived_media_gc', 'DERIVED_MEDIA_GC'],
  ['derived_media_gc_reconciliation', 'DERIVED_MEDIA_GC']
] as const

function tasks(): ScheduledTaskView[] {
  return plans.map(([key, type], index) => ({
    key,
    type,
    name: key,
    description: '计划说明',
    enabled: index < 3,
    priority: 70,
    scheduleMode: 'DAILY',
    timezone: 'Asia/Shanghai',
    lastMaterializedAt: null,
    lastMaterializedDate: null,
    lastJobId: null,
    lastJobStatus: null,
    nextRunAt: '2026-11-03 00:00 Asia/Shanghai',
    config: key === 'video_keyframe_generation' ? { minDuration: 120, includePaths: ['original'] } : null
  }))
}

const clients: QueryClient[] = []
function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 }, mutations: { retry: false } }
  })
  clients.push(client)
  const content = () => (
    <QueryClientProvider client={client}>
      <MaintenanceCard />
    </QueryClientProvider>
  )
  const view = render(content())
  return { client, view, rerender: () => view.rerender(content()) }
}

function switchFor(key: string) {
  return screen.getByRole('switch', { name: `${key}自动计划` }) as HTMLButtonElement
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((success, failure) => {
    resolve = success
    reject = failure
  })
  return { promise, resolve, reject }
}

describe('scheduled task controls with shared query state', () => {
  let serverTasks: ScheduledTaskView[]
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.expandedTask = 'none'
    serverTasks = tasks()
    mocks.fetchTasks.mockReset().mockImplementation(async () => structuredClone(serverTasks))
    mocks.updateTask.mockReset().mockImplementation(async (input) => {
      serverTasks = serverTasks.map((task) => (task.key === input.key ? { ...task, ...input } : task))
      return { success: true }
    })
  })
  afterEach(() => {
    cleanup()
    clients.splice(0).forEach((client) => client.clear())
  })

  it('exposes all 12 independent switches while collapsed and leaves manual cards unchanged', async () => {
    const { view } = renderCard()
    await screen.findByRole('switch', { name: 'video_keyframe_generation自动计划' })
    expect(screen.getAllByRole('switch')).toHaveLength(12)
    expect(screen.getByText('自动计划：已开启 3 / 共 12 项')).toBeTruthy()
    expect(screen.getAllByText(/上海时间 00:00–08:00 按优先级依次执行/)).toHaveLength(1)
    expect(screen.getByText('每周一')).toBeTruthy()
    for (const [key] of plans) {
      const control = switchFor(key)
      expect(control.parentElement?.closest('button')).toBeNull()
      expect(control.closest('article')?.querySelector('[aria-expanded="false"]')).toBeTruthy()
    }
    expect(view.container.querySelector('#meta-source')?.querySelector('[role="switch"]')).toBeNull()
    expect(screen.queryByLabelText('优先级')).toBeNull()

    fireEvent.click(switchFor('webp_animation_scan'))
    await waitFor(() =>
      expect(mocks.updateTask).toHaveBeenCalledWith({ key: 'webp_animation_scan', enabled: true }, expect.anything())
    )
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('优先级')).toBeNull()
    await waitFor(() => expect(screen.getByText('自动计划：已开启 4 / 共 12 项')).toBeTruthy())

    fireEvent.click(within(view.container.querySelector('#image-animation')!).getByRole('button', { expanded: false }))
    expect(mocks.replace).toHaveBeenCalledWith('/admin/tasks?task=image-animation', { scroll: false })
  })

  it('keeps pending switches local and allows different cards to save in parallel', async () => {
    const first = deferred<{ success: boolean }>()
    const second = deferred<{ success: boolean }>()
    mocks.updateTask.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    renderCard()
    await screen.findByRole('switch', { name: 'webp_animation_scan自动计划' })
    fireEvent.click(switchFor('webp_animation_scan'))
    await waitFor(() => expect(switchFor('webp_animation_scan').disabled).toBe(true))
    expect(switchFor('video_media_probe').disabled).toBe(false)
    fireEvent.click(switchFor('video_media_probe'))
    await waitFor(() => expect(mocks.updateTask).toHaveBeenCalledTimes(2))
    expect(screen.getAllByText('保存中…')).toHaveLength(2)
    expect(switchFor('webp_animation_scan').getAttribute('aria-checked')).toBe('true')

    serverTasks = serverTasks.map((task) =>
      ['webp_animation_scan', 'video_media_probe'].includes(task.key) ? { ...task, enabled: true } : task
    )
    await act(async () => {
      first.resolve({ success: true })
      second.resolve({ success: true })
    })
    await waitFor(() => expect(screen.queryByText('保存中…')).toBeNull())
    expect(switchFor('video_media_probe').getAttribute('aria-checked')).toBe('true')
    expect(switchFor('webp_animation_scan').getAttribute('aria-checked')).toBe('true')
  })

  it('restores the server value and reports failure without expanding the card', async () => {
    const saving = deferred<{ success: boolean }>()
    mocks.updateTask.mockReturnValueOnce(saving.promise)
    renderCard()
    await screen.findByRole('switch', { name: 'trigger_log_retention_cleanup自动计划' })
    fireEvent.click(switchFor('trigger_log_retention_cleanup'))
    await waitFor(() => expect(switchFor('trigger_log_retention_cleanup').getAttribute('aria-checked')).toBe('false'))
    await act(async () => saving.reject(new Error('保存失败')))
    await waitFor(() => expect(switchFor('trigger_log_retention_cleanup').disabled).toBe(false))
    expect(switchFor('trigger_log_retention_cleanup').getAttribute('aria-checked')).toBe('true')
    expect(mocks.errorToast).toHaveBeenCalledWith('自动计划未保存：保存失败')
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('preserves priority and representative-frame drafts across toggle refresh, collapse, and separate saves', async () => {
    mocks.expandedTask = 'video-keyframes'
    const { client, rerender } = renderCard()
    await screen.findByRole('switch', { name: 'video_keyframe_generation自动计划' })
    const input = (await screen.findByLabelText('最小时长（分钟）')) as HTMLInputElement
    await waitFor(() => expect(input.value).toBe('2'))
    fireEvent.change(screen.getByLabelText('优先级'), { target: { value: '42' } })
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('包含目录'), { target: { value: 'unsaved-directory' } })
    fireEvent.click(switchFor('video_keyframe_generation'))
    await waitFor(() => expect(switchFor('video_keyframe_generation').disabled).toBe(false))
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect((screen.getByLabelText('优先级') as HTMLInputElement).value).toBe('42')
    expect(input.value).toBe('5')

    mocks.expandedTask = 'none'
    rerender()
    expect(screen.queryByLabelText('最小时长（分钟）')).toBeNull()
    mocks.expandedTask = 'video-keyframes'
    rerender()
    expect((screen.getByLabelText('最小时长（分钟）') as HTMLInputElement).value).toBe('5')
    expect((screen.getByLabelText('优先级') as HTMLInputElement).value).toBe('42')
    fireEvent.click(screen.getByRole('button', { name: '保存优先级' }))
    await waitFor(() =>
      expect(mocks.updateTask).toHaveBeenCalledWith(
        { key: 'video_keyframe_generation', priority: 42 },
        expect.anything()
      )
    )
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect((screen.getByLabelText('包含目录') as HTMLTextAreaElement).value).toBe('unsaved-directory')
    fireEvent.click(screen.getByRole('button', { name: '保存为自动规则' }))
    await waitFor(() =>
      expect(mocks.updateTask).toHaveBeenCalledWith(
        {
          key: 'video_keyframe_generation',
          config: {
            minDuration: 300,
            maxDuration: null,
            includePaths: ['unsaved-directory'],
            excludePaths: [],
            statuses: ['MISSING', 'STALE', 'FAILED']
          }
        },
        expect.anything()
      )
    )
    expect(mocks.updateTask.mock.calls.map(([input]) => Object.keys(input).sort())).toEqual([
      ['enabled', 'key'],
      ['key', 'priority'],
      ['config', 'key']
    ])
    expect(switchFor('video_keyframe_generation').getAttribute('aria-checked')).toBe('true')
  })

  it('shows unknown loading and retry states without inventing disabled plans', async () => {
    const initial = deferred<ScheduledTaskView[]>()
    mocks.fetchTasks.mockReturnValueOnce(initial.promise)
    renderCard()
    expect(screen.getByText('自动计划：读取中…')).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByText('自动计划：已关闭')).toBeNull()
    await act(async () => initial.reject(new Error('读取失败')))
    expect(await screen.findByRole('button', { name: '重试读取计划' })).toBeTruthy()
    expect(screen.getByText('自动计划：状态暂不可用')).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重试读取计划' }))
    expect(await screen.findAllByRole('switch')).toHaveLength(12)
  })
})
