import React, { useImperativeHandle, useState, type Ref } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SeriesManagement from '../series-management'
import type { SeriesEditorHandle } from '../series-editor'

const mocks = vi.hoisted(() => ({ push: vi.fn(), save: vi.fn(), list: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    series: {
      list: {
        queryOptions: (input: unknown) => ({ queryKey: ['series', input], queryFn: () => mocks.list(input) }),
        queryKey: () => ['series']
      },
      delete: { mutationOptions: () => ({ mutationFn: vi.fn() }) }
    }
  })
}))
vi.mock('../../../_components/admin-workbench', () => ({
  AdminWorkbench: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))
vi.mock('../series-dialog', () => ({ SeriesDialog: () => null }))
vi.mock('../pixiv-series-reconciliation-dialog', () => ({ PixivSeriesReconciliationDialog: () => null }))
vi.mock('../series-editor', () => ({
  SeriesEditor: ({ seriesId, ref }: { seriesId: number; ref: Ref<SeriesEditorHandle> }) => {
    const [dirty, setDirty] = useState(false)
    useImperativeHandle(ref, () => ({
      dirty,
      saving: false,
      save: async () => {
        const result = await mocks.save()
        if (result) setDirty(false)
        return result
      },
      discard: () => setDirty(false)
    }))
    return <button onClick={() => setDirty(true)}>整理系列 {seriesId}</button>
  }
}))

function mount(initialSeriesId: number | null = 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SeriesManagement initialSeriesId={initialSeriesId ?? undefined} />
      <a href="/admin/artworks">离开工作台</a>
    </QueryClientProvider>
  )
}

describe('series draft navigation protection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    history.replaceState(null, '', '/admin/series/1')
    mocks.save.mockResolvedValue(true)
    mocks.list.mockResolvedValue({
      total: 2,
      items: [1, 2].map((id) => ({ id, title: `目录 ${id}`, artworkCount: 0, sourceKind: 'LOCAL', pixivSource: null }))
    })
  })
  afterEach(cleanup)

  it('opens the artwork drawer from the list and keeps a dirty draft when closure is canceled', async () => {
    mount()
    await screen.findByText('目录 2')
    expect(screen.getByRole('dialog', { name: '系列作品' })).toBeTruthy()
    fireEvent.click(screen.getByText('整理系列 1'))
    fireEvent.click(screen.getByRole('button', { name: '返回系列列表' }))
    await screen.findByText('还有未保存的更改')
    fireEvent.click(screen.getByText('继续整理'))
    expect(screen.getByText('整理系列 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '返回系列列表' }))
    fireEvent.click(screen.getByText('放弃并继续'))
    await waitFor(() => expect(screen.queryByText('整理系列 1')).toBeNull())
    expect(location.pathname).toBe('/admin/series')
    fireEvent.click(screen.getByRole('button', { name: '查看 目录 2 的作品' }))
    expect(screen.getByText('整理系列 2')).toBeTruthy()
    expect(location.pathname).toBe('/admin/series/2')
  })

  it('keeps the full series list and its page after closing the drawer', async () => {
    mocks.list.mockImplementation(({ page }: { page: number }) =>
      Promise.resolve({
        total: 40,
        items: [{ id: page, title: `目录 ${page}`, artworkCount: 0, sourceKind: 'LOCAL', pixivSource: null }]
      })
    )
    mount(null)
    await screen.findByRole('button', { name: '查看 目录 1 的作品' })
    fireEvent.click(screen.getByRole('button', { name: '下一页系列' }))
    await screen.findByRole('button', { name: '查看 目录 2 的作品' })
    fireEvent.click(screen.getByRole('button', { name: '查看 目录 2 的作品' }))
    expect(screen.getByText('整理系列 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '返回系列列表' }))
    await waitFor(() => expect(screen.queryByText('整理系列 2')).toBeNull())
    expect(screen.getByRole('button', { name: '查看 目录 2 的作品' })).toBeTruthy()
    expect((screen.getByRole('button', { name: '上一页系列' }) as HTMLButtonElement).disabled).toBe(false)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '查看 目录 2 的作品' })))
  })

  it('keeps a failed draft mounted and navigates only after save succeeds', async () => {
    mocks.save.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    mount()
    fireEvent.click(screen.getByText('整理系列 1'))
    fireEvent.click(screen.getByText('离开工作台'))
    await screen.findByText('还有未保存的更改')
    fireEvent.click(screen.getByText('保存并继续'))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(mocks.push).not.toHaveBeenCalled()
    expect(screen.getByText('整理系列 1')).toBeTruthy()
    await waitFor(() => expect((screen.getByText('保存并继续') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByText('保存并继续'))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/admin/artworks'))
  })

  it('protects refresh and browser history while a draft is dirty', async () => {
    mount()
    fireEvent.click(screen.getByText('整理系列 1'))
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    history.replaceState(null, '', '/admin/series/2')
    fireEvent(window, new PopStateEvent('popstate'))
    await screen.findByText('还有未保存的更改')
    expect(location.pathname).toBe('/admin/series/1')
    expect(screen.getByText('整理系列 1')).toBeTruthy()
  })
})
