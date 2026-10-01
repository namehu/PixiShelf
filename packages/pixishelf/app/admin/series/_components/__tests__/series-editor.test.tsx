import React, { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { SeriesArtworkRow } from '@/schemas/series-management'
import { SeriesEditor, type SeriesEditorHandle } from '../series-editor'

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), confirm: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    series: {
      getManagementDetail: {
        queryOptions: (id: number) => ({ queryKey: ['management', id], queryFn: mocks.get, retry: false })
      },
      saveManagementChanges: { mutationOptions: () => ({ mutationFn: mocks.save }) },
      list: { queryKey: () => ['list'] },
      get: { queryKey: () => ['public'] }
    }
  })
}))
vi.mock('@/components/shared/global-confirm', () => ({ confirm: mocks.confirm }))
vi.mock('../series-dialog', () => ({ SeriesDialog: () => null }))
vi.mock('../series-add-artwork-sheet', () => ({
  SeriesAddArtworkSheet: ({
    open,
    onAdd,
    onOpenChange
  }: {
    open: boolean
    onAdd: (rows: SeriesArtworkRow[]) => void
    onOpenChange: (value: boolean) => void
  }) =>
    open ? (
      <button
        onClick={() => {
          onAdd([
            {
              id: 2001,
              title: '新作品',
              thumbnailUrl: null,
              author: '',
              mediaCount: 1,
              sortOrder: 0,
              provenance: 'MANUAL',
              orderOverridden: false
            }
          ])
          onOpenChange(false)
        }}
      >
        确认加入
      </button>
    ) : null
}))
vi.mock('../series-artwork-list', () => ({
  Cover: () => null,
  SeriesArtworkList: ({
    rows,
    onOrder,
    fullIds,
    onPosition,
    sortingDisabled
  }: {
    rows: SeriesArtworkRow[]
    fullIds: number[]
    sortingDisabled: boolean
    onOrder: (ids: number[]) => void
    onPosition: (id: number) => void
  }) => (
    <div>
      <span>列表数量 {rows.length}</span>
      <button disabled={sortingDisabled} onClick={() => onOrder([...fullIds].reverse())}>
        模拟调整顺序
      </button>
      <button disabled={sortingDisabled} onClick={() => onPosition(fullIds[0]!)}>
        指定位置
      </button>
    </div>
  )
}))
const artworks: SeriesArtworkRow[] = Array.from({ length: 2000 }, (_, i) => ({
  id: i + 1,
  title: `作品 ${i + 1}`,
  author: '',
  mediaCount: 1,
  thumbnailUrl: null,
  sortOrder: i + 1,
  provenance: 'MANUAL',
  orderOverridden: false
}))
const data = {
  id: 7,
  title: '测试系列',
  description: '',
  coverImageUrl: null,
  storedCoverImageUrl: null,
  pixivSource: null,
  artworks,
  recoverableMembers: [],
  maxStoredSortOrder: 2000,
  membershipFingerprint: 'a'.repeat(64)
}
function mount() {
  const ref = createRef<SeriesEditorHandle>()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SeriesEditor seriesId={7} ref={ref} onDelete={vi.fn()} />
    </QueryClientProvider>
  )
  return ref
}
describe('series editor workflow', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.get.mockResolvedValue(data)
    mocks.save.mockResolvedValue({ membershipFingerprint: 'b'.repeat(64) })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })
  it('selects all filtered results, including unmounted rows, then saves only the final membership', async () => {
    mount()
    await screen.findByText('列表数量 2000')
    fireEvent.change(screen.getByLabelText('搜索系列内作品'), { target: { value: '作品 1' } })
    expect((screen.getByText('模拟调整顺序') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('全选当前搜索结果'))
    const removing = artworks.filter((r) => r.title.includes('作品 1')).map((r) => r.id)
    expect(screen.getByText(`已选 ${removing.length} 件`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '从系列移除' }))
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(mocks.save.mock.calls[0]![0]).toMatchObject({
      finalArtworkIds: artworks.filter((r) => !removing.includes(r.id)).map((r) => r.id),
      explicitReorder: false
    })
  })
  it('undo clears reorder state, redo restores it, and explicit positions are one based', async () => {
    const ref = mount()
    await screen.findByText('列表数量 2000')
    fireEvent.click(screen.getByText('模拟调整顺序'))
    expect(ref.current?.dirty).toBe(true)
    fireEvent.click(screen.getByLabelText('撤销'))
    expect(ref.current?.dirty).toBe(false)
    fireEvent.click(screen.getByLabelText('重做'))
    fireEvent.click(screen.getByText('指定位置'))
    fireEvent.change(screen.getByLabelText('目标序号（1–2000）'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: '移动' }))
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    const input = mocks.save.mock.calls[0]![0] as { finalArtworkIds: number[]; explicitReorder: boolean }
    expect(input.finalArtworkIds[19]).toBe(2000)
    expect(input.explicitReorder).toBe(true)
  })
  it('keeps additions and draft on save failure and blocks stale resubmission on conflict', async () => {
    mocks.save.mockRejectedValue({ data: { code: 'CONFLICT' }, message: 'stale' })
    const ref = mount()
    await screen.findByText('列表数量 2000')
    fireEvent.click(screen.getByRole('button', { name: '添加作品' }))
    fireEvent.click(screen.getByText('确认加入'))
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
    await screen.findByText('需要重新加载')
    expect(screen.getByText('列表数量 2001')).toBeTruthy()
    expect(ref.current?.dirty).toBe(true)
    expect((screen.getByRole('button', { name: '保存更改' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
  })
})
