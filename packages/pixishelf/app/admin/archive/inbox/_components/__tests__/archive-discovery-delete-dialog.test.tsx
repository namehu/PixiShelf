import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server'

const mocks = vi.hoisted(() => ({ preview: vi.fn(), remove: vi.fn(), cancel: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archiveSearch: {
      getDeletePreview: {
        queryOptions: (input: unknown, options: object) => ({
          queryKey: ['delete-preview', input],
          queryFn: mocks.preview,
          ...options
        })
      },
      deleteSource: { mutationOptions: (options: object) => ({ mutationFn: mocks.remove, ...options }) },
      cancelScan: { mutationOptions: (options: object) => ({ mutationFn: mocks.cancel, ...options }) }
    }
  })
}))
import { ArchiveDiscoveryDeleteDialog } from '../archive-discovery-delete-dialog'

type Preview = NonNullable<inferRouterOutputs<AppRouter>['archiveSearch']['getDeletePreview']>
const idle: Preview = {
  sourceId: 'one',
  displayName: 'Private source',
  scanRunCount: 2,
  catalogItemCount: 31,
  blockingRun: null
}
const active: Preview = {
  ...idle,
  blockingRun: { id: 'run', status: 'RUNNING', systemJob: { id: 'job', status: 'RUNNING' } }
}
const callbacks = { onClose: vi.fn(), onDeleted: vi.fn(async () => undefined) }
let client: QueryClient
beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  mocks.preview.mockResolvedValue(idle)
  mocks.remove.mockResolvedValue({ sourceId: 'one', deleted: true })
  mocks.cancel.mockResolvedValue({ id: 'run', status: 'CANCELLING' })
})
afterEach(() => {
  cleanup()
  client.clear()
})
function show() {
  render(
    <QueryClientProvider client={client}>
      <ArchiveDiscoveryDeleteDialog sourceId="one" {...callbacks} />
    </QueryClientProvider>
  )
}

describe('discovery source deletion confirmation', () => {
  it('previews the full scope, protects the source name and deletes only after confirmation', async () => {
    show()
    expect((await screen.findByText('Private source')).getAttribute('data-privacy-sensitive')).toBe('')
    expect(screen.getByText('将删除 2 条扫描记录和 31 条发现结果。')).toBeTruthy()
    expect(screen.getByText(/已加入收件箱的项目、归档任务和本地作品会保留/)).toBeTruthy()
    expect(mocks.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(callbacks.onClose).toHaveBeenCalledOnce())
    expect(mocks.remove.mock.calls[0]?.[0]).toEqual({ sourceId: 'one' })
    expect(callbacks.onDeleted).toHaveBeenCalledWith('one')
  })

  it('cancels a scan, waits for its terminal state and requires a separate delete click', async () => {
    mocks.preview.mockResolvedValue(active)
    show()
    await screen.findByText('请先结束扫描')
    expect((screen.getByRole('button', { name: '确认删除' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '取消扫描' }))
    await screen.findByText('正在取消扫描')
    expect(mocks.cancel.mock.calls[0]?.[0]).toEqual({ sourceId: 'one', runId: 'run' })
    expect(mocks.remove).not.toHaveBeenCalled()
    mocks.preview.mockResolvedValue(idle)
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['delete-preview'] })
    })
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '确认删除' }) as HTMLButtonElement).disabled).toBe(false)
    )
    expect(mocks.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(callbacks.onDeleted).toHaveBeenCalledOnce())
  })

  it('retains the dialog and refreshes activity after a server-side deletion conflict', async () => {
    mocks.remove.mockRejectedValue(new Error('state changed'))
    show()
    await screen.findByText('Private source')
    mocks.preview.mockResolvedValue(active)
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await screen.findByText('操作未完成')
    await screen.findByText('请先结束扫描')
    expect(callbacks.onClose).not.toHaveBeenCalled()
    expect(callbacks.onDeleted).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: '确认删除' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not allow deletion when the scope cannot be loaded, and supports retry', async () => {
    mocks.preview.mockRejectedValue(new Error('offline'))
    show()
    await screen.findByText('无法读取删除范围')
    expect(screen.queryByRole('button', { name: '确认删除' })).toBeNull()
    mocks.preview.mockResolvedValue(idle)
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await screen.findByText('Private source')
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('keeps cancellation errors visible and allows another attempt', async () => {
    mocks.preview.mockResolvedValue(active)
    mocks.cancel.mockRejectedValue(new Error('offline'))
    show()
    await screen.findByText('请先结束扫描')
    fireEvent.click(screen.getByRole('button', { name: '取消扫描' }))
    await screen.findByText('操作未完成')
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '取消扫描' }) as HTMLButtonElement).disabled).toBe(false)
    )
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('refreshes an already deleted source without submitting another destructive action', async () => {
    mocks.preview.mockResolvedValue(null)
    show()
    fireEvent.click(await screen.findByRole('button', { name: '关闭并刷新' }))
    await waitFor(() => expect(callbacks.onDeleted).toHaveBeenCalledWith('one'))
    expect(mocks.remove).not.toHaveBeenCalled()
  })
})
