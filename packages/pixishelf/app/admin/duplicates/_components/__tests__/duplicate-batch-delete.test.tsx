import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DuplicateBatchProgress } from '../duplicate-batch-delete'

const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/trpc', () => {
  const api = {
    artworkDedup: {
      listGroups: { queryKey: () => ['groups'] },
      resolveDeleteSelection: { queryKey: () => ['selection'] }
    },
    artwork: {
      batchDeleteList: {
        queryOptions: (input: unknown) => ({ queryKey: ['batches', input], queryFn: () => mocks.list() })
      },
      batchDeleteStop: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      batchDeleteRetry: { mutationOptions: () => ({ mutationFn: vi.fn() }) }
    }
  }
  return { useTRPC: () => api }
})
afterEach(cleanup)
describe('compact deletion progress', () => {
  it('refreshes again at physical archive completion and leaves success visible only in records', async () => {
    const batch = {
      jobId: 'batch-moving',
      status: 'COMPLETED',
      confirmed: true,
      total: 1,
      message: '处理完成',
      items: [
        {
          artworkId: 9,
          title: '作品9',
          status: 'TRASH_SUBMITTED',
          message: '等待文件移动',
          archiveJobId: 'archive-9',
          archiveStatus: 'RUNNING',
          archiveLifecycleState: 'TRASHING'
        }
      ],
      archives: [{ id: 'archive-9', status: 'RUNNING' }]
    }
    mocks.list.mockResolvedValue([batch])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const changed = vi.fn()
    const view = render(
      <QueryClientProvider client={client}>
        <DuplicateBatchProgress
          userId="user-a"
          runId="run-1"
          onConfirm={vi.fn()}
          pendingOnly
          onResultsChanged={changed}
        />
      </QueryClientProvider>
    )
    await screen.findByText('回收已提交，1 部等待文件移动。')
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1))
    act(() =>
      client.setQueryData(
        ['batches', { expectedUserId: 'user-a', runId: 'run-1' }],
        [
          {
            ...batch,
            items: [{ ...batch.items[0], archiveStatus: 'COMPLETED' }],
            archives: [{ id: 'archive-9', status: 'COMPLETED' }]
          }
        ]
      )
    )
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('处理完成')).toBeNull()
    view.rerender(
      <QueryClientProvider client={client}>
        <DuplicateBatchProgress userId="user-a" runId="run-1" onConfirm={vi.fn()} />
      </QueryClientProvider>
    )
    await screen.findByText('处理完成')
    fireEvent.click(screen.getByText('查看全部 1 部作品的处理结果'))
    await screen.findByText(/文件已移入回收站/)
    client.clear()
  })

  it('keeps failures and cancelled work with remaining items while hiding completed direct and already trashed successes', async () => {
    mocks.list.mockResolvedValue([
      {
        jobId: 'success',
        confirmed: true,
        status: 'COMPLETED',
        message: '全部成功',
        total: 2,
        archives: [],
        items: [
          { artworkId: 1, status: 'DELETED' },
          {
            artworkId: 2,
            status: 'TRASH_SUBMITTED',
            archiveLifecycleState: 'TRASHED',
            archiveJobId: null,
            archiveStatus: null
          }
        ]
      },
      {
        jobId: 'failed',
        confirmed: true,
        status: 'FAILED',
        message: '仍有失败',
        total: 1,
        archives: [],
        items: [{ artworkId: 3, status: 'FAILED', message: '文件已变化，请重试', title: '作品3' }]
      },
      {
        jobId: 'cancelled',
        confirmed: true,
        status: 'CANCELLED',
        message: '已停止后续删除',
        total: 1,
        archives: [],
        items: [{ artworkId: 4, status: 'PENDING' }]
      }
    ])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <DuplicateBatchProgress userId="user-a" runId="run-1" onConfirm={vi.fn()} pendingOnly />
      </QueryClientProvider>
    )
    await screen.findByText('仍有失败')
    expect(screen.queryByText('全部成功')).toBeNull()
    expect(screen.getByText(/已停止后续删除/)).toBeTruthy()
    expect(screen.getByText(/文件已变化，请重试/)).toBeTruthy()
    client.clear()
  })
  it('highlights archive movement waits and failures outside collapsed work details, links existing jobs and expands safely', async () => {
    mocks.list.mockResolvedValue([
      {
        jobId: 'batch-1',
        status: 'COMPLETED',
        stage: 'COMPLETED',
        progress: 100,
        message: '处理完成：2 部成功，0 部失败',
        confirmed: true,
        stopAfterCurrent: false,
        total: 2,
        items: [
          {
            artworkId: 1,
            title: '私有作品名称甲',
            status: 'TRASH_SUBMITTED',
            message: '回收已提交，等待文件移动',
            archiveJobId: 'archive-1',
            archiveStatus: 'PENDING'
          },
          {
            artworkId: 2,
            title: '私有作品名称乙',
            status: 'TRASH_SUBMITTED',
            message: '回收已提交，等待文件移动',
            archiveJobId: 'archive-2',
            archiveStatus: 'FAILED'
          }
        ],
        archives: [
          { id: 'archive-1', status: 'PENDING' },
          { id: 'archive-2', status: 'FAILED' }
        ]
      }
    ])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <DuplicateBatchProgress userId="user-a" runId="run-1" onConfirm={vi.fn()} />
      </QueryClientProvider>
    )
    await screen.findByText('回收已提交，1 部等待文件移动。')
    expect(screen.getByText('1 部回收文件移动失败，请查看回收任务。')).toBeTruthy()
    expect(screen.getByRole('link', { name: '查看作品 #2 的回收任务' }).getAttribute('href')).toBe(
      '/admin/tasks?jobId=archive-2'
    )
    expect(screen.queryByText('私有作品名称甲')).toBeNull()
    fireEvent.click(screen.getByText('查看全部 2 部作品的处理结果'))
    const title = await screen.findByText('私有作品名称甲')
    expect(title.hasAttribute('data-privacy-sensitive')).toBe(true)
    client.clear()
  })
})
