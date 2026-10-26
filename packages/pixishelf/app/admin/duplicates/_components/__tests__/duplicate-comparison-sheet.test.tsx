import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DuplicateComparisonSheet } from '../duplicate-comparison-sheet'
import { member, partialGroup, partialSummary, visualGroup, visualSummary } from './duplicate-maintenance-fixtures'

const mocks = vi.hoisted(() => ({ comparisons: vi.fn(), members: vi.fn(), keep: vi.fn(), prepare: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    artworkDedup: {
      listComparisons: {
        queryOptions: (input: unknown) => ({
          queryKey: ['comparisons', input],
          queryFn: () => mocks.comparisons(input)
        })
      },
      listGroups: {
        queryOptions: (input: unknown) => ({ queryKey: ['members', input], queryFn: () => mocks.members(input) })
      }
    }
  })
}))
let client: QueryClient
const result = (overrides = {}) => ({
  runId: 'run-1',
  groupId: 'visual-1',
  visual: visualSummary,
  items: [
    {
      id: 1,
      kind: 'SIMILAR',
      left: { artworkId: 1, imageId: 11, index: 0, thumbnailUrl: '/media/11' },
      right: { artworkId: 2, imageId: 22, index: 2, thumbnailUrl: '/media/22' }
    }
  ],
  nextCursor: 'next-page',
  ...overrides
})
function mount(group = visualGroup()) {
  return render(
    <QueryClientProvider client={client}>
      <DuplicateComparisonSheet
        userId="user-a"
        runId="run-1"
        group={group}
        keeperId={null}
        savedKeeperId={null}
        saving={false}
        failed={false}
        preparing={false}
        canPrepare
        onClose={() => {}}
        onKeep={mocks.keep}
        onRetry={() => {}}
        onPrepare={mocks.prepare}
      />
    </QueryClientProvider>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mocks.comparisons.mockResolvedValue(result())
  mocks.members.mockResolvedValue({
    kind: 'MEMBERS',
    group: visualGroup(),
    items: [member(1), member(2)],
    allowedActions: ['SAVE_REVIEW']
  })
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
describe('visual image comparison', () => {
  it('starts partial comparisons at unmatched originals with explicit choices and exact-only paired evidence', async () => {
    mocks.members.mockResolvedValue({
      kind: 'MEMBERS',
      group: partialGroup(),
      items: [member(1), member(2)],
      allowedActions: ['SAVE_REVIEW']
    })
    mocks.comparisons.mockResolvedValue(
      result({
        groupId: 'partial-1',
        visual: partialSummary,
        items: [
          {
            id: 81,
            kind: 'UNMATCHED',
            left: { artworkId: 1, imageId: 81, index: 80, thumbnailUrl: '/media/81' },
            right: null
          }
        ],
        nextCursor: null
      })
    )
    mount(partialGroup())
    await screen.findByAltText('作品 1，第 81 张')
    expect(mocks.comparisons.mock.calls[0]![0]).toMatchObject({ filter: 'UNMATCHED' })
    expect(screen.getByText('80 张相同 · 双方各 20 张未配对')).toBeTruthy()
    expect(screen.getByText(/未配对不代表内容独有/)).toBeTruthy()
    expect(screen.queryByText(/图片相似/)).toBeNull()
    expect(screen.queryByRole('radio', { name: '不同图片' })).toBeNull()
    expect(screen.getByText('此版本没有对应图片')).toBeTruthy()
    const left = screen.getByRole('button', { name: '保留此版本：作品 1' })
    const right = screen.getByRole('button', { name: '保留此版本：作品 2' })
    expect(left.getAttribute('aria-pressed')).toBe('false')
    expect(right.getAttribute('aria-pressed')).toBe('false')
    expect((screen.getByRole('button', { name: '核对并删除' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(left)
    expect(mocks.keep).toHaveBeenLastCalledWith(partialGroup(), 1)
    fireEvent.click(right)
    expect(mocks.keep).toHaveBeenLastCalledWith(partialGroup(), 2)
    fireEvent.click(screen.getByRole('radio', { name: '相同图片' }))
    await waitFor(() =>
      expect(mocks.comparisons.mock.lastCall?.[0]).toMatchObject({ filter: 'PAIRED', cursor: undefined })
    )
  })

  it('keeps both artwork identities and same-pair side controls, then resets pagination when filtering', async () => {
    mount()
    await screen.findByAltText('作品 1，第 1 张')
    expect(screen.getByAltText('作品 2，第 3 张').getAttribute('loading')).toBe('lazy')
    expect(screen.getByRole('group', { name: '切换对照版本' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: '右侧版本' }))
    expect(screen.getByLabelText('左侧版本对照').classList.contains('hidden')).toBe(true)
    expect(screen.getByLabelText('右侧版本对照').classList.contains('hidden')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() =>
      expect(mocks.comparisons.mock.lastCall?.[0]).toMatchObject({ cursor: 'next-page', filter: 'DIFFERENT' })
    )
    await waitFor(() =>
      expect((screen.getByRole('radio', { name: '未配对' }) as HTMLButtonElement).disabled).toBe(false)
    )
    fireEvent.click(screen.getByRole('radio', { name: '未配对' }))
    await waitFor(() =>
      expect(mocks.comparisons.mock.lastCall?.[0]).toMatchObject({
        cursor: undefined,
        filter: 'UNMATCHED',
        expectedUserId: 'user-a'
      })
    )
    expect(mocks.keep).not.toHaveBeenCalled()
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
  it('handles image failure and retry without changing the keeper', async () => {
    mount()
    fireEvent.error(await screen.findByAltText('作品 1，第 1 张'))
    expect(screen.getByText('图片暂不可用')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试图片' }))
    expect(screen.getByAltText('作品 1，第 1 张')).toBeTruthy()
    expect(mocks.keep).not.toHaveBeenCalled()
  })
  it('shows an empty filter and a recoverable query error without enabling cleanup', async () => {
    mocks.comparisons.mockRejectedValueOnce(new Error('stale'))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '重新加载' }))
    await screen.findByAltText('作品 1，第 1 张')
    mocks.comparisons.mockResolvedValue(result({ items: [], nextCursor: null }))
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['comparisons'] })
    })
    await screen.findByText('此筛选没有图片')
    expect((screen.getByRole('button', { name: '核对并删除' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
