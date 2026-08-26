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
    artist: {
      pixivEnrichmentSummary: {
        queryOptions: () => ({}),
        queryKey: () => ['artist', 'pixiv-enrichment-summary']
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

import { PixivArtistEnrichmentDialog } from '../pixiv-artist-enrichment-dialog'

const selectedArtists = [
  { id: 3, name: 'artist-3', checked: false },
  { id: 7, name: 'artist-7', checked: true }
]

function summary(overrides: Record<string, unknown> = {}) {
  return {
    candidateCount: 5,
    eligibleCount: 12,
    providerCounts: { SUCCESS: 4, PARTIAL: 1, NO_DATA: 1, FAILED: 1 },
    activeJob: null,
    latestBatch: null,
    children: { total: 0, completed: 0, byStatus: {} },
    ...overrides
  }
}

afterEach(cleanup)

describe('PixivArtistEnrichmentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.startInput = null
    mocks.summary = summary()
  })

  it('keeps the current fill-only policy when refresh is not selected', () => {
    render(
      <PixivArtistEnrichmentDialog
        open
        onOpenChange={vi.fn()}
        onStatusChanged={vi.fn()}
        selectedArtists={selectedArtists}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '补全已选 2 项' }))

    expect(mocks.startInput).toEqual({ artistIds: [3, 7], refreshExisting: false })
  })

  it('submits an explicit refresh policy for selected artists', () => {
    render(
      <PixivArtistEnrichmentDialog
        open
        onOpenChange={vi.fn()}
        onStatusChanged={vi.fn()}
        selectedArtists={selectedArtists}
      />
    )

    fireEvent.click(screen.getByRole('checkbox', { name: '刷新已有资料' }))

    expect(
      screen.getByText(
        '将重新下载并替换所选艺术家的 Pixiv 头像和背景图；下载失败或 Pixiv 无对应图片时保留现有图片。主姓名不会被覆盖。'
      )
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '刷新已选 2 项' }))
    expect(mocks.startInput).toEqual({ artistIds: [3, 7], refreshExisting: true })
  })

  it('can continuously refresh every eligible artist even when no unchecked artists remain', () => {
    mocks.summary = summary({ candidateCount: 0, eligibleCount: 12 })
    render(<PixivArtistEnrichmentDialog open onOpenChange={vi.fn()} onStatusChanged={vi.fn()} selectedArtists={[]} />)

    expect((screen.getByRole('button', { name: '连续补全全部（0 个）' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: '刷新已有资料' }))
    expect(screen.getByText('查询并连续刷新全部具有正式 Pixiv 身份的艺术家。')).toBeTruthy()
    expect(
      screen.getByText(
        '当前 12 个 Pixiv 艺术家会按最久未检查顺序全部排入持久队列；Worker 每次只处理一位，关闭页面不影响执行。下载失败或 Pixiv 无对应图片时保留现有图片。'
      )
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '连续刷新全部（12 个）' }))

    expect(mocks.startInput).toEqual({ artistIds: undefined, refreshExisting: true })
  })

  it('starts one continuous default batch for every unchecked artist', () => {
    mocks.summary = summary({ candidateCount: 5_001, eligibleCount: 5_008 })
    render(<PixivArtistEnrichmentDialog open onOpenChange={vi.fn()} onStatusChanged={vi.fn()} selectedArtists={[]} />)

    expect(
      screen.getByText(
        '当前 5001 个未检查艺术家会按每页 200 个发现并全部排入持久队列；Worker 每次只处理一位，关闭页面不影响执行。来源姓名需手工采用。'
      )
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '连续补全全部（5001 个）' }))
    expect(mocks.startInput).toEqual({ artistIds: undefined, refreshExisting: false })
  })

  it('shows discovery progress before the first artist item starts', () => {
    mocks.summary = summary({
      candidateCount: 5_000,
      activeJob: { id: 'child-2000', parentJobId: 'root-1', progress: 0, message: null },
      latestBatch: {
        id: 'root-1',
        status: 'RUNNING',
        stage: 'DISCOVERING',
        progress: 38,
        message: '已发现 2000/5000 个艺术家，创建 2000 个补全任务'
      },
      children: { total: 2_000, completed: 0, byStatus: { PENDING: 2_000 } }
    })

    render(<PixivArtistEnrichmentDialog open onOpenChange={vi.fn()} onStatusChanged={vi.fn()} selectedArtists={[]} />)

    expect(screen.getByText('38%')).toBeTruthy()
    expect(screen.getByText(/2000\/5000/)).toBeTruthy()
    expect(screen.getByText(/关闭页面不影响后台执行/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '取消整批任务' })).toBeTruthy()
  })
})
