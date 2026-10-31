import type { ArtworkDedupListGroupsDto } from '@pixishelf/job-contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DuplicateReview } from '../duplicate-review'
import { group, member, partialGroup, containmentGroup } from './duplicate-maintenance-fixtures'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  resolve: vi.fn(),
  prepare: vi.fn(),
  onOperation: vi.fn()
}))
vi.mock('../duplicate-batch-delete', () => ({
  DuplicateBatchProgress: ({ onResultsChanged }: { onResultsChanged: () => void }) => (
    <button onClick={onResultsChanged}>收到回收完成</button>
  ),
  DuplicateBatchConfirmation: ({ onSubmitted }: { onSubmitted: () => void }) => (
    <div role="dialog" aria-label="普通删除确认">
      <button onClick={onSubmitted}>提交已确认删除</button>
    </div>
  )
}))
vi.mock('../duplicate-members-sheet', () => ({
  DuplicateMembersSheet: () => <div role="dialog" aria-label="作品对照" />
}))
vi.mock('@/lib/trpc', () => {
  const api = {
    artwork: { batchDeleteList: { queryKey: () => ['batches'] } },
    artworkDedup: {
      listGroups: {
        queryOptions: (input: unknown) => ({ queryKey: ['groups', input], queryFn: () => mocks.list(input) }),
        queryKey: () => ['groups']
      },
      resolveDeleteSelection: {
        queryOptions: (input: unknown) => ({ queryKey: ['selection', input], queryFn: () => mocks.resolve(input) })
      },
      saveReview: { mutationOptions: () => ({ mutationFn: mocks.save }) },
      previewDeleteSelection: { mutationOptions: () => ({ mutationFn: mocks.prepare }) }
    }
  }
  return { useTRPC: () => api }
})
let client: QueryClient
function page(
  overrides: Partial<Extract<ArtworkDedupListGroupsDto, { kind: 'GROUPS' }>> = {}
): ArtworkDedupListGroupsDto {
  return {
    kind: 'GROUPS',
    runId: 'run-1',
    runVersion: 3,
    reviewRevision: 0,
    allowedActions: ['SAVE_REVIEW', 'PREPARE_CLEANUP'],
    items: [group()],
    nextCursor: null,
    totalGroups: 2,
    recommendedGroupCount: 1,
    ...overrides
  }
}
function mount(initialGroupCount = 2) {
  return render(
    <QueryClientProvider client={client}>
      <DuplicateReview
        userId="user-a"
        runId="run-1"
        initialGroupCount={initialGroupCount}
        onOperation={mocks.onOperation}
      />
    </QueryClientProvider>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  mocks.list.mockResolvedValue(page())
  mocks.resolve.mockResolvedValue({ artworkIds: [2], keeperArtworkIds: [1], groupIds: ['group-1'] })
  mocks.prepare.mockResolvedValue({ jobId: 'batch-1' })
})
afterEach(() => {
  cleanup()
  client.clear()
})

describe('unified duplicate deletion selection', () => {
  it('returns from page two and clears selected work and the open comparison when physical deletion updates the result', async () => {
    let processed = false
    mocks.list.mockImplementation((input: { cursor?: string }) =>
      input.cursor
        ? page({ items: [group('second')], nextCursor: null })
        : page({
            items: [
              group('remaining', {
                keeper: member(processed ? 3 : 1),
                recommendedKeeperArtworkId: processed ? 3 : 1,
                previewMembers: [member(processed ? 3 : 1), member(4)]
              })
            ],
            nextCursor: processed ? null : 'second',
            totalGroups: processed ? 1 : 2
          })
    )
    mount()
    const next = await screen.findByRole('button', { name: '下一页' })
    fireEvent.click(next)
    await waitFor(() => expect(screen.getByText('2', { selector: '[aria-current=page]' })).toBeTruthy())
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '比较作品' }))
    await screen.findByRole('dialog', { name: '作品对照' })
    processed = true
    fireEvent.click(screen.getByRole('button', { name: '收到回收完成' }))
    await screen.findByText('待处理结果 · 1 组')
    await screen.findByRole('radio', { name: '保留 作品 3' })
    expect(screen.queryByRole('dialog', { name: '作品对照' })).toBeNull()
    expect(screen.queryByRole('button', { name: '删除所选' })).toBeNull()
    expect(screen.queryByRole('radio', { name: '保留 作品 1' })).toBeNull()
    expect(screen.queryByRole('button', { name: '上一页' })).toBeNull()
  })

  it.each([
    [0, '没有找到重复作品'],
    [2, '本次重复结果已处理完']
  ] as const)('distinguishes an originally empty run from completed results (%s)', async (initial, title) => {
    mocks.list.mockResolvedValue(page({ items: [], totalGroups: 0, recommendedGroupCount: 0 }))
    mount(initial)
    await screen.findByText(title)
    expect(screen.queryByText('按推荐选择', { exact: false })).toBeNull()
  })
  it('requires a saved manual keeper and never selects that pair just by saving it', async () => {
    let saved = false
    mocks.list.mockImplementation(() =>
      page({
        items: [
          group(),
          partialGroup(
            saved
              ? { savedReview: { groupId: 'partial-1', keeperArtworkId: 1, reviewVersion: 1 }, eligibility: 'ELIGIBLE' }
              : {}
          )
        ],
        reviewRevision: saved ? 1 : 0
      })
    )
    mocks.save.mockImplementation(() => {
      saved = true
      return { review: { groupId: 'partial-1', keeperArtworkId: 1, reviewVersion: 1 }, reviewRevision: 1 }
    })
    mount()
    await screen.findByText('部分重复')
    expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getAllByRole('radio', { name: '保留 作品 1' })[1]!)
    await waitFor(() => expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).disabled).toBe(false))
    expect(screen.getAllByRole('checkbox')[1]!.getAttribute('data-state')).toBe('unchecked')
    fireEvent.click(screen.getAllByRole('checkbox')[0]!)
    fireEvent.click(screen.getAllByRole('checkbox')[1]!)
    const submit = await screen.findByRole('button', { name: '删除所选' })
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(submit)
    await screen.findByRole('dialog', { name: '普通删除确认' })
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { kind: 'EXPLICIT', groupIds: ['group-1', 'partial-1'] },
        expectedReviewRevision: 1
      }),
      expect.anything()
    )
  })
  it('preserves manual selection on another page when selecting all recommendations and submits without opening old records', async () => {
    const partial = partialGroup({
      savedReview: { groupId: 'partial-1', keeperArtworkId: 1, reviewVersion: 1 },
      eligibility: 'ELIGIBLE'
    })
    mocks.list.mockImplementation((input: { cursor?: string }) =>
      input.cursor
        ? page({
            items: [
              group('next-exact', {
                previewMembers: [member(3), member(4)],
                keeper: member(3),
                recommendedKeeperArtworkId: 3
              })
            ]
          })
        : page({ items: [partial], nextCursor: 'page-2' })
    )
    mount()
    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByRole('radio', { name: '保留 作品 3' })
    fireEvent.click(screen.getByRole('button', { name: '按推荐选择（全部页 · 1 组）' }))
    const submit = await screen.findByRole('button', { name: '删除所选' })
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(submit)
    await screen.findByRole('dialog', { name: '普通删除确认' })
    expect(mocks.prepare.mock.calls[0]![0].selection).toEqual({
      kind: 'ALL_RECOMMENDED',
      excludedGroupIds: [],
      manualGroupIds: ['partial-1']
    })
    fireEvent.click(screen.getByRole('button', { name: '提交已确认删除' }))
    expect(mocks.onOperation).not.toHaveBeenCalled()
  })
  it('only allows keeping the complete artwork in containment', async () => {
    mocks.list.mockResolvedValue(page({ items: [containmentGroup()] }))
    mount()
    expect(((await screen.findByRole('radio', { name: '保留 作品 1' })) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('radio', { name: '保留 作品 2' }) as HTMLInputElement).disabled).toBe(false)
  })
  it('shows a specific server selection conflict before opening the file confirmation', async () => {
    mocks.resolve.mockRejectedValue(new Error('保留与待删冲突：#2「作品 2」'))
    mount()
    fireEvent.click(await screen.findByRole('checkbox'))
    await screen.findByText('保留与待删冲突：#2「作品 2」')
    expect((screen.getByRole('button', { name: '删除所选' }) as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
  it('does not allow rapid repeated previews while the first request is pending', async () => {
    mocks.prepare.mockImplementation(() => new Promise(() => {}))
    mount()
    fireEvent.click(await screen.findByRole('checkbox'))
    const button = await screen.findByRole('button', { name: '删除所选' })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1))
  })
})
