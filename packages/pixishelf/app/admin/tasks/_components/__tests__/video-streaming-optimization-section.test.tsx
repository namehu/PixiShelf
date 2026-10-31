import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoOptimizationCandidate } from '@/types/video-optimization'
import { VideoStreamingOptimizationSection } from '../video-streaming-optimization-section'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  preview: vi.fn(),
  submit: vi.fn(),
  tags: vi.fn(),
  confirm: vi.fn(),
  error: vi.fn(),
  info: vi.fn()
}))
vi.mock('sonner', () => ({ toast: { error: mocks.error, info: mocks.info } }))
vi.mock('@/components/shared/global-confirm', () => ({ confirm: mocks.confirm }))
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => false }))
vi.mock('@/components/privacy/privacy-sensitive-text', () => ({
  PrivacySensitiveText: ({ children }: PropsWithChildren) => children
}))
vi.mock('@/components/shared/multiple-selector', () => ({
  default: ({
    placeholder,
    disabled,
    onChange,
    onSearch,
    options
  }: {
    placeholder: string
    disabled?: boolean
    onChange: (options: unknown[]) => void
    onSearch?: (query: string) => Promise<unknown[]>
    options?: unknown[]
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={async () => onChange(onSearch ? await onSearch('tag') : options!.slice(0, 1))}
    >
      {placeholder}
    </button>
  )
}))
vi.mock('../task-ui', () => ({
  TaskSection: ({ title, action, children }: PropsWithChildren<{ title: string; action: ReactNode }>) => (
    <section>
      <h3>{title}</h3>
      {action}
      {children}
    </section>
  )
}))
vi.mock('@/lib/trpc', () => ({ useTRPC: () => api, useTRPCClient: () => ({ tag: { list: { query: mocks.tags } } }) }))
const api = {
  job: {
    listVideoStreamingOptimizationCandidates: {
      queryKey: () => [['job', 'listVideoStreamingOptimizationCandidates']],
      queryOptions: (input: unknown, options: object) => ({
        queryKey: [['job', 'listVideoStreamingOptimizationCandidates'], input],
        queryFn: () => mocks.list(input),
        ...options
      })
    },
    previewVideoStreamingOptimizationBatch: {
      mutationOptions: (options: object) => ({ mutationFn: mocks.preview, ...options })
    },
    submitVideoStreamingOptimizationBatch: {
      mutationOptions: (options: object) => ({ mutationFn: mocks.submit, ...options })
    },
    backgroundDashboard: { queryKey: () => [['job', 'backgroundDashboard']] },
    backgroundHistory: { queryKey: () => [['job', 'backgroundHistory']] }
  }
}
const clients: QueryClient[] = []
function mount(props: Parameters<typeof VideoStreamingOptimizationSection>[0] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <VideoStreamingOptimizationSection {...props} />
    </QueryClientProvider>
  )
}
function candidate(artworkId: number, patch: Partial<VideoOptimizationCandidate> = {}): VideoOptimizationCandidate {
  return {
    artworkId,
    title: `作品 ${artworkId}`,
    source: 'LOCAL_IMPORT',
    artists: [{ id: 1, name: '艺术家' }],
    mp4Count: 3,
    matchingMp4Count: 2,
    actionableMp4Count: 2,
    statusCounts: { NONE: 1, ACTIVE: 1, COMPLETED: 0, FAILED: 1, CANCELLED: 0, SKIPPED: 0 },
    ...patch
  }
}
const target = { imageId: 11, artworkId: 3, latestJobId: null, status: 'NONE' }

beforeEach(() => {
  vi.clearAllMocks()
  window.scrollTo = vi.fn()
  mocks.list.mockImplementation(({ page }) =>
    Promise.resolve({
      items: page === 1 ? [candidate(3), candidate(2, { actionableMp4Count: 0 })] : [candidate(1)],
      total: 21,
      page,
      pageSize: 20
    })
  )
  mocks.preview.mockResolvedValue({ targets: [target], artworkCount: 1, mp4Count: 1, successRedoCount: 0 })
  mocks.submit.mockResolvedValue({ submitted: 1, reused: 0, skipped: 0, failed: 0, items: [] })
  mocks.tags.mockResolvedValue({ items: [{ name: 'tag', name_zh: '标签' }] })
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
})

describe('MP4 optimization artwork selection', () => {
  it('applies only the requested filters, reuses tag names, and resets page and selection', async () => {
    mount()
    await screen.findByText('作品 3')
    expect(mocks.list).toHaveBeenLastCalledWith({
      filters: { statuses: ['NONE', 'FAILED', 'CANCELLED', 'SKIPPED'] },
      page: 1,
      pageSize: 20
    })
    fireEvent.click(screen.getByRole('checkbox', { name: '选择作品 #3' }))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByText('作品 1')
    fireEvent.change(screen.getByRole('spinbutton', { name: '内部作品 ID' }), { target: { value: '7' } })
    fireEvent.change(screen.getByRole('textbox', { name: '作品标题' }), { target: { value: 'title' } })
    fireEvent.change(screen.getByRole('textbox', { name: '艺术家名' }), { target: { value: 'artist' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索并选择包含标签…' }))
    await waitFor(() => expect(mocks.tags).toHaveBeenCalledWith({ query: 'tag', pageSize: 20 }))
    fireEvent.click(screen.getByRole('button', { name: '搜索并选择排除标签…' }))
    fireEvent.click(screen.getByRole('button', { name: '选择创建来源…' }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          filters: {
            artworkId: 7,
            title: 'title',
            artistName: 'artist',
            tags: ['tag'],
            excludeTags: ['tag'],
            sources: ['PIXIV_IMPORTED'],
            statuses: ['NONE', 'FAILED', 'CANCELLED', 'SKIPPED']
          }
        })
      )
    )
    expect(screen.getByText('已选择 0 部作品')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({ artworkId: undefined, title: undefined, tags: [] }),
          page: 1
        })
      )
    )
  })

  it('keeps manual selections across pages and excludes active-only rows from page selection', async () => {
    mount()
    await screen.findByText('作品 3')
    expect((screen.getByRole('checkbox', { name: '选择作品 #2' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: '选择本页作品' }))
    expect(screen.getByText('已选择 1 部作品')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByText('作品 1')
    fireEvent.click(screen.getByRole('checkbox', { name: '选择作品 #1' }))
    expect(screen.getByText('已选择 2 部作品')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '预览并提交' }))
    await waitFor(() =>
      expect(mocks.preview).toHaveBeenCalledWith(
        expect.objectContaining({ selection: { mode: 'SELECTED', artworkIds: [3, 1] } }),
        expect.anything()
      )
    )
  })

  it('supports all matching results with individual exclusions and confirms frozen media once', async () => {
    mocks.preview.mockResolvedValue({ targets: [target], artworkCount: 5, mp4Count: 8, successRedoCount: 2 })
    const onSubmitted = vi.fn()
    mount({ onSubmitted })
    await screen.findByText('作品 3')
    fireEvent.click(screen.getByRole('button', { name: '全选所有筛选结果' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择作品 #3' }))
    fireEvent.click(screen.getByRole('button', { name: '预览并提交' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
    expect(mocks.preview.mock.calls[0]![0].selection).toEqual({ mode: 'ALL_MATCHING', excludedArtworkIds: [3] })
    const confirmation = mocks.confirm.mock.calls[0]![0]
    const view = render(confirmation.description)
    expect(screen.getByText(/5 部作品中的 8 个 MP4，其中 2 个/)).toBeTruthy()
    expect(screen.getByText(/不会重新编码/)).toBeTruthy()
    expect(screen.getByText(/不保证压缩体积/)).toBeTruthy()
    view.unmount()
    expect((screen.getByRole('button', { name: '预览并提交' }) as HTMLButtonElement).disabled).toBe(true)
    await act(() => confirmation.onConfirm())
    expect(mocks.submit).toHaveBeenCalledTimes(1)
    expect(mocks.submit.mock.calls[0]![0]).toEqual({ targets: [target] })
    expect(onSubmitted).toHaveBeenCalledTimes(1)
    expect(screen.getByText('新建 1 · 复用 0 · 跳过 0 · 失败 0')).toBeTruthy()
  })

  it('rejects the entire preview above 1000 MP4 without confirmation or submission', async () => {
    mocks.preview.mockResolvedValue({ targets: [], artworkCount: 5, mp4Count: 1001, successRedoCount: 0 })
    mount()
    await screen.findByText('作品 3')
    fireEvent.click(screen.getByRole('checkbox', { name: '选择作品 #3' }))
    fireEvent.click(screen.getByRole('button', { name: '预览并提交' }))
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('1001')))
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.submit).not.toHaveBeenCalled()
    expect(screen.getByText('已选择 1 部作品')).toBeTruthy()
  })

  it('accepts exactly 1000 MP4 after explicitly applying successful items and allows cancelling confirmation', async () => {
    mocks.preview.mockResolvedValue({
      targets: Array.from({ length: 1000 }, (_, index) => ({ ...target, imageId: index + 1, status: 'COMPLETED' })),
      artworkCount: 1,
      mp4Count: 1000,
      successRedoCount: 1000
    })
    mount()
    await screen.findByText('作品 3')
    fireEvent.click(screen.getByRole('button', { name: '任务状态 · 4' }))
    for (const label of ['无记录', '最近失败', '最近取消', '最近跳过', '最近成功']) {
      fireEvent.click(screen.getByRole('checkbox', { name: label }))
    }
    fireEvent.keyDown(screen.getByRole('checkbox', { name: '最近成功' }), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ filters: expect.objectContaining({ statuses: ['COMPLETED'] }) })
      )
    )
    await screen.findByText('作品 3')
    fireEvent.click(screen.getByRole('checkbox', { name: '选择作品 #3' }))
    fireEvent.click(screen.getByRole('button', { name: '预览并提交' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    expect(mocks.error).not.toHaveBeenCalled()
    act(() => mocks.confirm.mock.calls[0]![0].onCancel())
    expect((screen.getByRole('button', { name: '预览并提交' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText('已选择 1 部作品')).toBeTruthy()
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('uses warning feedback and preserves skipped reasons when no enqueue failed', async () => {
    mocks.submit.mockResolvedValue({
      submitted: 0,
      reused: 0,
      skipped: 1,
      failed: 0,
      items: [{ imageId: 11, artworkId: 3, outcome: 'SKIPPED', reason: '历史任务不可重试' }]
    })
    mount()
    await screen.findByText('作品 3')
    fireEvent.click(screen.getByRole('checkbox', { name: '选择作品 #3' }))
    fireEvent.click(screen.getByRole('button', { name: '预览并提交' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    await act(() => mocks.confirm.mock.calls[0]![0].onConfirm())
    expect(screen.getByText(/跳过：历史任务不可重试/)).toBeTruthy()
    expect(screen.getByText('批量提交结果').closest('[role="alert"]')?.className).toContain('text-warning')
  })

  it('reports partial outcomes and necessary enqueue failure reasons without task records', async () => {
    mocks.submit.mockResolvedValue({
      submitted: 1,
      reused: 2,
      skipped: 3,
      failed: 1,
      items: [
        { imageId: 11, artworkId: 3, outcome: 'FAILED', reason: '媒体已变更，请刷新后重试' },
        { imageId: 12, artworkId: 3, outcome: 'SKIPPED', reason: '历史任务不可重试' }
      ]
    })
    const onViewTasks = vi.fn()
    mount({ onViewTasks })
    await screen.findByText('作品 3')
    fireEvent.click(screen.getByRole('checkbox', { name: '选择作品 #3' }))
    fireEvent.click(screen.getByRole('button', { name: '预览并提交' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    await act(() => mocks.confirm.mock.calls[0]![0].onConfirm())
    expect(screen.getByText('新建 1 · 复用 2 · 跳过 3 · 失败 1')).toBeTruthy()
    expect(screen.getByText(/媒体已变更，请刷新后重试/)).toBeTruthy()
    expect(screen.getByText(/跳过：历史任务不可重试/)).toBeTruthy()
    expect(screen.queryByText('近期记录（保留 90 天）')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: '查看优化任务' })[0]!)
    expect(onViewTasks).toHaveBeenCalledWith()
    fireEvent.click(screen.getAllByRole('button', { name: '查看任务' })[0]!)
    expect(onViewTasks).toHaveBeenLastCalledWith(3)
  })

  it('retains selection after network submission failure and never retries automatically', async () => {
    mocks.submit.mockRejectedValue(new Error('offline'))
    mount()
    await screen.findByText('作品 3')
    fireEvent.click(screen.getByRole('checkbox', { name: '选择作品 #3' }))
    fireEvent.click(screen.getByRole('button', { name: '预览并提交' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    await act(() => mocks.confirm.mock.calls[0]![0].onConfirm())
    expect(mocks.submit).toHaveBeenCalledTimes(1)
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('选择已保留'))
    expect(screen.getByText('已选择 1 部作品')).toBeTruthy()
  })

  it('requires at least one status before applying a draft', async () => {
    mount()
    await screen.findByText('作品 3')
    fireEvent.click(screen.getByRole('button', { name: '任务状态 · 4' }))
    for (const label of ['无记录', '最近失败', '最近取消', '最近跳过']) {
      fireEvent.click(screen.getByRole('checkbox', { name: label }))
    }
    expect(screen.getByText('请至少选择一种任务状态。')).toBeTruthy()
    expect((screen.getByRole('button', { name: '应用筛选' }) as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.list).toHaveBeenCalledTimes(1)
  })

  it('ignores late responses from a previous filter in both table rows and selection', async () => {
    let resolveOld: (value: unknown) => void = () => {}
    mocks.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        })
    )
    mocks.list.mockResolvedValue({ items: [candidate(9)], total: 1, page: 1, pageSize: 20 })
    mount()
    fireEvent.change(screen.getByRole('textbox', { name: '作品标题' }), { target: { value: 'new' } })
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))
    await screen.findByText('作品 9')
    await act(async () => resolveOld({ items: [candidate(3)], total: 21, page: 1, pageSize: 20 }))
    expect(screen.queryByText('作品 3')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择本页作品' }))
    fireEvent.click(screen.getByRole('button', { name: '预览并提交' }))
    await waitFor(() => expect(mocks.preview).toHaveBeenCalled())
    expect(mocks.preview.mock.calls[0]![0]).toMatchObject({
      filters: { title: 'new' },
      selection: { mode: 'SELECTED', artworkIds: [9] }
    })
  })
})
