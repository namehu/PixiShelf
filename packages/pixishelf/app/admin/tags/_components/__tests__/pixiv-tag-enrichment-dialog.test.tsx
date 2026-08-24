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
})
