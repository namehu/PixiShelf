import type { ArtworkDedupListGroupsDto } from '@pixishelf/job-contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DuplicateReview } from '../duplicate-review'
import { group, member, operation } from './duplicate-maintenance-fixtures'

const mocks = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), prepare: vi.fn(), onOperation: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    artworkDedup: {
      listGroups: {
        queryOptions: (input: unknown) => ({ queryKey: ['groups', input], queryFn: () => mocks.list(input) }),
        queryKey: () => ['groups']
      },
      saveReview: { mutationOptions: () => ({ mutationFn: mocks.save }) },
      prepareCleanup: { mutationOptions: () => ({ mutationFn: mocks.prepare }) }
    }
  })
}))
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
    totalGroups: 25,
    recommendedGroupCount: 25,
    ...overrides
  }
}
function mount() {
  return render(
    <QueryClientProvider client={client}>
      <DuplicateReview userId="user-a" runId="run-1" onOperation={mocks.onOperation} />
    </QueryClientProvider>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue(page())
  mocks.prepare.mockResolvedValue(operation({ status: 'BUILDING' }))
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
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
describe('duplicate review', () => {
  it('keeps a failed keeper choice visible and blocks selected groups from preparing', async () => {
    mocks.save.mockRejectedValue(new Error('conflict'))
    mount()
    await screen.findByText('选择保留作品')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('radio', { name: '保留 作品 2' }))
    await screen.findByText('未保存，暂不能预览本组')
    expect((screen.getByRole('radio', { name: '保留 作品 2' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('button', { name: '核对并删除' }) as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.save.mock.calls[0]![0]).toMatchObject({
      expectedUserId: 'user-a',
      expectedRunVersion: 3,
      expectedReviewVersion: 0,
      keeperArtworkId: 2
    })
  })
  it('saving a keeper never selects its group and advances the prepare revision', async () => {
    mocks.save.mockResolvedValue({
      review: { groupId: 'group-1', keeperArtworkId: 2, reviewVersion: 1 },
      reviewRevision: 1
    })
    mount()
    await screen.findByText('选择保留作品')
    fireEvent.click(screen.getByRole('radio', { name: '保留 作品 2' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText('正在保存保留选择…')).toBeNull())
    expect(screen.queryByRole('button', { name: '核对并删除' })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '核对并删除' }))
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1))
    expect(mocks.prepare.mock.calls[0]![0]).toMatchObject({
      purpose: 'DIRECT_DELETE',
      protocolVersion: 1,
      expectedReviewRevision: 1,
      selection: { kind: 'EXPLICIT', groupIds: ['group-1'] }
    })
  })
  it('sends the true all-recommended range and deduplicates rapid prepare clicks', async () => {
    let resolve!: (value: ReturnType<typeof operation>) => void
    mocks.prepare.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    mount()
    await screen.findByText('选择保留作品')
    fireEvent.click(screen.getByRole('button', { name: '按推荐全选（25 组）' }))
    expect(screen.getByText(/包括其他页的推荐组/)).toBeTruthy()
    const prepare = screen.getByRole('button', { name: '核对并删除' })
    fireEvent.click(prepare)
    fireEvent.click(prepare)
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1))
    expect(mocks.prepare.mock.calls[0]![0]).toMatchObject({
      selection: { kind: 'ALL_RECOMMENDED', excludedGroupIds: [] },
      expectedUserId: 'user-a'
    })
    await act(async () => resolve(operation({ status: 'BUILDING' })))
    expect(mocks.onOperation).toHaveBeenCalledTimes(1)
    expect(mocks.list.mock.calls[0]![0]).toMatchObject({ limit: 20, expectedUserId: 'user-a' })
  })
  it('retains prepare and clear after an excluded group loses recommendation eligibility', async () => {
    mocks.list.mockResolvedValue(page({ items: [group('A')], recommendedGroupCount: 2 }))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '按推荐全选（2 组）' }))
    fireEvent.click(screen.getByRole('checkbox'))
    mocks.list.mockResolvedValue(page({ items: [group('B')], recommendedGroupCount: 1 }))
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['groups'] })
    })
    await screen.findByText('全部推荐 · 当前 1 组推荐，已排除 1 组')
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true')
    const prepare = screen.getByRole('button', { name: '核对并删除' }) as HTMLButtonElement
    expect(prepare.disabled).toBe(false)
    fireEvent.click(prepare)
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1))
    expect(mocks.prepare.mock.calls[0]![0]).toMatchObject({
      selection: { kind: 'ALL_RECOMMENDED', excludedGroupIds: ['A'] }
    })
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '取消选择' }) as HTMLButtonElement).disabled).toBe(false)
    )
    fireEvent.click(screen.getByRole('button', { name: '取消选择' }))
    expect(screen.queryByLabelText('跨页选择范围')).toBeNull()
  })
  it.each([320, 390])(
    'keeps the wrapping selection bar above navigation at the %dpx mobile layout boundary',
    async (width) => {
      vi.stubGlobal('innerWidth', width)
      mocks.list.mockResolvedValue(page({ nextCursor: 'page-2' }))
      mount()
      await screen.findByText('选择保留作品')
      fireEvent.click(screen.getByRole('checkbox'))
      const bar = screen.getByLabelText('跨页选择范围')
      const pagination = screen.getByRole('navigation', { name: '结果分页' })
      // jsdom has no layout engine: assert the shell-offset contract and normal-flow reservation, not pixels.
      expect(bar.classList.contains('bottom-[var(--app-mobile-navigation-offset)]')).toBe(true)
      expect(bar.classList.contains('lg:bottom-0')).toBe(true)
      expect(bar.classList.contains('flex-wrap')).toBe(true)
      expect(bar.parentElement?.classList.contains('pb-[calc(var(--app-mobile-navigation-offset)+1.5rem)]')).toBe(true)
      expect(pagination.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(screen.getByRole('button', { name: '核对并删除' }).classList.contains('min-h-11')).toBe(true)
      expect(screen.getByRole('button', { name: '取消选择' }).classList.contains('min-h-11')).toBe(true)
    }
  )
  it('shows no executable selection controls before server actions open', async () => {
    mocks.list.mockResolvedValue(page({ allowedActions: [] }))
    mount()
    await screen.findByText('选择保留作品')
    expect(screen.queryByRole('button', { name: /按推荐全选/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '核对并删除' })).toBeNull()
    expect((screen.getByRole('checkbox') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('radio', { name: '保留 作品 2' }) as HTMLInputElement).disabled).toBe(true)
  })
})

describe('review revision cursor recovery', () => {
  it('keeps cross-page deletion selection and obtains fresh group cursors after saving on page two', async () => {
    let revision = 0
    let keeper = 41
    const invalidCursors: string[] = []
    const first = group('first', { previewMembers: [member(1), member(2)] })
    const second = () =>
      group('second', {
        previewMembers: [member(41), member(42)],
        keeper: member(keeper),
        recommendedKeeperArtworkId: keeper,
        reviewVersion: revision,
        savedReview: revision ? { groupId: 'second', keeperArtworkId: keeper, reviewVersion: revision } : null
      })
    mocks.list.mockImplementation((input: { cursor?: string }) => {
      if (input.cursor && input.cursor !== `groups-r${revision}-page2`) {
        invalidCursors.push(input.cursor)
        throw new Error('INVALID_CURSOR')
      }
      return page({
        reviewRevision: revision,
        items: [input.cursor ? second() : first],
        nextCursor: input.cursor ? null : `groups-r${revision}-page2`
      })
    })
    mocks.save.mockImplementation((input: { keeperArtworkId: number }) => {
      keeper = input.keeperArtworkId
      revision += 1
      return {
        review: { groupId: 'second', keeperArtworkId: keeper, reviewVersion: revision },
        reviewRevision: revision
      }
    })
    mount()
    await screen.findByText('选择保留作品')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByRole('radio', { name: '保留 作品 42' })
    fireEvent.click(screen.getByRole('checkbox'))
    const queryCountBeforeSave = mocks.list.mock.calls.length
    fireEvent.click(screen.getByRole('radio', { name: '保留 作品 42' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    await screen.findByRole('radio', { name: '保留 作品 1' })
    expect(screen.getByText('已选 2 组 · 2 部待删除')).toBeTruthy()
    expect(mocks.list.mock.calls.slice(queryCountBeforeSave).every(([input]) => input.cursor === undefined)).toBe(true)
    expect(invalidCursors).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    const selected = await screen.findByRole('radio', { name: '保留 作品 42' })
    expect((selected as HTMLInputElement).checked).toBe(true)
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true')
    expect(mocks.list.mock.lastCall![0].cursor).toBe('groups-r1-page2')
    fireEvent.click(screen.getByRole('button', { name: '核对并删除' }))
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1))
    expect(mocks.prepare.mock.calls[0]![0]).toMatchObject({
      expectedReviewRevision: 1,
      selection: { kind: 'EXPLICIT', groupIds: ['first', 'second'] }
    })
    expect(invalidCursors).toEqual([])
  })

  it('resets a 21-member sheet after a real client save and can continue selecting with the new revision', async () => {
    let revision = 0
    let keeper = 1
    const invalidCursors: string[] = []
    const currentGroup = () =>
      group('long', {
        memberCount: 21,
        previewMembers: [member(1), member(2), member(3)],
        keeper: member(keeper),
        recommendedKeeperArtworkId: keeper,
        reviewVersion: revision,
        savedReview: revision ? { groupId: 'long', keeperArtworkId: keeper, reviewVersion: revision } : null
      })
    mocks.list.mockImplementation((input: { groupId?: string; memberCursor?: string }) => {
      if (!input.groupId) {
        return page({ reviewRevision: revision, items: [currentGroup()], totalGroups: 1, recommendedGroupCount: 1 })
      }
      if (input.memberCursor && input.memberCursor !== `members-r${revision}-page2`) {
        invalidCursors.push(input.memberCursor)
        throw new Error('INVALID_CURSOR')
      }
      return {
        kind: 'MEMBERS',
        runId: 'run-1',
        runVersion: 3,
        reviewRevision: revision,
        allowedActions: ['SAVE_REVIEW'],
        group: currentGroup(),
        keeper: member(keeper),
        items: input.memberCursor ? [member(21)] : Array.from({ length: 20 }, (_, index) => member(index + 1)),
        nextMemberCursor: input.memberCursor ? null : `members-r${revision}-page2`
      }
    })
    mocks.save.mockImplementation((input: { keeperArtworkId: number }) => {
      keeper = input.keeperArtworkId
      revision += 1
      return { review: { groupId: 'long', keeperArtworkId: keeper, reviewVersion: revision }, reviewRevision: revision }
    })
    mount()
    await screen.findByText('选择保留作品')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '比较全部 21 部' }))
    const dialog = within(await screen.findByRole('dialog', { name: '保留哪一部？' }))
    await dialog.findByRole('radio', { name: '保留 作品 20' })
    fireEvent.click(dialog.getByRole('button', { name: '下一页' }))
    await dialog.findByRole('radio', { name: '保留 作品 21' })
    const queryCountBeforeSave = mocks.list.mock.calls.length
    fireEvent.click(dialog.getByRole('radio', { name: '保留 作品 21' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    await dialog.findByRole('radio', { name: '保留 作品 20' })
    await dialog.findByText('已保存的保留作品')
    expect(dialog.getByText('作品 21')).toBeTruthy()
    expect(mocks.list.mock.calls.slice(queryCountBeforeSave).every(([input]) => input.memberCursor === undefined)).toBe(
      true
    )
    expect(invalidCursors).toEqual([])
    fireEvent.click(dialog.getByRole('button', { name: '下一页' }))
    expect(((await dialog.findByRole('radio', { name: '保留 作品 21' })) as HTMLInputElement).checked).toBe(true)
    expect(mocks.list.mock.lastCall![0].memberCursor).toBe('members-r1-page2')
    fireEvent.click(dialog.getByRole('button', { name: '上一页' }))
    fireEvent.click(await dialog.findByRole('radio', { name: '保留 作品 20' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect((dialog.getByRole('radio', { name: '保留 作品 20' }) as HTMLInputElement).checked).toBe(true)
    )
    expect(mocks.save.mock.calls[1]![0]).toMatchObject({ expectedReviewVersion: 1, keeperArtworkId: 20 })
    expect(invalidCursors).toEqual([])
    expect(screen.getByText('已选 1 组 · 20 部待删除')).toBeTruthy()
  })
})
