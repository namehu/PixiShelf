import type { PropsWithChildren } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMediaMark } from '../use-media-mark'
import type { MediaMarkStateDto } from '@/schemas/media-mark.dto'

const mocks = vi.hoisted(() => ({ owner: 'alice', get: vi.fn(), set: vi.fn(), remove: vi.fn() }))
vi.mock('@/components/auth', () => ({
  useAuthUser: () => ({ id: mocks.owner }),
  useAuthStore: { getState: () => ({ user: { id: mocks.owner } }), subscribe: () => () => {} }
}))
vi.mock('@/lib/trpc', () => {
  const client = { mediaMark: { getMany: { query: mocks.get }, set: { mutate: mocks.set }, remove: { mutate: mocks.remove } } }
  return { useTRPCClient: () => client }
})
const state = (bookmarked = false): MediaMarkStateDto => ({
  markId: bookmarked ? 'mark-1' : null, artworkId: 7, mediaId: 42, bookmarkedAt: bookmarked ? '2026-10-22T12:00:00.000Z' : null,
  likedAt: null, available: true
})
const clients: QueryClient[] = []
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  return ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
beforeEach(() => {
  mocks.owner = 'alice'
  mocks.get.mockReset().mockResolvedValue({ items: [state()] })
  mocks.set.mockReset().mockResolvedValue(state(true))
})
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()) })

describe('media mark hook', () => {
  it('shares optimistic state, saves after closing and includes the account guard', async () => {
    let resolve!: (value: MediaMarkStateDto) => void
    mocks.set.mockImplementationOnce(() => new Promise<MediaMarkStateDto>((done) => { resolve = done }))
    const provider = wrapper()
    const view = renderHook(() => ({ menu: useMediaMark(7, 42), preview: useMediaMark(7, 42) }), { wrapper: provider })
    await waitFor(() => expect(view.result.current.menu.isLoading).toBe(false))
    act(() => view.result.current.menu.set('bookmark', true))
    expect(view.result.current.preview.bookmarkedAt).toBeTruthy()
    expect(view.result.current.preview.isSaving).toBe(true)
    view.unmount()
    await act(async () => resolve(state(true)))
    const reopened = renderHook(() => useMediaMark(7, 42), { wrapper: provider })
    expect(reopened.result.current.bookmarkedAt).toBeTruthy()
    expect(mocks.set).toHaveBeenCalledWith({ artworkId: 7, mediaId: 42, kind: 'bookmark', value: true, expectedUserId: 'alice' })
  })

  it('never sends an artwork cover placeholder as a media ID', () => {
    const view = renderHook(() => useMediaMark(7, null), { wrapper: wrapper() })
    expect(view.result.current.available).toBe(false)
    expect(mocks.get).not.toHaveBeenCalled()
    act(() => view.result.current.set('bookmark', true))
    expect(mocks.set).not.toHaveBeenCalled()
  })
})
