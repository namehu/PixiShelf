import type { PropsWithChildren } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMediaMark, usePrefetchMediaMarks } from '../use-media-mark'
import type { MediaMarkStateDto } from '@/schemas/media-mark.dto'

const mocks = vi.hoisted(() => ({ owner: 'alice', get: vi.fn(), set: vi.fn(), remove: vi.fn() }))
vi.mock('@/components/auth', () => ({
  useAuthUser: () => ({ id: mocks.owner }),
  useAuthStore: { getState: () => ({ user: { id: mocks.owner } }), subscribe: () => () => {} }
}))
vi.mock('@/lib/trpc', () => {
  const client = {
    mediaMark: { getMany: { query: mocks.get }, set: { mutate: mocks.set }, remove: { mutate: mocks.remove } }
  }
  return { useTRPCClient: () => client }
})
const state = (bookmarked = false): MediaMarkStateDto => ({
  markId: bookmarked ? 'mark-1' : null,
  artworkId: 7,
  mediaId: 42,
  bookmarkedAt: bookmarked ? '2026-10-22T12:00:00.000Z' : null,
  likedAt: null,
  available: true
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
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
})

describe('media mark hook', () => {
  it('shares optimistic state, saves after closing and includes the account guard', async () => {
    let resolve!: (value: MediaMarkStateDto) => void
    mocks.set.mockImplementationOnce(
      () =>
        new Promise<MediaMarkStateDto>((done) => {
          resolve = done
        })
    )
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
    expect(mocks.set).toHaveBeenCalledWith({
      artworkId: 7,
      mediaId: 42,
      kind: 'bookmark',
      value: true,
      expectedUserId: 'alice'
    })
  })

  it('batches the preview window and immediately reuses a prefetched neighbor', async () => {
    mocks.get.mockImplementation(async ({ mediaIds }: { mediaIds: number[] }) => ({
      items: mediaIds.map((mediaId) => ({ ...state(mediaId === 43), mediaId }))
    }))
    const provider = wrapper()
    const view = renderHook(
      ({ mediaId }) => {
        const mark = useMediaMark(7, mediaId)
        usePrefetchMediaMarks(7, [41, 42, 43, 44], true)
        return mark
      },
      { wrapper: provider, initialProps: { mediaId: 42 } }
    )
    await waitFor(() => expect(view.result.current.isLoading).toBe(false))
    expect(mocks.get).toHaveBeenCalledTimes(1)
    expect(new Set(mocks.get.mock.calls[0]![0].mediaIds)).toEqual(new Set([41, 42, 43, 44]))
    view.rerender({ mediaId: 43 })
    expect(view.result.current.bookmarkedAt).toBeTruthy()
    expect(view.result.current.isLoading).toBe(false)
    await act(async () => {})
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite a save with a late prefetched refresh', async () => {
    const provider = wrapper()
    const view = renderHook(() => useMediaMark(7, 42), { wrapper: provider })
    await waitFor(() => expect(view.result.current.available).toBe(true))
    await clients.at(-1)!.invalidateQueries()
    let resolve!: (value: { items: MediaMarkStateDto[] }) => void
    mocks.get.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    renderHook(() => usePrefetchMediaMarks(7, [42], true), { wrapper: provider })
    await waitFor(() => expect(resolve).toBeDefined())
    await act(async () => view.result.current.set('bookmark', true))
    await act(async () => resolve({ items: [state()] }))
    expect(view.result.current.bookmarkedAt).toBeTruthy()
    expect(view.result.current.isSaving).toBe(false)
  })

  it('keeps late reads on their original media and account', async () => {
    const pending = new Map<string, (value: { items: MediaMarkStateDto[] }) => void>()
    mocks.get.mockImplementation(
      ({ expectedUserId, mediaIds }) =>
        new Promise((resolve) => {
          pending.set(`${expectedUserId}-${mediaIds[0]}`, resolve)
        })
    )
    const view = renderHook(({ mediaId }) => useMediaMark(7, mediaId), {
      wrapper: wrapper(),
      initialProps: { mediaId: 42 }
    })
    await waitFor(() => expect(pending.has('alice-42')).toBe(true))
    view.rerender({ mediaId: 43 })
    await waitFor(() => expect(pending.has('alice-43')).toBe(true))
    await act(async () => pending.get('alice-42')!({ items: [state(true)] }))
    expect(view.result.current.bookmarkedAt).toBeNull()
    mocks.owner = 'bob'
    view.rerender({ mediaId: 43 })
    await waitFor(() => expect(pending.has('bob-43')).toBe(true))
    await act(async () => pending.get('alice-43')!({ items: [{ ...state(true), mediaId: 43 }] }))
    expect(view.result.current.bookmarkedAt).toBeNull()
    await act(async () => pending.get('bob-43')!({ items: [{ ...state(), mediaId: 43 }] }))
    expect(view.result.current.available).toBe(true)
  })

  it('never sends an artwork cover placeholder as a media ID', () => {
    const view = renderHook(() => useMediaMark(7, null), { wrapper: wrapper() })
    expect(view.result.current.available).toBe(false)
    expect(mocks.get).not.toHaveBeenCalled()
    act(() => view.result.current.set('bookmark', true))
    expect(mocks.set).not.toHaveBeenCalled()
  })
})
