import type { ComponentProps, ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchiveDiscoveryBatchSources } from '../archive-discovery-batch-sources'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  control: vi.fn(),
  retry: vi.fn(),
  select: vi.fn(),
  batch: null as unknown
}))
vi.mock('@/components/privacy/privacy-sensitive-text', () => ({
  PrivacySensitiveText: ({ children, className }: { children: ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  )
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const queryClient = { invalidateQueries: vi.fn(async () => {}) }
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => queryClient,
  useQuery: () => ({ data: mocks.batch, isPending: false, isError: false }),
  useMutation: (options: { kind: string }) => ({
    isPending: false,
    mutate: options.kind === 'start' ? mocks.start : options.kind === 'control' ? mocks.control : mocks.retry
  })
}))
const trpc = {
  archiveSearch: {
    activeBatchScan: { queryOptions: () => ({}), queryKey: () => ['batch'] },
    startBatchScan: { mutationOptions: () => ({ kind: 'start' }) },
    controlBatchScan: { mutationOptions: () => ({ kind: 'control' }) },
    retryBatchScan: { mutationOptions: () => ({ kind: 'retry' }) },
    listSources: { queryKey: () => ['sources'] },
    getSource: { queryKey: () => ['source'] },
    listItems: { infiniteQueryKey: () => ['items'] }
  }
}
vi.mock('@/lib/trpc', () => ({ useTRPC: () => trpc }))
type Props = ComponentProps<typeof ArchiveDiscoveryBatchSources>
const sources = [
  {
    id: 'a',
    displayName: 'Alice',
    status: 'ACTIVE',
    sourceKind: 'UPLOADER',
    historyCoverage: 'NOT_SCANNED',
    catalogCounts: { actionable: 0, attention: 0 },
    latestRun: null
  },
  {
    id: 'b',
    displayName: '关键词 B',
    status: 'ACTIVE',
    sourceKind: 'TITLE_QUERY',
    historyCoverage: 'HAS_MORE',
    titleQuery: { keyword: 'B', matchMode: 'CONTAINS' },
    catalogCounts: { actionable: 0, attention: 0 },
    latestRun: null
  },
  {
    id: 'c',
    displayName: '已停用 C',
    status: 'ARCHIVED',
    catalogCounts: { actionable: 0, attention: 0 },
    latestRun: null
  },
  {
    id: 'd',
    displayName: '扫描中 D',
    status: 'ACTIVE',
    catalogCounts: { actionable: 0, attention: 0 },
    latestRun: { status: 'RUNNING' }
  }
] as Props['sources']
const props: Props = {
  allSources: sources,
  sources,
  selectedSourceId: null,
  onSelect: mocks.select,
  onCopyUid: vi.fn()
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.batch = null
})
afterEach(cleanup)

describe('discovery batch source selection', () => {
  it('selects only eligible visible sources without navigating into a detail', () => {
    render(<ArchiveDiscoveryBatchSources {...props} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '全选当前筛选的可扫描来源' }))
    expect(screen.getByText('已选 2')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: '选择来源 已停用 C' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('checkbox', { name: '选择来源 扫描中 D' }).hasAttribute('disabled')).toBe(true)
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it('keeps hidden selections across filters and freezes the reviewed order and request ID', () => {
    const view = render(<ArchiveDiscoveryBatchSources {...props} sources={[sources[0]!]} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '选择来源 Alice' }))
    view.rerender(<ArchiveDiscoveryBatchSources {...props} sources={[sources[1]!]} />)
    expect(screen.getByText('已选 1（隐藏 1）')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: '全选当前筛选的可扫描来源' }))
    fireEvent.click(screen.getByRole('button', { name: '批量扫描最新' }))
    view.rerender(
      <ArchiveDiscoveryBatchSources
        {...props}
        allSources={[sources[1]!, sources[0]!, ...sources.slice(2)]}
        sources={[sources[1]!]}
      />
    )
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual(['Alice', '关键词 B'])
    fireEvent.click(within(dialog).getByRole('button', { name: '开始扫描' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '开始扫描' }))
    expect(mocks.start.mock.calls[0]?.[0]).toEqual(mocks.start.mock.calls[1]?.[0])
    expect(mocks.start).toHaveBeenCalledWith({ sourceIds: ['a', 'b'], requestId: expect.any(String) })
  })
  it('restores active progress and exposes controls after remount', () => {
    mocks.batch = {
      id: 'batch',
      active: true,
      status: 'PAUSED',
      total: 2,
      processed: 1,
      sources: [
        { id: 'a', name: 'Alice' },
        { id: 'b', name: 'B' }
      ],
      results: [{ sourceId: 'a', status: 'COMPLETED', message: '完成' }],
      currentSourceId: 'b',
      phase: 'HISTORY',
      checkedCount: 12,
      error: null
    }
    render(<ArchiveDiscoveryBatchSources {...props} />)
    expect(screen.getByText('已处理 1 / 2 个来源')).toBeTruthy()
    expect(screen.getByText(/补历史/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '批量扫描最新' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    expect(mocks.control).toHaveBeenCalledWith({ batchId: 'batch', command: 'RESUME' })
    fireEvent.click(screen.getByRole('button', { name: '取消批次' }))
    expect(mocks.control).toHaveBeenCalledWith({ batchId: 'batch', command: 'CANCEL' })
  })
  it('offers failed-source retry only after completion', () => {
    mocks.batch = {
      id: 'batch',
      active: false,
      status: 'COMPLETED',
      total: 1,
      processed: 1,
      sources: [{ id: 'a', name: 'Alice' }],
      results: [{ sourceId: 'a', status: 'FAILED', message: '失败' }],
      currentSourceId: null,
      error: null
    }
    render(<ArchiveDiscoveryBatchSources {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '重试失败来源' }))
    expect(mocks.retry).toHaveBeenCalledWith({ batchId: 'batch', requestId: expect.any(String) })
    expect(mocks.start).not.toHaveBeenCalled()
  })
})
