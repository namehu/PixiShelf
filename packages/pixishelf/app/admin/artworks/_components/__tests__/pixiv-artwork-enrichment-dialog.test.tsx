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
    artwork: {
      pixivEnrichmentSummary: {
        queryOptions: () => ({}),
        queryKey: () => ['artwork', 'pixiv-enrichment-summary']
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

import { PixivArtworkEnrichmentDialog } from '../pixiv-artwork-enrichment-dialog'

const selectedArtworks = [
  { id: 3, title: 'artwork-3', checked: false },
  { id: 7, title: 'artwork-7', checked: true }
]

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

describe('PixivArtworkEnrichmentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.startInput = null
    mocks.summary = summary()
  })

  it('submits selected artwork with the safe default text policy', () => {
    render(
      <PixivArtworkEnrichmentDialog
        open
        onOpenChange={vi.fn()}
        onStatusChanged={vi.fn()}
        selectedArtworks={selectedArtworks}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '同步已选 2 项' }))

    expect(mocks.startInput).toEqual({ artworkIds: [3, 7], refreshExisting: false, adoptSourceText: false })
  })

  it('can continuously refresh all eligible artwork and adopt source text explicitly', () => {
    mocks.summary = summary({ candidateCount: 0, eligibleCount: 5_001 })
    render(<PixivArtworkEnrichmentDialog open onOpenChange={vi.fn()} onStatusChanged={vi.fn()} selectedArtworks={[]} />)

    fireEvent.click(screen.getByRole('checkbox', { name: '刷新已有资料' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '采用最新 Pixiv 标题和描述' }))
    expect(screen.getByText('查询并连续刷新全部具有唯一 Pixiv 身份的作品。')).toBeTruthy()
    expect(screen.getByText(/当前 5001 个作品会按每页 200 个发现并全部排入持久队列/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '连续刷新全部（5001 个）' }))

    expect(mocks.startInput).toEqual({ artworkIds: undefined, refreshExisting: true, adoptSourceText: true })
  })

  it('blocks enqueue until a capable READY Worker is available', () => {
    mocks.summary = summary({ capabilityAvailable: false })
    render(<PixivArtworkEnrichmentDialog open onOpenChange={vi.fn()} onStatusChanged={vi.fn()} selectedArtworks={[]} />)

    expect(screen.getByText('Worker 尚未就绪')).toBeTruthy()
    expect((screen.getByRole('button', { name: '连续同步全部（5 个）' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows discovery progress and keeps whole-batch cancellation available', () => {
    mocks.summary = summary({
      candidateCount: 5_000,
      activeJob: { id: 'child-2000', parentJobId: 'root-1', progress: 0, message: null },
      latestBatch: {
        id: 'root-1',
        status: 'RUNNING',
        stage: 'DISCOVERING',
        progress: 38,
        message: '已发现 2000/5000 个作品，创建 2000 个同步任务'
      },
      children: { total: 2_000, completed: 0, byStatus: { PENDING: 2_000 } }
    })

    render(<PixivArtworkEnrichmentDialog open onOpenChange={vi.fn()} onStatusChanged={vi.fn()} selectedArtworks={[]} />)

    expect(screen.getByText('38%')).toBeTruthy()
    expect(screen.getByText(/2000\/5000/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '取消整批任务' })).toBeTruthy()
  })
})
