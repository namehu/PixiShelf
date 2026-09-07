import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { useRef, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobEventStreamItem } from '@pixishelf/job-contracts'
import type { BackgroundHistoryItem } from '@/services/background-task/job-history-service'
import { BackgroundHistoryFilters } from '../background-history-filters'
import { BackgroundHistoryList } from '../background-history-list'
import {
  emptyHistoryFilters,
  historyDateBoundary,
  historyStatusChanged,
  uniqueHistoryItems
} from '../background-history-state'
import { useBackgroundHistory } from '../use-background-history'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  snapshots: vi.fn(),
  head: vi.fn(),
  live: { status: 'connected', items: [] as JobEventStreamItem[], readyVersion: 0, resetVersion: 0 }
}))
vi.mock('../../../_components/background-job-event-provider', () => ({
  useOptionalBackgroundJobEventSubscription: () => mocks.live
}))
vi.mock('@/components/privacy/privacy-sensitive-text', () => ({
  PrivacySensitiveText: ({ children }: { children: ReactNode }) => children
}))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    job: {
      backgroundHistory: {
        infiniteQueryOptions: (input: unknown, options: object) => ({
          queryKey: [['job', 'backgroundHistory'], { input, type: 'infinite' }],
          initialPageParam: undefined,
          notifyOnChangeProps: 'all',
          queryFn: ({ pageParam }: { pageParam?: string }) => mocks.list(input, pageParam),
          ...options
        }),
        queryOptions: (input: unknown, options: object) => ({
          queryKey: [['job', 'backgroundHistory'], { input, type: 'query' }],
          queryFn: () => mocks.head(input),
          ...options
        })
      },
      backgroundHistorySnapshots: {
        queryOptions: (input: unknown, options: object) => ({
          queryKey: [['job', 'backgroundHistorySnapshots'], { input }],
          queryFn: () => mocks.snapshots(input),
          ...options
        })
      }
    }
  })
}))

const clients: QueryClient[] = []
function wrapper({ children }: { children: ReactNode }) {
  const client = useRef<QueryClient | null>(null)
  if (!client.current) {
    client.current = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    clients.push(client.current)
  }
  return <QueryClientProvider client={client.current}>{children}</QueryClientProvider>
}

function item(index = 0, patch: Partial<BackgroundHistoryItem> = {}): BackgroundHistoryItem {
  return {
    id: `job-${index}`,
    type: 'SCAN',
    label: '图库扫描',
    status: 'RUNNING',
    triggerSource: 'MANUAL',
    parentJobId: null,
    progress: 20,
    stage: null,
    message: null,
    errorCode: null,
    error: null,
    effectivePriority: 10,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...patch
  }
}

function stream(id: string, job: BackgroundHistoryItem, type: JobEventStreamItem['event']['type']): JobEventStreamItem {
  return {
    event: {
      id,
      jobId: job.id,
      type,
      level: 'INFO',
      attempt: 1,
      workerId: null,
      stage: null,
      progress: job.progress,
      message: job.message,
      data: null,
      createdAt: job.updatedAt
    },
    job: {
      ...job,
      executionLane: 'BACKGROUND_WRITER',
      progressData: null,
      attempt: 1,
      heartbeatAt: null,
      startedAt: null,
      finishedAt: null
    }
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  mocks.live = { status: 'connected', items: [], readyVersion: 0, resetVersion: 0 }
  mocks.list.mockResolvedValue({ items: [item()], nextCursor: null })
  mocks.snapshots.mockResolvedValue({ items: [] })
  mocks.head.mockResolvedValue({ items: [item()], nextCursor: null })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('execution history filters and state', () => {
  it('debounces input, submits immediately and waits for IME composition', async () => {
    vi.useFakeTimers()
    const change = vi.fn()
    render(<BackgroundHistoryFilters filters={emptyHistoryFilters()} onChange={change} dateInvalid={false} />)
    const input = screen.getByRole('textbox', { name: '搜索执行记录' })
    fireEvent.change(input, { target: { value: 'task' } })
    act(() => vi.advanceTimersByTime(299))
    expect(change).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'task' }))
    change.mockClear()
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '来源核对' } })
    act(() => vi.advanceTimersByTime(600))
    fireEvent.submit(input.closest('form')!)
    expect(change).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    fireEvent.submit(input.closest('form')!)
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ search: '来源核对' }))
  })

  it('uses local calendar boundaries and retains changed-status records', () => {
    expect(new Date(historyDateBoundary('2026-09-07')!).getHours()).toBe(0)
    expect(new Date(historyDateBoundary('2026-09-07', true)!).getDate()).toBe(8)
    expect(historyDateBoundary('')).toBeUndefined()
    expect(
      historyStatusChanged(item(0, { status: 'COMPLETED' }), { ...emptyHistoryFilters(), statuses: ['RUNNING'] })
    ).toBe(true)
    const latest = item(0, { updatedAt: '2026-09-02T00:00:00.000Z', status: 'COMPLETED' })
    expect(uniqueHistoryItems([{ items: [item()] }, { items: [latest, item(1)] }])).toEqual([latest, item(1)])
  })
})

describe('execution history queries', () => {
  it('does not query while closed and loads past 50 records without refetching old pages', async () => {
    mocks.list.mockImplementation((_input, cursor) =>
      Promise.resolve(
        cursor
          ? { items: [item(50)], nextCursor: null }
          : { items: Array.from({ length: 50 }, (_, index) => item(index)), nextCursor: 'next' }
      )
    )
    const { result, rerender } = renderHook(({ open }) => useBackgroundHistory(open, 0), {
      wrapper,
      initialProps: { open: false }
    })
    expect(mocks.list).not.toHaveBeenCalled()
    rerender({ open: true })
    await waitFor(() => expect(result.current.items).toHaveLength(50))
    await act(() => result.current.query.fetchNextPage())
    await waitFor(() => expect(result.current.items).toHaveLength(51))
    expect(mocks.list).toHaveBeenCalledTimes(2)
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.items).toHaveLength(50))
    expect(mocks.list).toHaveBeenCalledTimes(3)
  })

  it('isolates delayed results after filters change', async () => {
    let resolveOld: (value: { items: BackgroundHistoryItem[]; nextCursor: null }) => void = () => {}
    mocks.list
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          })
      )
      .mockResolvedValue({ items: [item(1, { status: 'FAILED' })], nextCursor: null })
    const { result } = renderHook(() => useBackgroundHistory(true, 0), { wrapper })
    act(() => result.current.changeFilters({ ...emptyHistoryFilters(), statuses: ['FAILED'] }))
    await waitFor(() => expect(result.current.items[0]?.id).toBe('job-1'))
    await act(async () => resolveOld({ items: [item()], nextCursor: null }))
    expect(result.current.items.map((entry) => entry.id)).toEqual(['job-1'])
  })

  it('keeps position and membership while applying only newer SSE snapshots', async () => {
    const { result, rerender } = renderHook(() => useBackgroundHistory(true, 0), { wrapper })
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    result.current.browsing.current.offset = 900
    mocks.live.items = [
      stream('1', item(0, { status: 'COMPLETED', updatedAt: '2026-09-02T00:00:00.000Z' }), 'job.completed'),
      stream('2', item(1), 'job.queued')
    ]
    rerender()
    await waitFor(() => expect(result.current.hasUpdates).toBe(true))
    expect(result.current.items.map((entry) => entry.id)).toEqual(['job-0'])
    expect(result.current.items[0]?.status).toBe('COMPLETED')
    expect(result.current.browsing.current.offset).toBe(900)
    expect(mocks.list).toHaveBeenCalledTimes(1)
    mocks.snapshots.mockResolvedValue({
      items: [
        item(0, {
          status: 'COMPLETED',
          updatedAt: '2026-09-02T00:00:00.000Z',
          message: '完整查询消息'
        })
      ]
    })
    act(() => result.current.observeIds(['job-0']))
    await waitFor(() => expect(result.current.items[0]?.message).toBe('完整查询消息'))
    mocks.live.items = [stream('3', item(0, { updatedAt: '2026-08-01T00:00:00.000Z' }), 'job.progress')]
    rerender()
    expect(result.current.items[0]?.status).toBe('COMPLETED')
  })

  it('keeps loaded pages after a next-page failure and allows retry', async () => {
    mocks.list
      .mockResolvedValueOnce({ items: [item()], nextCursor: 'next' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [item(1)], nextCursor: null })
    const { result } = renderHook(() => useBackgroundHistory(true, 0), { wrapper })
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    await act(() => result.current.query.fetchNextPage())
    await waitFor(() => expect(result.current.query.isError).toBe(true))
    expect(result.current.items).toHaveLength(1)
    await act(() => result.current.query.fetchNextPage())
    await waitFor(() => expect(result.current.items).toHaveLength(2))
  })

  it('renders a bounded number of DOM rows for 1,000 loaded records', async () => {
    const selectJob = vi.fn()
    mocks.list.mockResolvedValue({ items: Array.from({ length: 1000 }, (_, index) => item(index)), nextCursor: null })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(640)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    HTMLElement.prototype.scrollTo = vi.fn()
    function Harness() {
      const scrollRef = useRef<HTMLDivElement>(null)
      const history = useBackgroundHistory(true, 0)
      return (
        <div ref={scrollRef} data-testid="history-scroll">
          <BackgroundHistoryList history={history} scrollRef={scrollRef} onSelectJob={selectJob} />
        </div>
      )
    }
    render(<Harness />, { wrapper })
    await waitFor(() => expect(screen.getByText('已加载 1000 条')).toBeTruthy())
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0))
    expect(screen.getAllByRole('listitem').length).toBeLessThan(30)
    const recordButton = screen.getAllByRole('button', { name: /图库扫描/ })[0]!
    act(() => recordButton.focus())
    expect(document.activeElement).toBe(recordButton)
    fireEvent.click(recordButton)
    expect(selectJob).toHaveBeenCalledWith(recordButton.getAttribute('data-job-id'))
    const scroll = screen.getByTestId('history-scroll')
    scroll.scrollTop = 1500
    fireEvent.scroll(scroll)
    const section = document.getElementById('background-history-section')!
    vi.spyOn(section, 'getBoundingClientRect').mockReturnValue({ top: -1400 } as DOMRect)
    fireEvent.click(screen.getByRole('button', { name: '刷新执行记录' }))
    expect(scroll.scrollTop).toBe(100)
  })

  it('measures the tall overview after the ancestor scroll ref attaches and renders the beginning of the list', async () => {
    mocks.list.mockResolvedValue({ items: Array.from({ length: 15 }, (_, index) => item(index)), nextCursor: null })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'listitem' ? 140 : 600
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(640)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const scroll = document.querySelector<HTMLElement>('[data-testid="tall-history-scroll"]')
      const top = this.getAttribute('role') === 'list' ? 100 + 1600 - (scroll?.scrollTop ?? 0) : 100
      return { top, left: 0, bottom: top + 600, right: 640, width: 640, height: 600, x: 0, y: top, toJSON: () => ({}) }
    })
    HTMLElement.prototype.scrollTo = vi.fn(function (
      this: HTMLElement,
      options?: ScrollToOptions | number,
      top?: number
    ) {
      this.scrollTop = typeof options === 'number' ? (top ?? 0) : (options?.top ?? 0)
    })
    function Harness() {
      const scrollRef = useRef<HTMLDivElement>(null)
      const initialized = useRef(false)
      const history = useBackgroundHistory(true, 0)
      if (!initialized.current) {
        history.browsing.current.offset = 1600
        initialized.current = true
      }
      return (
        <div ref={scrollRef} data-testid="tall-history-scroll">
          <div style={{ height: 1420 }}>队列概览和待关注失败</div>
          <BackgroundHistoryList history={history} scrollRef={scrollRef} onSelectJob={vi.fn()} />
        </div>
      )
    }
    render(<Harness />, { wrapper })
    await waitFor(() => expect(screen.getByText('已加载 15 条')).toBeTruthy())
    await waitFor(() => expect(screen.getAllByRole('listitem')[0]!.getAttribute('data-index')).toBe('0'))
    expect(screen.getAllByRole('listitem')[0]!.style.transform).toBe('translateY(0px)')
    expect(screen.getByTestId('tall-history-scroll').scrollTop).toBe(1600)
  })

  it('retains filters and browse state across close/reopen without refetching historical pages', async () => {
    const { result, rerender } = renderHook(({ open }) => useBackgroundHistory(open, 0), {
      wrapper,
      initialProps: { open: true }
    })
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    act(() => result.current.changeFilters({ ...emptyHistoryFilters(), search: '图库扫描', statuses: ['RUNNING'] }))
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    result.current.browsing.current.offset = 1200
    result.current.browsing.current.focusId = 'job-0'
    const listRequests = mocks.list.mock.calls.length
    rerender({ open: false })
    rerender({ open: true })
    await waitFor(() => expect(result.current.filters.search).toBe('图库扫描'))
    expect(result.current.browsing.current).toMatchObject({ offset: 1200, focusId: 'job-0' })
    expect(mocks.list).toHaveBeenCalledTimes(listRequests)
  })

  it('polls active visible snapshots during disconnection, stops while closed, and recovers on reconnect', async () => {
    vi.useFakeTimers()
    mocks.live.status = 'disconnected'
    const { result, rerender } = renderHook(({ open }) => useBackgroundHistory(open, 0), {
      wrapper,
      initialProps: { open: true }
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(result.current.items).toHaveLength(1)
    act(() => result.current.observeIds(['job-0']))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    const initialRequests = mocks.snapshots.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_010)
    })
    expect(mocks.snapshots.mock.calls.length).toBeGreaterThan(initialRequests)
    expect(mocks.list).toHaveBeenCalledTimes(1)
    rerender({ open: false })
    const closedRequests = mocks.snapshots.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_010)
    })
    expect(mocks.snapshots).toHaveBeenCalledTimes(closedRequests)
    mocks.live.status = 'connected'
    mocks.live.readyVersion = 1
    rerender({ open: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(mocks.snapshots.mock.calls.length).toBeGreaterThan(closedRequests)
    expect(mocks.list).toHaveBeenCalledTimes(1)
  })

  it('offers updates for an empty history when a disconnected head probe discovers a task', async () => {
    mocks.list.mockResolvedValue({ items: [], nextCursor: null })
    mocks.head.mockResolvedValue({ items: [], nextCursor: null })
    const { result, rerender } = renderHook(({ version }) => useBackgroundHistory(true, version), {
      wrapper,
      initialProps: { version: 0 }
    })
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true))
    mocks.head.mockResolvedValue({ items: [item(1)], nextCursor: null })
    rerender({ version: 1 })
    await waitFor(() => expect(result.current.hasUpdates).toBe(true))
    expect(result.current.items).toHaveLength(0)
  })
})
