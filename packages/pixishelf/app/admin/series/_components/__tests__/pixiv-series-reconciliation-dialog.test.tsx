import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
    series: {
      pixivReconciliationSummary: {
        queryOptions: () => ({}),
        queryKey: () => ['series', 'pixiv-reconciliation-summary']
      },
      startPixivReconciliation: {
        mutationOptions: (options: unknown) => ({ ...(options as object), kind: 'start' })
      },
      cancelPixivReconciliation: {
        mutationOptions: (options: unknown) => ({ ...(options as object), kind: 'cancel' })
      }
    }
  })
}))

import { PixivSeriesReconciliationDialog } from '../pixiv-series-reconciliation-dialog'

function summary(overrides: Record<string, unknown> = {}) {
  return {
    candidateCount: 5,
    eligibleCount: 12,
    providerCounts: { SUCCESS: 4, PARTIAL: 1, NO_DATA: 1, FAILED: 1 },
    capabilityAvailable: true,
    activeJob: null,
    latestBatch: null,
    children: { total: 0, completed: 0, byStatus: {} },
    ...overrides
  }
}

afterEach(cleanup)

describe('PixivSeriesReconciliationDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.startInput = null
    mocks.summary = summary()
  })

  it('starts all unchecked artwork with the source-protecting default policy', () => {
    render(<PixivSeriesReconciliationDialog open onOpenChange={vi.fn()} onStatusChanged={vi.fn()} />)

    expect(screen.getByText(/同名系列不会自动合并，手工系列关系不会删除/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '连续核对全部（5 个）' }))

    expect(mocks.startInput).toEqual({ refreshExisting: false })
  })

  it('refreshes every eligible artwork using one explicit option', () => {
    mocks.summary = summary({ candidateCount: 0, eligibleCount: 5_001 })
    render(<PixivSeriesReconciliationDialog open onOpenChange={vi.fn()} onStatusChanged={vi.fn()} />)

    fireEvent.click(screen.getByRole('checkbox', { name: '刷新已有系列资料' }))
    expect(screen.getByText(/来源标题和顺序将恢复为 Pixiv 最新值/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '连续刷新全部（5001 个）' }))

    expect(mocks.startInput).toEqual({ refreshExisting: true })
  })

  it('blocks enqueue until the new Worker capability is available', () => {
    mocks.summary = summary({ capabilityAvailable: false })
    render(<PixivSeriesReconciliationDialog open onOpenChange={vi.fn()} onStatusChanged={vi.fn()} />)

    expect(screen.getByText('Worker 尚未就绪')).toBeTruthy()
    expect((screen.getByRole('button', { name: '连续核对全部（5 个）' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
