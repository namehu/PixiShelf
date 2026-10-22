import type { PropsWithChildren } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useArtworkRating } from '../use-artwork-rating'
import { useViewerStore } from '@/store/viewer-store'
import type { ArtworkRatingLevel, ArtworkRatingState } from '@/schemas/artwork-rating.dto'

const mocks = vi.hoisted(() => ({ owner: 'alice', get: vi.fn(), set: vi.fn() }))
vi.mock('@/components/auth', () => ({
  useAuthUser: () => ({ id: mocks.owner }),
  useAuthStore: { getState: () => ({ user: { id: mocks.owner } }) }
}))
vi.mock('@/lib/trpc', () => {
  const client = { artworkRating: { get: { query: mocks.get }, set: { mutate: mocks.set } } }
  return { useTRPCClient: () => client }
})
const state = (level: ArtworkRatingLevel): ArtworkRatingState => ({
  artworkId: 7, level, isLike: level !== null && level >= 2, updatedAt: level === null ? null : '2026-10-22T12:00:00.000Z'
})
const clients: QueryClient[] = []
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  return ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
beforeEach(() => {
  mocks.owner = 'alice'
  mocks.get.mockReset().mockResolvedValue(state(null))
  mocks.set.mockReset().mockImplementation(async ({ level }: { level: ArtworkRatingLevel }) => state(level))
  useViewerStore.setState(useViewerStore.getInitialState())
})
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()) })

describe('rating hook across detail and viewer', () => {
  it('shares live values and pending state between entrances and keeps saved grades on remount', async () => {
    let resolve!: (value: ArtworkRatingState) => void
    mocks.set.mockImplementationOnce(() => new Promise<ArtworkRatingState>((done) => { resolve = done }))
    const provider = wrapper()
    const view = renderHook(() => ({ detail: useArtworkRating(7), viewer: useArtworkRating(7, null) }), { wrapper: provider })
    await waitFor(() => expect(view.result.current.detail.isLoading).toBe(false))
    act(() => view.result.current.detail.setLevel(4))
    expect(view.result.current.viewer).toMatchObject({ level: 4, isSaving: true })
    await act(async () => resolve(state(4)))
    await waitFor(() => expect(view.result.current.viewer).toMatchObject({ confirmedLevel: 4, isSaving: false }))
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith({ artworkId: 7, expectedUserId: 'alice', level: 4 })
    view.unmount()
    mocks.get.mockResolvedValue(state(4))
    const returning = renderHook(() => useArtworkRating(7, 2), { wrapper: provider })
    expect(returning.result.current.level).toBe(4)
    await waitFor(() => expect(useViewerStore.getState().artworkRatingMap.get(7)).toBe(4))
  })

  it('does not apply a previous account response to the active viewer', async () => {
    let resolve!: (value: ArtworkRatingState) => void
    mocks.set.mockImplementationOnce(() => new Promise<ArtworkRatingState>((done) => { resolve = done }))
    const view = renderHook(() => useArtworkRating(7), { wrapper: wrapper() })
    await waitFor(() => expect(view.result.current.isLoading).toBe(false))
    act(() => view.result.current.setLevel(4))
    mocks.owner = 'bob'
    mocks.get.mockResolvedValue(state(1))
    view.rerender()
    await waitFor(() => expect(view.result.current.level).toBe(1))
    await act(async () => resolve(state(4)))
    expect(view.result.current).toMatchObject({ level: 1, confirmedLevel: 1 })
    expect(useViewerStore.getState().artworkRatingMap.get(7)).toBe(1)
  })
})
