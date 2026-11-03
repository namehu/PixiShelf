import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TArtworkTagDto } from '@/schemas/artwork.dto'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import TagArea from '../tag-area'
import { ArtworkMediaViewProvider, useArtworkMediaView } from '../artwork-media-view-context'

const mocks = vi.hoisted(() => ({ search: vi.fn(), save: vi.fn(), toast: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: mocks.toast } }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    tag: {
      list: {
        queryOptions: (input: unknown, options: object) => ({
          ...options,
          queryKey: [['tag', 'list'], { input }],
          queryFn: () => mocks.search(input)
        })
      },
      pathKey: () => [['tag']]
    },
    artwork: {
      updateTags: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.save }) },
      pathKey: () => [['artwork']]
    }
  })
}))

const source = { id: 1, name: 'source-tag', name_zh: '来源标签' }
const added = { id: 2, name: 'added-tag', name_zh: null }
function Probe({ toolbar }: { toolbar: boolean }) {
  const view = useArtworkMediaView()!
  useEffect(() => {
    view.setReaderBlocked(toolbar, 'toolbar')
    return () => view.setReaderBlocked(false, 'toolbar')
  }, [toolbar, view.setReaderBlocked])
  return <output data-testid="reader-blocked">{String(view.readerBlocked)}</output>
}
function mount(tags: TArtworkTagDto[] = [], toolbar = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <ArtworkMediaViewProvider>
        <Probe toolbar={toolbar} />
        <TagArea artworkId={42} tags={tags} />
      </ArtworkMediaViewProvider>
    </QueryClientProvider>
  )
  return { ...view, client }
}
const open = () => fireEvent.click(screen.getByRole('button', { name: '编辑作品标签' }))
const searchFor = (value: string) => fireEvent.change(screen.getByRole('combobox'), { target: { value } })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.search.mockResolvedValue({ items: [added] })
  mocks.save.mockResolvedValue([added])
  useArtworkAutoBrowseStore.setState(useArtworkAutoBrowseStore.getInitialState())
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
  vi.unstubAllGlobals()
})

describe('artwork detail tag editing', () => {
  it('shows the zero-tag entry without fetching, opens a clean draft and cancels with zero writes', async () => {
    mount()
    expect(screen.getByRole('button', { name: '编辑作品标签' }).textContent).toContain('添加标签')
    expect(mocks.search).not.toHaveBeenCalled()
    useArtworkAutoBrowseStore.setState({ status: 'running', artworkId: 42 })
    open()
    expect(mocks.search).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('reader-blocked').textContent).toBe('true')
    expect(useArtworkAutoBrowseStore.getState().reason).toBe('overlay')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.save).not.toHaveBeenCalled()
    expect(screen.getByTestId('reader-blocked').textContent).toBe('false')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '编辑作品标签' })))
  })

  it('keeps pill navigation and privacy markers, and discards removal on escape', async () => {
    mount([source], true)
    const link = screen.getByRole('link', { name: /#source-tag.*来源标签/ })
    expect(link.getAttribute('href')).toBe('/tags/1')
    expect(link.querySelector('[data-privacy-sensitive]')).toBeTruthy()
    open()
    fireEvent.click(screen.getByRole('button', { name: '移除标签 source-tag' }))
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.save).not.toHaveBeenCalled()
    expect(screen.getByTestId('reader-blocked').textContent).toBe('true')
    open()
    expect(screen.getByRole('button', { name: '移除标签 source-tag' })).toBeTruthy()
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('searches only after input and saves a delta, applying returned tags and marking both cache key styles stale', async () => {
    const { client } = mount([source])
    const customKey = ['artwork', 'cardList', 'random-v1', 'account']
    const standardKey = [['artwork', 'getById'], { input: 42, type: 'query' }]
    const tagKey = [['tag', 'list'], { input: { query: 'other' }, type: 'query' }]
    client.setQueryData(customKey, { pages: [{ items: [{ id: 42 }] }] })
    client.setQueryData(standardKey, { id: 42 })
    client.setQueryData(tagKey, { items: [] })
    open()
    fireEvent.click(screen.getByRole('button', { name: '移除标签 source-tag' }))
    searchFor('added')
    fireEvent.click(await screen.findByRole('option', { name: '#added-tag' }))
    expect(mocks.search).toHaveBeenCalledWith({ query: 'added', pageSize: 30 })
    expect(mocks.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        { artworkId: 42, addTagIds: [2], removeTagIds: [1], newTagNames: [] },
        expect.anything()
      )
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('link', { name: '#added-tag' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /#source-tag.*来源标签/ })).toBeNull()
    expect(client.getQueryState(customKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(standardKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(tagKey)?.isInvalidated).toBe(true)
    expect(client.getQueryData(customKey)).toEqual({ pages: [{ items: [{ id: 42 }] }] })
  })

  it('creates names only in the draft and retains the draft on a failed save', async () => {
    mocks.search.mockResolvedValue({ items: [] })
    mocks.save.mockRejectedValue({ message: '作品正在维护，请稍后重试。', data: { code: 'CONFLICT' } })
    mount()
    open()
    searchFor('  新标签  ')
    fireEvent.click(await screen.findByRole('option', { name: /创建并加入.*「新标签」/ }))
    expect(screen.getByText('待创建')).toBeTruthy()
    expect(screen.getByText('#新标签').hasAttribute('data-privacy-sensitive')).toBe(true)
    expect(mocks.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('作品正在维护')
    expect(screen.getByRole('button', { name: '移除待创建标签 新标签' })).toBeTruthy()
    expect(mocks.save.mock.calls[0]?.[0]).toEqual({
      artworkId: 42,
      addTagIds: [],
      removeTagIds: [],
      newTagNames: ['新标签']
    })
    mocks.save.mockResolvedValue([{ id: 3, name: '新标签', name_zh: null }])
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByRole('link', { name: '#新标签' })
  })

  it('removing a pending new tag restores the unchanged state and unmount only releases its own blocker', async () => {
    mocks.search.mockResolvedValue({ items: [] })
    const view = mount([], true)
    open()
    searchFor('new')
    fireEvent.click(await screen.findByRole('option', { name: /创建并加入.*「new」/ }))
    fireEvent.click(screen.getByRole('button', { name: '移除待创建标签 new' }))
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByTestId('reader-blocked').textContent).toBe('true')
    view.unmount()
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
