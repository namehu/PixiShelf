import type { JobEventStreamItem } from '@pixishelf/job-contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { useRef, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackgroundHistoryItem } from '@/services/background-task/job-history-service'
import { BackgroundFailureList } from '../background-failure-list'
import { useBackgroundFailures } from '../use-background-failures'
import type { BackgroundControlsView } from '../background-task-console'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  head: vi.fn(),
  confirm: vi.fn(),
  live: { items: [] as JobEventStreamItem[], resetVersion: 0 }
}))
vi.mock('../../../_components/background-job-event-provider', () => ({
  useOptionalBackgroundJobEventSubscription: () => mocks.live
}))
vi.mock('@/components/shared/global-confirm', () => ({ confirm: mocks.confirm }))
vi.mock('@/components/privacy/privacy-sensitive-text', () => ({
  PrivacySensitiveText: ({ children }: { children: ReactNode }) => children
}))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    job: {
      backgroundFailures: {
        infiniteQueryOptions: (input: unknown, options: object) => ({
          queryKey: [['job', 'backgroundFailures'], { input, type: 'infinite' }],
          initialPageParam: undefined,
          queryFn: ({ pageParam }: { pageParam?: string }) => mocks.list(input, pageParam),
          ...options
        }),
        queryOptions: (input: unknown, options: object) => ({
          queryKey: [['job', 'backgroundFailures'], { input, type: 'query' }],
          queryFn: () => mocks.head(input),
          ...options
        })
      }
    }
  })
}))

const clients: QueryClient[] = []
function wrapper({ children }: { children: ReactNode }) {
  const ref = useRef<QueryClient | null>(null)
  if (!ref.current) {
    ref.current = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    clients.push(ref.current)
  }
  return <QueryClientProvider client={ref.current}>{children}</QueryClientProvider>
}
function item(index: number): BackgroundHistoryItem {
  return {
    id: `failure-${index}`,
    type: 'SCAN',
    label: '图库扫描',
    status: 'FAILED',
    triggerSource: 'MANUAL',
    parentJobId: null,
    progress: 0,
    stage: null,
    message: null,
    errorCode: 'SCAN_FAILED',
    error: '读取失败',
    effectivePriority: 10,
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z'
  }
}
function controls(): BackgroundControlsView {
  const mutation = () => ({ isPending: false, mutate: vi.fn() })
  return {
    cancel: mutation(),
    pause: mutation(),
    resume: mutation(),
    retry: mutation(),
    acknowledge: mutation(),
    priority: mutation(),
    acknowledgeMany: {
      ...mutation(),
      mutateAsync: vi.fn().mockResolvedValue({ acknowledgedCount: 200, skippedCount: 0 })
    }
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.live = { items: [], resetVersion: 0 }
  mocks.list.mockResolvedValue({ items: [item(0)], nextCursor: null })
  mocks.head.mockResolvedValue({ items: [item(0)], nextCursor: null })
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(640)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  HTMLElement.prototype.scrollTo = vi.fn()
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('failure browsing state', () => {
  it('loads fifty at a time, preserves selection across pages and caps it at 100 without selecting new rows', async () => {
    mocks.list
      .mockResolvedValueOnce({ items: Array.from({ length: 50 }, (_, i) => item(i)), nextCursor: 'next' })
      .mockResolvedValueOnce({ items: Array.from({ length: 70 }, (_, i) => item(i + 50)), nextCursor: null })
    const { result } = renderHook(() => useBackgroundFailures(true, 120), { wrapper })
    await waitFor(() => expect(result.current.items).toHaveLength(50))
    expect(mocks.list).toHaveBeenCalledWith({ limit: 50 }, undefined)
    act(() => result.current.selectLoaded(true))
    await act(() => result.current.query.fetchNextPage())
    await waitFor(() => expect(result.current.items).toHaveLength(120))
    expect(result.current.selectedIds.size).toBe(50)
    act(() => result.current.selectLoaded(true))
    expect(result.current.selectedIds.size).toBe(100)
    act(() => result.current.toggle('failure-110', true))
    expect(result.current.selectedIds.has('failure-110')).toBe(false)
    act(() => {
      result.current.toggle('failure-0', false)
      result.current.toggle('failure-110', true)
    })
    expect(result.current.selectedIds.has('failure-110')).toBe(true)
  })

  it('preserves state while inactive, prunes only after a successful manual refresh and retains selection on errors', async () => {
    mocks.list.mockResolvedValueOnce({ items: [item(0), item(1)], nextCursor: null })
    const { result, rerender } = renderHook(({ enabled }) => useBackgroundFailures(enabled, 2), {
      wrapper,
      initialProps: { enabled: true }
    })
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    act(() => {
      result.current.selectLoaded(true)
      result.current.browsing.current.offset = 400
    })
    rerender({ enabled: false })
    rerender({ enabled: true })
    expect(result.current.selectedIds.size).toBe(2)
    expect(result.current.browsing.current.offset).toBe(400)
    expect(mocks.list).toHaveBeenCalledTimes(1)
    mocks.list.mockRejectedValueOnce(new Error('offline'))
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.query.isError).toBe(true))
    expect(result.current.selectedIds.size).toBe(2)
    mocks.list.mockResolvedValueOnce({ items: [item(1)], nextCursor: null })
    await act(() => result.current.query.refetch())
    await waitFor(() => expect([...result.current.selectedIds]).toEqual(['failure-1']))
  })

  it('announces changed counts without inserting or selecting new failures and disables inactive polling', async () => {
    const { result, rerender } = renderHook(({ enabled, count }) => useBackgroundFailures(enabled, count), {
      wrapper,
      initialProps: { enabled: true, count: 1 }
    })
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true))
    act(() => result.current.selectLoaded(true))
    rerender({ enabled: true, count: 2 })
    expect(result.current.hasUpdates).toBe(true)
    expect(result.current.items).toHaveLength(1)
    expect([...result.current.selectedIds]).toEqual(['failure-0'])
    rerender({ enabled: false, count: 2 })
    vi.useFakeTimers()
    const calls = mocks.head.mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(mocks.head).toHaveBeenCalledTimes(calls)
  })
  it('detects a newly failed older job even when total count and the newest record stay unchanged', async () => {
    const { result, rerender } = renderHook(() => useBackgroundFailures(true, 1), { wrapper })
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true))
    expect(result.current.hasUpdates).toBe(false)
    mocks.live.items = [
      {
        event: {
          id: '1',
          jobId: 'older-failure',
          type: 'job.failed',
          level: 'ERROR',
          attempt: 1,
          workerId: null,
          stage: null,
          progress: 0,
          message: 'failed',
          data: null,
          createdAt: item(0).createdAt
        },
        job: {
        id: 'older-failure',
        type: 'SCAN',
        parentJobId: null,
        status: 'FAILED',
          executionLane: 'BACKGROUND_WRITER',
          progress: 0,
          progressData: null,
          stage: null,
          message: 'failed',
          errorCode: 'SCAN_FAILED',
          attempt: 1,
          heartbeatAt: null,
          startedAt: null,
          finishedAt: null,
          updatedAt: item(0).updatedAt
        }
      }
    ]
    rerender()
    expect(result.current.hasUpdates).toBe(true)
    expect(result.current.items.map(({ id }) => id)).toEqual(['failure-0'])
  })
})

describe('failure bulk controls', () => {
  function Harness({
    actions,
    count = 200,
    show = true
  }: {
    actions: BackgroundControlsView
    count?: number
    show?: boolean
  }) {
    const scrollRef = useRef<HTMLDivElement>(null)
    const failures = useBackgroundFailures(show, count)
    if (!show) return null
    return (
      <div ref={scrollRef} data-testid="failure-scroll">
        <BackgroundFailureList
          failures={failures}
          totalCount={count}
          controls={actions}
          scrollRef={scrollRef}
          onSelectJob={vi.fn()}
          onViewHistory={vi.fn()}
        />
      </div>
    )
  }
  it('submits selected IDs immediately but requires explicit confirmation for all, independent of loaded count', async () => {
    const actions = controls()
    render(<Harness actions={actions} />, { wrapper })
    await waitFor(() => expect(screen.getByLabelText('选择失败任务 failure-0')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('选择失败任务 failure-0'))
    fireEvent.click(screen.getByRole('button', { name: '忽略所选（1）' }))
    expect(actions.acknowledgeMany.mutate).toHaveBeenCalledWith({ scope: 'selected', jobIds: ['failure-0'] })
    expect(mocks.confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '全部忽略（200）' }))
    expect(actions.acknowledgeMany.mutateAsync).not.toHaveBeenCalled()
    const dialog = mocks.confirm.mock.calls[0]![0] as { description: string; onConfirm: () => Promise<void> }
    expect(dialog.description).toContain('当前显示 200 项')
    expect(dialog.description).toContain('包括未展示记录')
    await dialog.onConfirm()
    expect(actions.acknowledgeMany.mutateAsync).toHaveBeenCalledWith({ scope: 'all' })
  })
  it('disables duplicate actions while pending and retains selection after a rejected operation', async () => {
    const actions = controls()
    const { rerender } = render(<Harness actions={actions} />, { wrapper })
    await waitFor(() => expect(screen.getByLabelText('选择失败任务 failure-0')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('选择失败任务 failure-0'))
    rerender(<Harness actions={{ ...actions, acknowledgeMany: { ...actions.acknowledgeMany, isPending: true } }} />)
    expect((screen.getByRole('button', { name: '忽略所选（1）' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '全部忽略（200）' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('选择失败任务 failure-0') as HTMLButtonElement).disabled).toBe(true)
    rerender(<Harness actions={actions} />)
    expect((screen.getByRole('button', { name: '忽略所选（1）' }) as HTMLButtonElement).disabled).toBe(false)
    vi.mocked(actions.acknowledgeMany.mutateAsync).mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: '全部忽略（200）' }))
    await expect(mocks.confirm.mock.calls[0]![0].onConfirm()).rejects.toThrow('offline')
    expect(screen.getByRole('button', { name: '忽略所选（1）' })).toBeTruthy()
  })
  it('restores the scroll position, selection and loaded pages when the failure panel remounts', async () => {
    mocks.list.mockResolvedValueOnce({ items: Array.from({ length: 100 }, (_, i) => item(i)), nextCursor: null })
    const actions = controls()
    const { rerender } = render(<Harness actions={actions} />, { wrapper })
    await waitFor(() => expect(screen.getByLabelText('选择失败任务 failure-0')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('选择失败任务 failure-0'))
    const scroll = screen.getByTestId('failure-scroll')
    scroll.scrollTop = 1200
    fireEvent.scroll(scroll)
    rerender(<Harness actions={actions} show={false} />)
    rerender(<Harness actions={actions} />)
    await waitFor(() => expect(screen.getByTestId('failure-scroll').scrollTop).toBe(1200))
    expect(screen.getByRole('button', { name: '忽略所选（1）' })).toBeTruthy()
    expect(mocks.list).toHaveBeenCalledTimes(1)
  })

  it('renders bounded DOM for 1,000 failures and supports keyboard focus and an empty state', async () => {
    mocks.list.mockResolvedValueOnce({ items: Array.from({ length: 1000 }, (_, i) => item(i)), nextCursor: null })
    const { unmount } = render(<Harness actions={controls()} count={1000} />, { wrapper })
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0))
    expect(screen.getAllByRole('listitem').length).toBeLessThan(30)
    const checkbox = screen.getByLabelText('选择失败任务 failure-0')
    act(() => checkbox.focus())
    expect(document.activeElement).toBe(checkbox)
    unmount()
    mocks.list.mockResolvedValue({ items: [], nextCursor: null })
    render(<Harness actions={controls()} count={0} />, { wrapper })
    await waitFor(() => expect(screen.getByText('暂无待处理失败')).toBeTruthy())
  })
})
