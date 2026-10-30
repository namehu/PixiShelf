import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PropsWithChildren } from 'react'
import { useArtworkQuickFilters } from '../use-artwork-quick-filters'
import { artworkQuerySnapshotSchema, type QuickFilterScope } from '@/schemas/artwork-quick-filter.dto'
const state = vi.hoisted(() => ({
  userId: 'a',
  scope: { kind: 'global' } as QuickFilterScope,
  create: vi.fn(),
  list: vi.fn()
}))
vi.mock('@/components/auth', () => ({ useAuthUser: () => ({ id: state.userId }) }))
vi.mock('@/lib/trpc', () => ({
  useTRPCClient: () => ({ artworkQuickFilter: { list: { query: state.list }, create: { mutate: state.create } } })
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
function setup() {
  state.userId = 'a'
  state.scope = { kind: 'global' }
  state.list.mockImplementation(async ({ expectedUserId }) => ({
    items: [{ id: expectedUserId }],
    navigation: { revision: 0, ids: [] }
  }))
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={cache}>{children}</QueryClientProvider>
  )
  return renderHook(() => useArtworkQuickFilters(true, state.scope), { wrapper })
}
describe('quick filter asynchronous ownership', () => {
  it('does not display another account cache or acknowledge its late mutation', async () => {
    const view = setup()
    await waitFor(() => expect(view.result.current.items[0]?.id).toBe('a'))
    let resolve!: () => void
    state.create.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done
      })
    )
    let pending!: Promise<boolean>
    act(() => {
      pending = view.result.current.create({ name: 'test', query: artworkQuerySnapshotSchema.parse({}), pin: false })
    })
    state.userId = 'b'
    view.rerender()
    expect(view.result.current.items.some((i) => i.id === 'a')).toBe(false)
    await waitFor(() => expect(view.result.current.items[0]?.id).toBe('b'))
    let result: boolean | undefined
    await act(async () => {
      resolve()
      result = await pending
    })
    expect(result).toBe(false)
    expect(view.result.current.items[0]?.id).toBe('b')
    expect(view.result.current.busy).toBe(false)
  })
  it('isolates artist A/B/global caches and ignores late writes after a scope switch', async () => {
    const view = setup()
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    state.list.mockImplementation(async ({ scope }) => ({
      items: [{ id: scope.kind === 'artist' ? String(scope.artistId) : 'global' }],
      navigation: { revision: 0, ids: [] }
    }))
    state.scope = { kind: 'artist', artistId: 12 }
    view.rerender()
    await waitFor(() => expect(view.result.current.items[0]?.id).toBe('12'))
    let resolve!: () => void
    state.create.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done
      })
    )
    let pending!: Promise<boolean>
    act(() => {
      pending = view.result.current.create({ name: 'A', query: artworkQuerySnapshotSchema.parse({}), pin: false })
    })
    state.scope = { kind: 'artist', artistId: 13 }
    view.rerender()
    expect(view.result.current.items).toEqual([])
    await waitFor(() => expect(view.result.current.items[0]?.id).toBe('13'))
    await act(async () => {
      resolve()
      expect(await pending).toBe(false)
    })
    expect(view.result.current.items[0]?.id).toBe('13')
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ scope: { kind: 'artist', artistId: 12 } }))
    state.scope = { kind: 'global' }
    view.rerender()
    await waitFor(() => expect(view.result.current.items[0]?.id).toBe('global'))
  })
  it('does not acknowledge a completed write after the editor unmounts', async () => {
    const view = setup()
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    let resolve!: () => void
    state.create.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done
      })
    )
    let pending!: Promise<boolean>
    act(() => {
      pending = view.result.current.create({ name: 'test', query: artworkQuerySnapshotSchema.parse({}), pin: true })
    })
    view.unmount()
    resolve()
    await expect(pending).resolves.toBe(false)
  })
})
