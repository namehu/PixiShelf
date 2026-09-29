import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CreatorMaintenancePanel } from '../creator-maintenance-panel'

const api = vi.hoisted(() => ({
  prepare: vi.fn(),
  start: vi.fn(),
  status: vi.fn()
}))

vi.mock('@/lib/trpc', () => ({
  useTRPCClient: () => ({}),
  useTRPC: () => ({
    creator: {
      history: { queryOptions: () => ({ queryKey: ['history'], queryFn: async () => [] }) },
      mappings: { queryOptions: () => ({ queryKey: ['mappings'], queryFn: async () => ({ items: [] }) }) },
      status: {
        queryOptions: (_input: unknown, options: object) => ({ queryKey: ['status'], queryFn: api.status, ...options })
      },
      prepare: { mutationOptions: (options: object) => ({ mutationFn: api.prepare, ...options }) },
      start: { mutationOptions: (options: object) => ({ mutationFn: api.start, ...options }) }
    }
  })
}))

vi.mock('../creator-picker', () => ({
  CreatorPicker: ({ onChange }: { onChange: (value: { id: number; name: string }[]) => void }) => (
    <button onClick={() => onChange([{ id: 7, name: '测试作者' }])}>选择测试作者</button>
  )
}))

function mount(artworkIds?: number[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CreatorMaintenancePanel artworkIds={artworkIds} />
    </QueryClientProvider>
  )
  return client
}

beforeEach(() => {
  vi.clearAllMocks()
  api.prepare.mockResolvedValue({ planId: 'plan-1' })
  api.start.mockResolvedValue({})
  api.status.mockResolvedValue({
    plan: { command: 'BACKFILL', status: 'READY', fingerprint: 'saved-preview' },
    job: null,
    counts: [{ status: 'PENDING', _count: 1 }],
    items: [
      {
        id: 1,
        artworkId: 12,
        status: 'PENDING',
        review: { label: '作者／社团', before: '未填写', after: '测试作者', basis: '原网站的作者标签', note: null },
        payload: { title: '测试作品', description: '当前：未关联；同步来源标签：artist:测试作者；保留人工归属和排除' },
        result: {}
      }
    ]
  })
})
afterEach(cleanup)

describe('creator maintenance choices', () => {
  it('keeps manual changes scoped to selected works and does not apply a check automatically', async () => {
    const client = mount([12])
    fireEvent.mouseDown(screen.getByRole('tab', { name: '手动修改作者' }), { button: 0, ctrlKey: false })
    fireEvent.click(screen.getByRole('button', { name: '选择测试作者' }))
    fireEvent.click(screen.getByRole('button', { name: '先看看会怎么改' }))
    await waitFor(() => expect(api.prepare).toHaveBeenCalled())
    expect(api.prepare.mock.calls[0]![0]).toEqual({ command: 'ADD', artworkIds: [12], creatorIds: [7] })
    expect(api.start).not.toHaveBeenCalled()
    client.clear()
  })

  it('requires a separate confirmation of the stored preview before saving', async () => {
    const client = mount([12])
    fireEvent.click(screen.getByRole('button', { name: '先看看会怎么改' }))
    const confirm = await screen.findByRole('button', { name: '确认修改全部 1 项' })
    expect(screen.getByText('未填写')).toBeTruthy()
    expect(screen.getByText('测试作者')).toBeTruthy()
    expect(screen.getByText('等待你确认')).toBeTruthy()
    expect(screen.queryByText(/保留你手动添加和移除作者的结果/)).toBeNull()
    expect(screen.getByRole('link', { name: '打开作品核对（新标签页）' }).getAttribute('target')).toBe('_blank')
    expect(api.start).not.toHaveBeenCalled()
    fireEvent.click(confirm)
    await waitFor(() => expect(api.start).toHaveBeenCalled())
    expect(api.start.mock.calls[0]![0]).toEqual({ planId: 'plan-1', fingerprint: 'saved-preview' })
    client.clear()
  })

  it('does not offer unscoped manual edits or series changes', () => {
    const client = mount()
    expect(screen.queryByRole('tab', { name: '手动修改作者' })).toBeNull()
    expect(screen.queryByRole('tab', { name: '加入系列' })).toBeNull()
    expect(screen.getByText(/本次将检查全部归档作品/)).toBeTruthy()
    client.clear()
  })
})
