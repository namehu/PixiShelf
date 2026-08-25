import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  summary: {} as any,
  startInput: null as unknown,
  invalidateQueries: vi.fn()
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mocks.summary, isLoading: false, isError: false }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useMutation: (options: any) => ({
    isPending: false,
    mutate: (input?: unknown) => {
      if (options.kind === 'start') {
        mocks.startInput = input
        options.onSuccess({ reused: false, job: { id: 'root-1' } })
      }
    }
  })
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    tag: {
      pixivEnrichmentSummary: {
        queryOptions: () => ({}),
        queryKey: () => ['tag', 'pixiv-enrichment-summary']
      },
      startPixivEnrichment: {
        mutationOptions: (options: unknown) => ({ ...(options as object), kind: 'start' })
      },
      cancelPixivEnrichment: {
        mutationOptions: (options: unknown) => ({ ...(options as object), kind: 'cancel' })
      }
    }
  })
}))

import { PixivTagEnrichmentDialog } from '../pixiv-tag-enrichment-dialog'

const selectedTags = [
  { id: 3, name: '少女', image: '', checked: false },
  { id: 7, name: '制服', image: '/api/pixiv-data/tags/cover.webp', checked: true }
]

function summary(overrides: Record<string, unknown> = {}) {
  return {
    candidateCount: 10,
    providerCounts: { SUCCESS: 2, PARTIAL: 0, NO_DATA: 0, FAILED: 0 },
    activeJob: null,
    latestBatch: null,
    children: { total: 0, completed: 0, byStatus: {} },
    ...overrides
  }
}

afterEach(cleanup)

describe('PixivTagEnrichmentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.startInput = null
    mocks.summary = summary()
  })

  it('clears the table selection after submit and becomes close-only when the batch finishes', async () => {
    const onBatchStarted = vi.fn()
    const onStatusChanged = vi.fn()
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      onBatchStarted,
      onStatusChanged
    }
    const { rerender } = render(<PixivTagEnrichmentDialog {...props} selectedTags={selectedTags} />)

    fireEvent.click(screen.getByRole('button', { name: '补全已选 2 项' }))

    expect(mocks.startInput).toEqual({ tagIds: [3, 7] })
    expect(onBatchStarted).toHaveBeenCalledTimes(1)
    expect(screen.getByText('任务已提交')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /补全/ })).toBeNull()

    mocks.summary = summary({
      activeJob: { id: 'child-1', parentJobId: 'root-1', progress: 50, message: '正在处理标签' },
      latestBatch: { id: 'root-1', status: 'COMPLETED' },
      children: { total: 2, completed: 1, byStatus: { COMPLETED: 1, RUNNING: 1 } }
    })
    rerender(<PixivTagEnrichmentDialog {...props} selectedTags={[]} />)

    expect(screen.getByText('少女')).toBeTruthy()
    expect(screen.getByText('制服')).toBeTruthy()
    expect(screen.getByRole('button', { name: '取消整批任务' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /补全/ })).toBeNull()

    mocks.summary = summary({
      latestBatch: { id: 'root-1', status: 'COMPLETED' },
      children: { total: 2, completed: 2, byStatus: { COMPLETED: 2 } }
    })
    rerender(<PixivTagEnrichmentDialog {...props} selectedTags={[]} />)

    expect(screen.getByText('本次补全已完成')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /补全/ })).toBeNull()
    expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy()
    await waitFor(() => expect(onStatusChanged).toHaveBeenCalledTimes(1))
  })

  it('starts one continuous default batch for every pending candidate', () => {
    render(
      <PixivTagEnrichmentDialog
        open
        onOpenChange={vi.fn()}
        onBatchStarted={vi.fn()}
        onStatusChanged={vi.fn()}
        selectedTags={[]}
      />
    )

    expect(
      screen.getByText('当前 10 个候选会按每页 200 个发现并全部排入持久队列；关闭页面不影响执行，已有字段不会被覆盖。')
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '连续补全全部（10 个）' }))
    expect(mocks.startInput).toEqual({ tagIds: undefined })
  })

  it('shows discovery progress for a 5000-tag logical batch before item execution starts', () => {
    mocks.summary = summary({
      candidateCount: 5_000,
      activeJob: { id: 'child-2000', parentJobId: 'root-1', progress: 0, message: null },
      latestBatch: {
        id: 'root-1',
        status: 'RUNNING',
        stage: 'DISCOVERING',
        progress: 38,
        message: '已发现 2000/5000 个标签，创建 2000 个补全任务'
      },
      children: { total: 2_000, completed: 0, byStatus: { PENDING: 2_000 } }
    })

    render(
      <PixivTagEnrichmentDialog
        open
        onOpenChange={vi.fn()}
        onBatchStarted={vi.fn()}
        onStatusChanged={vi.fn()}
        selectedTags={[]}
      />
    )

    expect(screen.getByText('38%')).toBeTruthy()
    expect(screen.getByText(/2000\/5000/)).toBeTruthy()
    expect(screen.getByText(/关闭页面不影响后台执行/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '取消整批任务' })).toBeTruthy()
  })

  it('blocks a selected batch larger than 200 tags', () => {
    const tooManyTags = Array.from({ length: 201 }, (_, index) => ({
      id: index + 1,
      name: `tag-${index + 1}`,
      image: '',
      checked: false
    }))
    render(
      <PixivTagEnrichmentDialog
        open
        onOpenChange={vi.fn()}
        onBatchStarted={vi.fn()}
        onStatusChanged={vi.fn()}
        selectedTags={tooManyTags}
      />
    )

    expect(screen.getByText('一次最多选择 200 个标签，当前已选择 201 个。')).toBeTruthy()
    expect((screen.getByRole('button', { name: '已选 201 项（最多 200 项）' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })
})
