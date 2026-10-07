import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ remove: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archiveInbox: {
      deleteFailedMany: { mutationOptions: (options: object) => ({ mutationFn: mocks.remove, ...options }) },
      list: { queryKey: () => ['inbox'] },
      summary: { queryKey: () => ['summary'] }
    },
    archiveSearch: { pathKey: () => ['search'] },
    archiveUploader: { pathKey: () => ['uploader'] }
  })
}))
import { ArchiveDeleteFailedDialog, ArchiveDeleteFailedResultProvider } from '../archive-delete-failed-dialog'
let client: QueryClient
beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
})
afterEach(() => {
  cleanup()
  client.clear()
})
const show = () =>
  render(
    <QueryClientProvider client={client}>
      <ArchiveDeleteFailedDialog itemIds={['two', 'one']} targetType="INTAKE_ITEM" />
    </QueryClientProvider>
  )
const result = {
  id: 'operation',
  commandType: 'DELETE_FAILED_RECORDS',
  requestedCount: 2,
  counts: { created: 0, applied: 1, reused: 0, skipped: 0, conflict: 1, failed: 0 },
  items: [
    { id: 'r1', targetId: 'one', result: 'APPLIED', message: '已删除' },
    { id: 'r2', targetId: 'two', result: 'CONFLICT', message: '活动扫描尚未结束' }
  ]
}

describe('delete failed records confirmation', () => {
  it('requires explicit confirmation, shows partial results and refreshes all affected queries', async () => {
    mocks.remove.mockResolvedValue(result)
    const invalidation = vi.spyOn(client, 'invalidateQueries')
    show()
    fireEvent.click(screen.getByRole('button', { name: '删除失败记录（2）' }))
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(screen.getByText(/本地作品、图片和下载任务不受影响/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await screen.findByText('活动扫描尚未结束')
    expect(mocks.remove.mock.calls[0]?.[0]).toMatchObject({ targetType: 'INTAKE_ITEM', itemIds: ['one', 'two'] })
    for (const key of ['inbox', 'summary', 'search', 'uploader']) {
      expect(invalidation).toHaveBeenCalledWith({ queryKey: [key] })
    }
  })
  it('keeps results visible after the deleted row unmounts', async () => {
    mocks.remove.mockResolvedValue(result)
    const view = render(
      <QueryClientProvider client={client}>
        <ArchiveDeleteFailedResultProvider>
          <ArchiveDeleteFailedDialog itemIds={['one']} targetType="DISCOVERY_ITEM" />
        </ArchiveDeleteFailedResultProvider>
      </QueryClientProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: '删除失败记录' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await screen.findByText('活动扫描尚未结束')
    view.rerender(
      <QueryClientProvider client={client}>
        <ArchiveDeleteFailedResultProvider>{null}</ArchiveDeleteFailedResultProvider>
      </QueryClientProvider>
    )
    expect(screen.getByText('活动扫描尚未结束')).toBeTruthy()
  })

  it('reuses the same request key after a response is lost', async () => {
    mocks.remove.mockRejectedValueOnce(new Error('network')).mockResolvedValue(result)
    show()
    fireEvent.click(screen.getByRole('button', { name: '删除失败记录（2）' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '确认删除' }) as HTMLButtonElement).disabled).toBe(false)
    )
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await screen.findByText('活动扫描尚未结束')
    expect(mocks.remove.mock.calls[1]?.[0]).toEqual(mocks.remove.mock.calls[0]?.[0])
  })
})
