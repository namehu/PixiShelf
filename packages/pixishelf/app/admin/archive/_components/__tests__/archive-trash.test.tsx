import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { ArchiveTrash } from '../archive-trash'

const mocks = vi.hoisted(() => ({ list: vi.fn(), restore: vi.fn(), retry: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archive: {
      pathKey: () => ['archive'],
      listTrash: {
        queryOptions: (input: unknown, options: object) => ({
          queryKey: ['archive', 'trash', input],
          queryFn: () => mocks.list(input),
          ...options
        })
      },
      restoreTrash: { mutationOptions: (options: object) => ({ mutationFn: mocks.restore, ...options }) },
      retryTrash: { mutationOptions: (options: object) => ({ mutationFn: mocks.retry, ...options }) }
    },
    archiveUploader: { pathKey: () => ['sources'] },
    archiveSearch: { pathKey: () => ['archiveSearch'] }
  })
}))
vi.mock('@/components/privacy/privacy-sensitive-text', () => ({
  PrivacySensitiveText: ({ children }: { children: ReactNode }) => <span>{children}</span>
}))
vi.mock('@/components/source-preview/source-preview-button', () => ({
  SourcePreviewButton: () => <button>原站预览</button>
}))
vi.mock('../../../_components/admin-workbench', () => ({
  AdminWorkbench: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => (
    <main>
      {actions}
      {children}
    </main>
  )
}))

const row = {
  id: 1,
  title: '可恢复作品',
  deletedAt: '2026-10-11T12:00:00Z',
  purgeAfter: '2099-10-18T12:00:00Z',
  lifecycleState: 'TRASHED',
  sources: [{ providerKey: 'test', externalId: '1' }],
  taskId: 'task-1',
  canRestore: true,
  canRetry: false,
  maintenance: null
}

beforeEach(() => {
  mocks.list.mockResolvedValue({ items: [row], count: 1, nextCursor: null })
  mocks.restore.mockResolvedValue({ items: [{ targetId: '1', result: 'APPLIED', message: '已提交恢复任务' }] })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <ArchiveTrash />
    </QueryClientProvider>
  )
}

describe('archive trash workbench', () => {
  it('invalidates current source lists and counts when Worker restoration removes the trash entry', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
    mount(client)
    await screen.findByText('可恢复作品')
    const keys = [
      ['archiveSearch', 'catalogCounts'],
      ['archiveSearch', 'listCatalogItems']
    ]
    for (const key of keys) client.setQueryData(key, { deleted: 1 })
    expect(keys.every((key) => !client.getQueryState(key)?.isInvalidated)).toBe(true)
    mocks.list.mockResolvedValue({ items: [], count: 0, nextCursor: null })
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await screen.findByText('回收站为空')
    await waitFor(() => expect(keys.every((key) => client.getQueryState(key)?.isInvalidated)).toBe(true))
  })
  it('restores selected eligible works and displays per-item results', async () => {
    mount()
    await screen.findByText('可恢复作品')
    fireEvent.click(screen.getByRole('checkbox', { name: '选择本页可恢复作品' }))
    fireEvent.click(screen.getByRole('button', { name: '恢复所选' }))
    await waitFor(() =>
      expect(mocks.restore).toHaveBeenCalledWith(
        expect.objectContaining({ artworkIds: [1], idempotencyKey: expect.stringContaining('archive-restore:') }),
        expect.anything()
      )
    )
    expect(await screen.findByText('作品 #1：已提交恢复任务')).toBeTruthy()
    expect(screen.queryByText('永久删除')).toBeNull()
  })

  it('shows expired works as awaiting cleanup, without a restore action', async () => {
    mocks.list.mockResolvedValue({
      items: [{ ...row, purgeAfter: '2000-01-01T00:00:00Z', canRestore: false }],
      count: 1,
      nextCursor: null
    })
    mount()
    expect(await screen.findByText('等待清理')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '恢复' })).toBeNull()
    expect(screen.getByRole('checkbox', { name: '选择作品 可恢复作品' }).hasAttribute('disabled')).toBe(true)
  })

  it('resets selection when searching and sends server-side search input', async () => {
    mount()
    await screen.findByText('可恢复作品')
    fireEvent.click(screen.getByRole('checkbox', { name: '选择本页可恢复作品' }))
    fireEvent.change(screen.getByRole('textbox', { name: '搜索回收站' }), { target: { value: '新搜索' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    await waitFor(() =>
      expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ search: '新搜索', cursor: undefined }))
    )
    expect(screen.getByText('已选 0 件')).toBeTruthy()
  })
})
