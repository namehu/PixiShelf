import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArchiveDiscoveryDeferred } from '../archive-discovery-deferred'
const { download } = vi.hoisted(() => ({ download: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archiveSearch: {
      listDeferredItems: { infiniteQueryOptions: () => ({}), infiniteQueryKey: () => ['deferred'] },
      restoreDeferredItems: { mutationOptions: () => ({ kind: 'restore' }) },
      ignoreDeferredItems: { mutationOptions: () => ({ kind: 'ignore' }) },
      downloadDeferredItems: { mutationOptions: () => ({ kind: 'download' }) },
      listItems: { infiniteQueryKey: () => ['items'] },
      listIgnoredItems: { infiniteQueryKey: () => ['ignored'] },
      catalogCounts: { queryKey: () => ['counts'] }
    },
    archiveInbox: { list: { queryKey: () => ['inbox'] }, summary: { queryKey: () => ['summary'] } }
  })
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: ({ kind }: { kind: string }) => ({ mutate: kind === 'download' ? download : vi.fn(), isPending: false }),
  useInfiniteQuery: () => ({
    data: {
      pages: [
        {
          totalCount: 2,
          items: [
            {
              id: 'orphan',
              title: 'Deleted source gallery',
              sourceDisplayName: 'Deleted',
              sourceDeleted: true,
              deferredAt: new Date(),
              sourceHref: '/api/archive/deferred/orphan/source'
            },
            {
              id: 'live',
              title: 'Live source gallery',
              sourceDisplayName: 'Live',
              sourceDeleted: false,
              deferredAt: new Date(),
              sourceHref: '/api/archive/deferred/live/source'
            }
          ]
        }
      ]
    },
    isPending: false,
    isError: false
  })
}))
beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(cleanup)
it('defaults single deferred download to ALL after its source was deleted', () => {
  render(<ArchiveDiscoveryDeferred onClose={() => {}} />)
  expect(screen.getByText(/来源已删除/)).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: '加入收件箱' })[0]!)
  expect(download).toHaveBeenCalledWith(
    expect.objectContaining({
      deferredItemIds: ['orphan'],
      downloadMode: 'AUTO',
      quality: 'ORIGINAL',
      downloadScope: 'ALL'
    })
  )
})
it('sends FIRST_20 for every selected deferred row and changes the request key when the scope changes', () => {
  render(<ArchiveDiscoveryDeferred onClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '自动下载 · 原图 · 全部' }))
  fireEvent.click(screen.getByRole('radio', { name: '前20张' }))
  fireEvent.click(screen.getByRole('button', { name: '完成' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '选择已加载的稍后决定，最多一百条' }))
  fireEvent.click(
    within(screen.getByRole('region', { name: '稍后决定批量操作' })).getByRole('button', { name: '加入收件箱' })
  )
  const first = download.mock.calls[0]![0]
  expect(first).toMatchObject({ deferredItemIds: ['orphan', 'live'], downloadScope: 'FIRST_20' })
  fireEvent.click(screen.getByRole('button', { name: '自动下载 · 原图 · 前20张' }))
  fireEvent.click(screen.getByRole('radio', { name: '全部' }))
  fireEvent.click(screen.getByRole('button', { name: '完成' }))
  fireEvent.click(
    within(screen.getByRole('region', { name: '稍后决定批量操作' })).getByRole('button', { name: '加入收件箱' })
  )
  expect(download.mock.calls[1]![0]).toMatchObject({ deferredItemIds: ['orphan', 'live'], downloadScope: 'ALL' })
  expect(download.mock.calls[1]![0].requestId).not.toBe(first.requestId)
})
