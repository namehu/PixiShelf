import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  append: vi.fn(),
  resolve: vi.fn(),
  success: vi.fn(),
  error: vi.fn()
}))
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archiveUploader: { resolveIdentity: { mutationOptions: () => ({ mutationFn: mocks.resolve }) } },
    archiveSearch: {
      createSource: { mutationOptions: (options: object) => ({ mutationFn: mocks.create, ...options }) },
      appendDefaultCreators: { mutationOptions: (options: object) => ({ mutationFn: mocks.append, ...options }) },
      renameSource: { mutationOptions: (options: object) => ({ mutationFn: vi.fn(), ...options }) }
    }
  })
}))
vi.mock('@/components/creators/creator-picker', () => ({
  CreatorPicker: ({ value }: { value: { id: number; name: string }[] }) => (
    <div aria-label="当前绑定艺术家">
      {value.map((artist) => (
        <span key={artist.id}>{artist.name}</span>
      ))}
    </div>
  )
}))
import { ArchiveSearchSourceDialog, type ArchiveSearchDialogState } from '../archive-search-source-dialog'

const artist = { id: 7, name: 'Original Artist', kind: 'PERSON' as const }
const state: ArchiveSearchDialogState = {
  mode: 'CREATE',
  initialValues: { keyword: artist.name, creators: [artist] },
  confirmExistingCreators: true
}
const source = {
  id: 'existing',
  displayName: 'Existing source',
  status: 'ARCHIVED',
  rulesVersion: 4,
  defaultCreators: [{ id: 8, name: 'Previous Artist', kind: 'PERSON' }],
  titleQuery: { keyword: artist.name }
}
const clients: QueryClient[] = []
function setup(initialState: ArchiveSearchDialogState | null = state) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
  clients.push(client)
  const onClose = vi.fn()
  const onSaved = vi.fn().mockResolvedValue(undefined)
  const element = (value: ArchiveSearchDialogState | null) => (
    <QueryClientProvider client={client}>
      <ArchiveSearchSourceDialog state={value} onClose={onClose} onSaved={onSaved} />
    </QueryClientProvider>
  )
  const view = render(element(initialState))
  return {
    ...view,
    onClose,
    onSaved,
    changeState: (value: ArchiveSearchDialogState | null) => view.rerender(element(value))
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.create.mockResolvedValue(source)
  mocks.append.mockResolvedValue({ ...source, defaultCreators: [...source.defaultCreators, artist] })
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
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})

describe('create source from an artist', () => {
  it('prefills the artist, preserves edited drafts on rerender, and resets when changing artist or reopening', async () => {
    const view = setup()
    expect((screen.getByLabelText('标题关键词') as HTMLInputElement).value).toBe(artist.name)
    expect(screen.getByLabelText('当前绑定艺术家').textContent).toBe(artist.name)
    fireEvent.change(screen.getByLabelText('标题关键词'), { target: { value: 'Edited' } })
    view.changeState(state)
    expect((screen.getByLabelText('标题关键词') as HTMLInputElement).value).toBe('Edited')
    const link = screen.getByRole('link', { name: '在 E-Hentai 搜索' })
    expect(new URL(link.getAttribute('href')!).searchParams.get('f_search')).toBe('title:"edited"')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(mocks.create).not.toHaveBeenCalled()
    view.changeState({
      ...state,
      initialValues: { keyword: 'Group', creators: [{ id: 9, name: 'Group', kind: 'GROUP' }] }
    })
    await waitFor(() => expect((screen.getByLabelText('标题关键词') as HTMLInputElement).value).toBe('Group'))
    expect(screen.getByLabelText('当前绑定艺术家').textContent).toBe('Group')
    view.changeState(null)
    view.changeState(state)
    await waitFor(() => expect((screen.getByLabelText('标题关键词') as HTMLInputElement).value).toBe(artist.name))
  })
  it('shows explicit confirmation and preserves old and disabled source details before appending', async () => {
    const view = setup()
    fireEvent.click(screen.getByRole('button', { name: '保存搜索来源' }))
    await screen.findByText('相同条件的来源已存在')
    expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({ keyword: artist.name, artistIds: [7] })
    expect(screen.getByText('Previous Artist').hasAttribute('data-privacy-sensitive')).toBe(true)
    expect(screen.getByText('Original Artist').hasAttribute('data-privacy-sensitive')).toBe(true)
    expect(screen.getByText(/该来源已停用/)).toBeTruthy()
    expect(screen.getByRole('link', { name: '查看已有来源' }).getAttribute('href')).toContain('sourceId=existing')
    expect(mocks.append).not.toHaveBeenCalled()
    expect(view.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '追加绑定' }))
    await waitFor(() => expect(view.onSaved).toHaveBeenCalledWith('existing'))
    expect(mocks.append.mock.calls[0]?.[0]).toEqual({ sourceId: 'existing', artistIds: [7], expectedRulesVersion: 4 })
    expect(view.onClose).toHaveBeenCalledOnce()
  })
  it('can cancel a duplicate without modifying its bindings', async () => {
    const view = setup()
    fireEvent.click(screen.getByRole('button', { name: '保存搜索来源' }))
    await screen.findByText('相同条件的来源已存在')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(view.onClose).toHaveBeenCalledOnce()
    expect(view.onSaved).not.toHaveBeenCalled()
    expect(mocks.append).not.toHaveBeenCalled()
  })
  it('retains the draft after a failed append and lets users recheck changed conditions', async () => {
    mocks.append.mockRejectedValue({ data: { code: 'PRECONDITION_FAILED' }, message: '来源规则已变化' })
    const view = setup()
    fireEvent.change(screen.getByLabelText('标题关键词'), { target: { value: 'Edited' } })
    fireEvent.click(screen.getByRole('button', { name: '保存搜索来源' }))
    await screen.findByText('相同条件的来源已存在')
    fireEvent.click(screen.getByRole('button', { name: '追加绑定' }))
    await screen.findByText('来源或艺术家状态已变化，请返回修改条件并重新保存确认。')
    expect(view.onSaved).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '返回修改条件' }))
    expect((screen.getByLabelText('标题关键词') as HTMLInputElement).value).toBe('Edited')
    expect(screen.getByLabelText('当前绑定艺术家').textContent).toBe(artist.name)
  })
  it('finishes without another confirmation when the source already includes the submitted artist', async () => {
    mocks.create.mockResolvedValue({ ...source, defaultCreators: [artist] })
    const view = setup()
    fireEvent.click(screen.getByRole('button', { name: '保存搜索来源' }))
    await waitFor(() => expect(view.onSaved).toHaveBeenCalledWith('existing'))
    expect(mocks.append).not.toHaveBeenCalled()
    expect(screen.queryByText('相同条件的来源已存在')).toBeNull()
  })
  it('reports refresh failure separately after a successful save', async () => {
    mocks.create.mockResolvedValue({ ...source, defaultCreators: [artist] })
    const view = setup()
    view.onSaved.mockRejectedValue(new Error('refresh failed'))
    fireEvent.click(screen.getByRole('button', { name: '保存搜索来源' }))
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('来源已保存，列表刷新失败，请刷新页面查看。'))
    expect(view.onClose).toHaveBeenCalledOnce()
    expect(mocks.create).toHaveBeenCalledOnce()
  })
})
