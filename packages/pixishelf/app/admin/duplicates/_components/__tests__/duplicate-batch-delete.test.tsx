import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DuplicateBatchProgress } from '../duplicate-batch-delete'

const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/trpc', () => {
  const api = {
    artworkDedup: { listGroups: { queryKey: () => ['groups'] } },
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
