import { type ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchiveDownloadFloater } from '../archive-download-floater'
import type { ArchiveTaskView } from '../archive-task-list'
import type { LatestArchiveJobEvent } from '../archive-live-events'

const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archive: {
      listTasks: {
        infiniteQueryOptions: (input: object, options: object) => ({
          queryKey: ['unfinished', input],
          queryFn: ({ pageParam }: { pageParam?: string }) => mocks.list({ ...input, cursor: pageParam }),
          initialPageParam: undefined,
          ...options
        })
      }
    }
  })
}))
const current = {
  id: 'current',
  systemJobId: 'download-now',
  title: '当前作品完整标题',
  providerKey: 'pixiv',
  externalId: '1',
  status: 'RUNNING',
  systemJobStatus: 'RUNNING',
  phase: 'DOWNLOAD',
  progress: 75,
  completedItems: 3,
  failedItems: 0,
  totalItems: 4
} as ArchiveTaskView
const queued = {
  ...current,
  id: 'queued',
  systemJobId: 'queued-job',
  title: '排队作品',
  status: 'PENDING',
  progress: 0
} as ArchiveTaskView
const publish = {
  ...current,
  id: 'publish',
  systemJobId: 'publish-now',
  title: '入库作品',
  phase: 'PUBLISH',
  progress: 96
} as ArchiveTaskView
let client: QueryClient
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
  mocks.list.mockReset().mockResolvedValue({ items: [queued, current], nextCursor: 'next' })
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
  client.clear()
  vi.unstubAllGlobals()
})

function mount(patch: Partial<ComponentProps<typeof ArchiveDownloadFloater>> = {}) {
  const props: ComponentProps<typeof ArchiveDownloadFloater> = {
    task: current,
    unfinishedCount: 3,
    pausePending: false,
    cancelPending: false,
    onPause: vi.fn(),
    onCancel: vi.fn(),
    onViewItems: vi.fn(),
    onViewTask: vi.fn(),
    ...patch
  }
  const page = () => (
    <QueryClientProvider client={client}>
      <ArchiveDownloadFloater {...props} />
    </QueryClientProvider>
  )
  const view = render(page())
  return {
    ...view,
    props,
    update: (next: Partial<typeof props>) => {
      Object.assign(props, next)
      view.rerender(page())
    }
  }
}
function open() {
  fireEvent.click(screen.getByRole('button', { name: /点击展开/ }))
}
function all() {
  fireEvent.keyDown(screen.getByRole('tab', { name: /全部待完成/ }), { key: 'Enter' })
}

describe('archive download task switcher', () => {
  it('loads all unfinished tasks only when selected, pins and deduplicates current, then paginates in server order', async () => {
    mocks.list.mockImplementation(async ({ cursor }) =>
      cursor
        ? { items: [current, publish, queued], nextCursor: null }
        : { items: [queued, current], nextCursor: 'next' }
    )
    const view = mount()
    open()
    expect(screen.getByRole('tab', { name: '当前下载' }).getAttribute('aria-selected')).toBe('true')
    expect(mocks.list).not.toHaveBeenCalled()
    all()
    await screen.findByRole('button', { name: /排队作品/ })
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith({
      statuses: ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'],
      limit: 50,
      cursor: undefined
    })
    expect(
      screen
        .getAllByRole('button')
        .filter((button) => /当前作品完整标题|排队作品/.test(button.textContent ?? ''))
        .map((button) => button.textContent)
    ).toEqual(['当前作品完整标题下载中 · 75%当前', '排队作品等待下载'])
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    await screen.findByRole('button', { name: /入库作品/ })
    expect(screen.getAllByRole('button', { name: /当前作品完整标题/ })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /排队作品/ })).toHaveLength(1)
    expect(mocks.list.mock.calls.at(-1)?.[0].cursor).toBe('next')
    fireEvent.click(screen.getByRole('button', { name: /入库作品/ }))
    expect(view.props.onViewTask).toHaveBeenCalledWith(publish)
    expect(screen.queryByRole('tab', { name: '当前下载' })).toBeNull()
  })

  it('defaults to all without a current download and preserves the selected tab through task changes and drain', async () => {
    const view = mount({ task: null })
    expect(screen.getByRole('button', { name: /当前无下载，待完成 3 项/ })).toBeTruthy()
    open()
    await screen.findByRole('button', { name: /排队作品/ })
    expect(screen.getByRole('tab', { name: /全部待完成/ }).getAttribute('aria-selected')).toBe('true')
    view.update({ task: current })
    expect(screen.getByRole('tab', { name: /全部待完成/ }).getAttribute('aria-selected')).toBe('true')
    view.update({ task: null, unfinishedCount: 0 })
    expect(screen.getByText('暂无待完成任务')).toBeTruthy()
    expect(screen.getByRole('button', { name: '收起下载任务' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '收起下载任务' }))
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('refreshes cached unfinished pages on reopen even within the global 60-second stale time', async () => {
    mocks.list.mockResolvedValue({ items: [queued], nextCursor: null })
    const view = mount({ task: null, refreshedAt: 10 })
    open()
    await screen.findByRole('button', { name: /排队作品/ })
    fireEvent.click(screen.getByRole('button', { name: '收起下载任务' }))
    mocks.list.mockResolvedValue({ items: [publish], nextCursor: null })
    view.update({ refreshedAt: 11 })
    expect(mocks.list).toHaveBeenCalledTimes(1)
    open()
    await screen.findByRole('button', { name: /入库作品/ })
    await waitFor(() => expect(screen.queryByRole('button', { name: /排队作品/ })).toBeNull())
    expect(mocks.list).toHaveBeenCalledTimes(2)
  })

  it('keeps loading and failed count unknown instead of hiding a stale zero snapshot', async () => {
    const view = mount({ task: null, unfinishedCount: undefined })
    expect(screen.getByRole('button', { name: /下载状态加载中，待完成 — 项/ })).toBeTruthy()
    view.update({ unfinishedCount: 0, dashboardError: true })
    expect(screen.getByRole('button', { name: /下载状态暂不可用，待完成 — 项/ })).toBeTruthy()
    open()
    expect(screen.getByRole('tab', { name: '全部待完成 (—)' })).toBeTruthy()
    expect(screen.queryByText('暂无待完成任务')).toBeNull()
    await screen.findByRole('button', { name: /排队作品/ })
  })

  it('retains list errors and retries, refreshing from the existing dashboard clock only', async () => {
    mocks.list.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ items: [queued], nextCursor: null })
    const view = mount({ task: null, refreshedAt: 10 })
    open()
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByRole('button', { name: /排队作品/ })
    const calls = mocks.list.mock.calls.length
    view.update({ refreshedAt: 11 })
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(calls + 1))
    view.update({ pausePending: true })
    await act(async () => {})
    expect(mocks.list).toHaveBeenCalledTimes(calls + 1)
  })

  it('uses current execution progress and privacy-safe focused title tooltips', async () => {
    mocks.list.mockResolvedValue({ items: [publish], nextCursor: null })
    const events = new Map([
      ['old-publish', { item: { job: { id: 'old-publish', progress: 1, status: 'COMPLETED' } } }],
      ['publish-now', { item: { job: { id: 'publish-now', progress: 98, status: 'RUNNING', stage: 'PUBLISHING' } } }]
    ]) as unknown as Map<string, LatestArchiveJobEvent>
    mount({ liveJobById: events })
    open()
    all()
    const button = await screen.findByRole('button', { name: /入库作品/ })
    expect(button.textContent).toContain('98%')
    expect(button.getAttribute('title')).toBeNull()
    fireEvent.focus(button)
    const tip = await screen.findByRole('tooltip')
    expect(tip.querySelector('[data-privacy-sensitive]')?.textContent).toBe('入库作品')
  })
})
