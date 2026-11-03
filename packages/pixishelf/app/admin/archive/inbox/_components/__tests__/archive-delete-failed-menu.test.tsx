import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DropdownMenuGroup } from '@/components/ui/dropdown-menu'

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
import { ArchiveDeleteFailedDialog } from '../archive-delete-failed-dialog'
import { ArchiveDiscoverySelectionBar } from '../archive-discovery-bulk-bar'

let client: QueryClient
beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
})
afterEach(() => {
  cleanup()
  client.clear()
})

function Menu({ itemIds = ['two', 'one'] }: { itemIds?: string[] }) {
  return (
    <QueryClientProvider client={client}>
      <ArchiveDiscoverySelectionBar
        selectedCount={2}
        pending={false}
        onClear={vi.fn()}
        primaryAction={<button>加入收件箱</button>}
        menuItems={
          <DropdownMenuGroup>
            <ArchiveDeleteFailedDialog itemIds={itemIds} targetType="DISCOVERY_ITEM" triggerVariant="menu" />
          </DropdownMenuGroup>
        }
      />
    </QueryClientProvider>
  )
}

async function openConfirmation() {
  fireEvent.keyDown(screen.getByRole('button', { name: '更多操作' }), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('menuitem', { name: '删除失败记录（2）' }))
  await screen.findByRole('alertdialog')
}

describe('failed record deletion from a selection menu', () => {
  it('keeps confirmation mounted and allows cancellation without deleting', async () => {
    render(<Menu />)
    await openConfirmation()
    expect(screen.getByText(/本地作品、图片和下载任务不受影响/)).toBeTruthy()
    expect(mocks.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByRole('menuitem', { name: '删除失败记录（2）' })).toBeTruthy()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('freezes the targets when opened and reuses the command key after a lost response', async () => {
    mocks.remove.mockRejectedValueOnce(new Error('network')).mockResolvedValue({
      id: 'operation',
      commandType: 'DELETE_FAILED_RECORDS',
      requestedCount: 2,
      counts: { created: 0, applied: 2, reused: 0, skipped: 0, conflict: 0, failed: 0 },
      items: []
    })
    const view = render(<Menu />)
    await openConfirmation()
    view.rerender(<Menu itemIds={['new-selection']} />)
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => {
      expect(mocks.remove).toHaveBeenCalledOnce()
      expect((screen.getByRole('button', { name: '确认删除' }) as HTMLButtonElement).disabled).toBe(false)
    })
    expect(mocks.remove.mock.calls[0]?.[0]).toMatchObject({
      targetType: 'DISCOVERY_ITEM',
      itemIds: ['one', 'two']
    })
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(2))
    expect(mocks.remove.mock.calls[1]?.[0]).toEqual(mocks.remove.mock.calls[0]?.[0])
  })
})
