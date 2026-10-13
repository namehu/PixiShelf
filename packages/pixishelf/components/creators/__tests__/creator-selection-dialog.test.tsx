import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CreatorSelectionDialog } from '../creator-selection-dialog'
import type { CreatorOption } from '../creator-picker'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

const mocks = vi.hoisted(() => ({ search: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    artist: {
      queryPage: {
        queryOptions: (input: { search: string }, options: object) => ({
          queryKey: ['artists', input.search],
          queryFn: () => mocks.search(input.search),
          ...options
        })
      }
    }
  })
}))
const alice = { id: 1, name: 'Alice', kind: 'PERSON' }
const group = { id: 2, name: 'Alice', kind: 'GROUP' }
const originalScrollIntoView = Element.prototype.scrollIntoView
let queryClient: QueryClient
beforeEach(() => {
  vi.clearAllMocks()
  mocks.search.mockResolvedValue({ data: [alice, group] })
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.unstubAllGlobals()
  Element.prototype.scrollIntoView = originalScrollIntoView
})
function Harness({ maxSelected = 200 }: { maxSelected?: number }) {
  const [selected, setSelected] = useState<CreatorOption[]>([])
  return (
    <QueryClientProvider client={queryClient}>
      <Dialog open>
        <DialogContent>
          <DialogTitle>新增来源</DialogTitle>
          <DialogDescription>来源配置</DialogDescription>
          <CreatorSelectionDialog
            value={selected}
            onChange={setSelected}
            onCreate={vi.fn()}
            disabled={false}
            maxSelected={maxSelected}
          />
        </DialogContent>
      </Dialog>
    </QueryClientProvider>
  )
}
const open = async () => {
  fireEvent.click(screen.getByRole('button', { name: '添加绑定艺术家' }))
  return await screen.findByRole('option', { name: /Alice.*#1/ })
}

describe('creator selection inside a source dialog', () => {
  it('keeps search open and focused during list scrolling, multi-selects distinct IDs and returns to the source', async () => {
    render(<Harness />)
    const first = await open()
    const input = screen.getByRole('combobox', { name: '搜索并选择艺术家或社团' })
    expect(document.activeElement).toBe(input)
    const list = screen.getByRole('listbox', { name: '艺术家搜索结果' })
    fireEvent.touchStart(list, {
      touches: [{ clientX: 10, clientY: 80 }],
      changedTouches: [{ clientX: 10, clientY: 80 }]
    })
    fireEvent.touchMove(list, {
      touches: [{ clientX: 10, clientY: 30 }],
      changedTouches: [{ clientX: 10, clientY: 30 }]
    })
    fireEvent.scroll(list)
    fireEvent.touchEnd(list, { touches: [], changedTouches: [{ clientX: 10, clientY: 30 }] })
    expect(screen.getByRole('dialog', { name: '选择艺术家／社团' })).toBeTruthy()
    expect(document.activeElement).toBe(input)
    fireEvent.click(first)
    fireEvent.click(screen.getByRole('option', { name: /Alice.*社团.*#2/ }))
    expect(screen.getByText('已选 2 位')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '完成选择' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '选择艺术家／社团' })).toBeNull())
    expect(screen.getByRole('dialog', { name: '新增来源' })).toBeTruthy()
    expect(screen.getByRole('list', { name: '已绑定艺术家' }).children).toHaveLength(2)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '添加绑定艺术家' }))
  })
  it('enforces the limit while allowing an existing selection to be removed', async () => {
    render(<Harness maxSelected={1} />)
    fireEvent.click(await open())
    expect(screen.getByText('已选 1 位，已达 1 位上限')).toBeTruthy()
    const second = screen.getByRole('option', { name: /Alice.*社团.*#2/ })
    expect(second.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(second)
    expect(screen.getByText('已选 1 位，已达 1 位上限')).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: /Alice.*#1.*已选择/ }))
    expect(second.getAttribute('aria-disabled')).toBe('false')
  })
  it('keeps late results from replacing the current search and allows recovery from a failed query', async () => {
    let resolveOld!: (value: unknown) => void
    mocks.search.mockImplementation((search: string) =>
      search === 'old'
        ? new Promise((resolve) => {
            resolveOld = resolve
          })
        : search === 'failed'
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({ data: [{ ...alice, name: search || 'Alice' }] })
    )
    render(<Harness />)
    await open()
    const input = screen.getByRole('combobox', { name: '搜索并选择艺术家或社团' })
    fireEvent.change(input, { target: { value: 'old' } })
    await waitFor(() => expect(mocks.search).toHaveBeenCalledWith('old'))
    fireEvent.change(input, { target: { value: 'new' } })
    await screen.findByRole('option', { name: /new.*#1/ })
    await act(async () => resolveOld({ data: [{ ...alice, name: 'old' }] }))
    expect(screen.queryByRole('option', { name: /old.*#1/ })).toBeNull()
    fireEvent.change(input, { target: { value: 'failed' } })
    await screen.findByText('艺术家加载失败')
    mocks.search.mockResolvedValue({ data: [alice] })
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await screen.findByRole('option', { name: /Alice.*#1/ })
  })
})
