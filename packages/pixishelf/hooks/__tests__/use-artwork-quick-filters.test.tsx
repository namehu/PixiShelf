import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PropsWithChildren } from 'react'
import { useArtworkQuickFilters } from '../use-artwork-quick-filters'
import { artworkQuerySnapshotSchema } from '@/schemas/artwork-quick-filter.dto'
const state = vi.hoisted(() => ({ userId: 'a', create: vi.fn(), list: vi.fn() }))
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
  state.list.mockImplementation(async ({ expectedUserId }) => ({
    items: [{ id: expectedUserId }],
    navigation: { revision: 0, ids: [] }
  }))
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={cache}>{children}</QueryClientProvider>
  )
  return renderHook(() => useArtworkQuickFilters(true), { wrapper })
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
