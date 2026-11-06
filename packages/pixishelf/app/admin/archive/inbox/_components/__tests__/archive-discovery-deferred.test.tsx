import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArchiveDiscoveryDeferred } from '../archive-discovery-deferred'
const { download, restore, ignore } = vi.hoisted(() => ({ download: vi.fn(), restore: vi.fn(), ignore: vi.fn() }))
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
  useMutation: ({ kind }: { kind: string }) => ({
    mutate: kind === 'download' ? download : kind === 'restore' ? restore : ignore,
    isPending: false
  }),
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
  expect(screen.queryByRole('button', { name: '加入收件箱' })).toBeNull()
  fireEvent.click(screen.getByText('Deleted source gallery'))
  fireEvent.click(screen.getByRole('button', { name: '加入收件箱' }))
  expect(download).toHaveBeenCalledWith(
    expect.objectContaining({
      deferredItemIds: ['orphan'],
      downloadMode: 'AUTO',
      quality: 'DISPLAY',
      downloadScope: 'ALL'
    })
  )
})
it('sends FIRST_20 for every selected deferred row and changes the request key when the scope changes', () => {
  render(<ArchiveDiscoveryDeferred onClose={() => {}} />)
  fireEvent.click(screen.getByRole('checkbox', { name: '选择已加载的稍后决定，最多一百条' }))
  expect(screen.getByRole('button', { name: '加入收件箱' }).textContent).toBe('加入收件箱（2）')
  expect(screen.getByRole('button', { name: '恢复待办' }).textContent).toBe('恢复待办（2）')
  fireEvent.click(screen.getByRole('button', { name: '自动下载 · 展示图 · 全部' }))
  fireEvent.click(screen.getByRole('radio', { name: '前20张' }))
  fireEvent.click(screen.getByRole('button', { name: '完成' }))
  fireEvent.click(
    within(screen.getByRole('region', { name: '稍后决定批量操作' })).getByRole('button', { name: '加入收件箱' })
  )
  const first = download.mock.calls[0]![0]
  expect(first).toMatchObject({ deferredItemIds: ['orphan', 'live'], downloadScope: 'FIRST_20' })
  fireEvent.click(screen.getByRole('button', { name: '自动下载 · 展示图 · 前20张' }))
  fireEvent.click(screen.getByRole('radio', { name: '全部' }))
  fireEvent.click(screen.getByRole('button', { name: '完成' }))
  fireEvent.click(
    within(screen.getByRole('region', { name: '稍后决定批量操作' })).getByRole('button', { name: '加入收件箱' })
  )
  expect(download.mock.calls[1]![0]).toMatchObject({ deferredItemIds: ['orphan', 'live'], downloadScope: 'ALL' })
  expect(download.mock.calls[1]![0].requestId).not.toBe(first.requestId)
})

it('keeps deferred navigation separate and selects metadata or the keyboard row once', () => {
  render(<ArchiveDiscoveryDeferred onClose={() => {}} />)
  const checkbox = screen.getByRole('checkbox', { name: '选择 Live source gallery' })
  const row = checkbox.closest('[data-discovery-item]') as HTMLElement
  const source = within(row).getByRole('link', { name: '打开原站 Live source gallery' })
  expect(source.textContent).toContain('原站')
  expect(source.getAttribute('target')).toBe('_blank')
  expect(source.getAttribute('referrerpolicy')).toBe('no-referrer')
  expect(within(row).getAllByRole('link')).toHaveLength(1)
  fireEvent.click(source)
  expect(checkbox.getAttribute('aria-checked')).toBe('false')
  fireEvent.click(within(row).getByText('Live'))
  expect(checkbox.getAttribute('aria-checked')).toBe('true')
  fireEvent.keyDown(row, { key: 'Enter' })
  expect(checkbox.getAttribute('aria-checked')).toBe('false')
  fireEvent.click(checkbox)
  expect(checkbox.getAttribute('aria-checked')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: '恢复待办' }))
  expect(restore).toHaveBeenCalledWith(
    expect.objectContaining({ deferredItemIds: ['live'], requestId: expect.any(String) })
  )
})
it('opens ignore confirmation from the selected bar and retains the request identity on retry', async () => {
  render(<ArchiveDiscoveryDeferred onClose={() => {}} />)
  fireEvent.click(screen.getByText('Live source gallery'))
  fireEvent.keyDown(screen.getByRole('button', { name: '更多操作' }), { key: 'Enter' })
  const ignoreAction = await screen.findByRole('menuitem', { name: '忽略' })
  expect(ignoreAction.textContent).toBe('忽略（1）')
  fireEvent.click(ignoreAction)
  const confirmation = await screen.findByRole('alertdialog')
  expect(within(confirmation).getByText('Live source gallery')).toBeTruthy()
  expect(ignore).not.toHaveBeenCalled()
  fireEvent.click(within(confirmation).getByRole('button', { name: '确认忽略' }))
  fireEvent.click(within(confirmation).getByRole('button', { name: '确认忽略' }))
  expect(ignore.mock.calls[0]![0]).toMatchObject({ deferredItemIds: ['live'], requestId: expect.any(String) })
  expect(ignore.mock.calls[1]).toEqual(ignore.mock.calls[0])
})
