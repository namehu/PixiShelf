import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DuplicateOperationSheet } from '../duplicate-operation-sheet'
import { exactRelation, member, operation } from './duplicate-maintenance-fixtures'

const mocks = vi.hoisted(() => ({ get: vi.fn(), directDelete: vi.fn(), cancel: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    artworkDedup: {
      getOperation: {
        queryOptions: (input: unknown) => ({ queryKey: ['operation', input], queryFn: () => mocks.get(input) }),
        queryKey: () => ['operation']
      },
      listOperations: { queryKey: () => ['operations'] },
      directDelete: { mutationOptions: () => ({ mutationFn: mocks.directDelete }) },
      cancelOperation: { mutationOptions: () => ({ mutationFn: mocks.cancel }) },
      retryOperation: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      prepareCleanup: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      allowReimport: { mutationOptions: () => ({ mutationFn: vi.fn() }) }
    }
  })
}))
let client: QueryClient
beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })

describe('quick deletion sheet', () => {
  it('confirms DB scope once, then shows background verification and cancellation in the same sheet', async () => {
    let current = operation({
      preparationVersion: 2, jobId: null, stage: 'CONFIRM', allowedActions: ['DIRECT_DELETE']
    })
    mocks.get.mockImplementation((input: { preview?: { kind: string } }) => ({
      operation: current,
      preview: input.preview ? {
        kind: 'ARTWORKS',
        items: [1, 2].map((id) => ({
          ...exactRelation, ...member(id), itemId: id, groupId: 'group-1', role: id === 1 ? 'KEEPER' : 'COPY',
          status: 'SELECTED', reasons: [], sources: [], personalRecords: 'CURRENT', mediaCount: '6', fileCount: '6',
          canAllowReimport: false
        })),
        nextCursor: null
      } : null
    }))
    mocks.directDelete.mockImplementation(() => {
      current = { ...current, version: 2, mode: 'DIRECT_DELETE', status: 'VERIFYING', stage: 'FRESH', allowedActions: ['STOP'] }
      return current
    })
    mocks.cancel.mockImplementation(() => {
      current = { ...current, version: 3, status: 'CANCELLED', allowedActions: [] }
      return current
    })
    render(<QueryClientProvider client={client}>
      <DuplicateOperationSheet operationId="op-1" userId="user-a" onClose={vi.fn()} onNewOperation={vi.fn()} />
    </QueryClientProvider>)
    await screen.findByText('确认后在后台完整核对保留方和删除方的文件，通过后才开始删除。')
    await screen.findByText('作品 2')
    expect(screen.queryByRole('button', { name: '查看文件清单' })).toBeNull()
    expect(screen.queryByRole('button', { name: '取消本次处理' })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: /我理解永久删除/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /已暂停这些文件/ }))
    const submit = screen.getByRole('button', { name: '永久删除 1 部副本' }) as HTMLButtonElement
    await waitFor(() => expect(submit.disabled).toBe(false))
    fireEvent.click(submit)
    fireEvent.click(submit)
    await screen.findByText('已核验 0 / 12 个已登记文件，尚未删除文件。')
    expect(mocks.directDelete).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '取消本次处理' }))
    await screen.findByText('已取消，未删除文件。')
    expect(mocks.cancel).toHaveBeenCalledTimes(1)
    expect(mocks.get.mock.calls.every(([input]) => input.preview?.kind !== 'FILES')).toBe(true)
  })
})
