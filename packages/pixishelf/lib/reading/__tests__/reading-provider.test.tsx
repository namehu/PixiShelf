import React, { StrictMode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingContextDto, ReadingSummaryDto } from '@pixishelf/db/reading-contract'
import { ReadingProvider, useArtworkReading, useReadingSummaries } from '../reading-provider'

const mocks = vi.hoisted(() => ({
  user: { id: 'alice' }, context: vi.fn(), summaries: vi.fn(), report: vi.fn(), markRead: vi.fn(), toast: vi.fn(), errorToast: vi.fn(), dismiss: vi.fn()
}))

vi.mock('sonner', () => ({ toast: { custom: mocks.toast, error: mocks.errorToast, dismiss: mocks.dismiss } }))

vi.mock('@/components/auth/auth-provider', () => ({
  useAuthUser: () => mocks.user,
  useAuthStore: { getState: () => ({ user: mocks.user }) }
}))
vi.mock('@/lib/trpc', () => {
  const client = { reading: { markRead: { mutate: mocks.markRead }, report: { mutate: mocks.report }, summaries: { query: mocks.summaries } } }
  const trpc = { reading: { context: { queryOptions: (input: unknown, options: object) => ({
    queryKey: [['reading', 'context'], { input, type: 'query' }],
    queryFn: () => mocks.context(input), ...options
  }) } } }
  return { useTRPCClient: () => client, useTRPC: () => trpc }
})

const unread: ReadingSummaryDto = {
  artworkId: 7, mediaRevision: 1, stateVersion: 0, viewCount: 0, seenCount: 0, totalCount: 3, status: 'UNREAD',
  lastViewedAt: null, lastActiveAt: null, lastMediaId: null, lastMediaIndex: null
}
const viewed: ReadingSummaryDto = {
  ...unread, stateVersion: 1, viewCount: 1, seenCount: 1, status: 'IN_PROGRESS', lastMediaId: 11, lastMediaIndex: 0,
  lastViewedAt: '2026-09-28T00:00:00.000Z', lastActiveAt: '2026-09-28T00:00:00.000Z'
}
const context: ReadingContextDto = {
  artworkId: 7, mediaRevision: 1, seenMediaIds: [], summary: unread, resume: null,
  media: [{ mediaId: 11, memberMediaIds: [11], index: 0 }]
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = { id: 'alice' }
  mocks.context.mockResolvedValue(context)
  mocks.summaries.mockResolvedValue({ summaries: [] })
  mocks.report.mockResolvedValue({ mediaRevision: 1, seenMediaIds: [], summary: viewed })
})
afterEach(cleanup)

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  const hook = renderHook(() => ({ reading: useArtworkReading(7), summaries: useReadingSummaries([7]) }), {
    wrapper: ({ children }) => (
      <StrictMode><QueryClientProvider client={client}>
        <ReadingProvider>{children}</ReadingProvider>
      </QueryClientProvider></StrictMode>
    )
  })
  return { ...hook, client }
}

async function recordView(handle: ReturnType<typeof useArtworkReading>) {
  await act(async () => {
    handle.observe('detail', { mediaId: 11, ready: true, visible: true, automatic: true })
    await handle.flush()
  })
}

describe('ReadingProvider lifecycle and server refresh', () => {
  it('reuses initialization without another context request and projects pending progress without restarting observations', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const hook = renderHook(() => useArtworkReading(7, {
      external: true, context, isLoading: false, error: null, retry: vi.fn()
    }), { wrapper: ({ children }) => <QueryClientProvider client={client}><ReadingProvider>{children}</ReadingProvider></QueryClientProvider> })
    const epoch = hook.result.current.observationEpoch
    act(() => hook.result.current.observe('detail', { mediaId: 11, ready: true, visible: true, automatic: false }))
    expect(hook.result.current.summary?.seenCount).toBe(1)
    expect(hook.result.current.summary?.stateVersion).toBe(0)
    expect(hook.result.current.observationEpoch).toBe(epoch)
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.report).not.toHaveBeenCalled()
    await act(async () => { await hook.result.current.flush() })
    expect(hook.result.current.summary?.stateVersion).toBe(1)
    hook.unmount()
    client.clear()
  })

  it('optimistically marks media and restores the confirmed state after rejection', async () => {
    let reject!: (error: Error) => void
    mocks.markRead.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    const { result, unmount } = setup()
    await waitFor(() => expect(result.current.reading.context).toBeDefined())
    let saving!: Promise<void>
    act(() => { saving = result.current.reading.markRead({ kind: 'MEDIA', mediaId: 11 }) })
    expect(result.current.reading.summary?.seenCount).toBe(1)
    expect(result.current.reading.summary?.stateVersion).toBe(0)
    await act(async () => { reject(new Error('offline')); await saving })
    expect(result.current.reading.summary?.seenCount).toBe(0)
    expect(result.current.reading.markError).toBeTruthy()
    unmount()
  })

  it('projects a manual threshold crossing, rolls it back on failure, and can still mark all remaining media', async () => {
    const media = Array.from({ length: 100 }, (_, index) => ({ mediaId: index + 1, memberMediaIds: [index + 1], index }))
    const initial: ReadingContextDto = { ...context, media, seenMediaIds: media.slice(0, 97).map(item => item.mediaId),
      summary: { ...unread, totalCount: 100, seenCount: 97, status: 'IN_PROGRESS' } }
    mocks.context.mockResolvedValue(initial)
    let reject!: (error: Error) => void
    mocks.markRead.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    const { result, unmount } = setup()
    await waitFor(() => expect(result.current.reading.context).toBeDefined())
    let saving!: Promise<void>
    act(() => { saving = result.current.reading.markRead({ kind: 'MEDIA', mediaId: 98 }) })
    expect(result.current.reading.summary).toMatchObject({ seenCount: 98, status: 'COMPLETED', viewCount: 0, stateVersion: 0 })
    expect(result.current.reading.context?.seenMediaIds).not.toContain(99)
    await act(async () => { reject(new Error('offline')); await saving })
    expect(result.current.reading.summary).toEqual(initial.summary)

    const completed = { ...initial.summary, stateVersion: 1, seenCount: 98, status: 'COMPLETED' as const }
    mocks.markRead.mockResolvedValueOnce({ mediaRevision: 1, summary: completed, seenMediaIds: media.slice(0, 98).map(item => item.mediaId) })
    await act(async () => { await result.current.reading.markRead({ kind: 'MEDIA', mediaId: 98 }) })
    expect(result.current.reading.summary).toEqual(completed)
    let resolve!: (value: unknown) => void
    mocks.markRead.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    act(() => { saving = result.current.reading.markRead({ kind: 'ALL' }) })
    expect(result.current.reading.context?.seenMediaIds).toHaveLength(100)
    expect(result.current.reading.summary).toMatchObject({ seenCount: 100, status: 'COMPLETED', viewCount: 0, stateVersion: 1 })
    await act(async () => {
      resolve({ mediaRevision: 1, summary: { ...completed, seenCount: 100, stateVersion: 2 }, seenMediaIds: media.map(item => item.mediaId) })
      await saving
    })
    expect(result.current.reading.summary).toMatchObject({ seenCount: 100, status: 'COMPLETED', viewCount: 0, stateVersion: 2 })
    expect(mocks.toast).not.toHaveBeenCalled()
    unmount()
  })

  it('does not record media when the page initially mounts in the background', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    try {
      const { result } = setup()
      await waitFor(() => expect(result.current.reading.context).toBeDefined())
      await recordView(result.current.reading)
      expect(mocks.report).not.toHaveBeenCalled()
      expect(mocks.toast).not.toHaveBeenCalled()
    } finally {
      hidden.mockRestore()
    }
  })

  it('shows a brief bottom toast immediately on local completion and never again on acknowledgement', async () => {
    const completed: ReadingSummaryDto = { ...viewed, seenCount: 3, status: 'COMPLETED' }
    mocks.context.mockResolvedValue({ ...context, summary: { ...viewed, seenCount: 2 }, seenMediaIds: [12, 13],
      media: [11, 12, 13].map((mediaId, index) => ({ mediaId, memberMediaIds: [mediaId], index })) })
    mocks.report.mockResolvedValue({ mediaRevision: 1, seenMediaIds: [11, 12, 13], summary: completed })
    const { result } = setup()
    await waitFor(() => expect(result.current.reading.context).toBeDefined())
    expect(mocks.toast).not.toHaveBeenCalled()
    act(() => result.current.reading.observe('detail', { mediaId: 11, ready: true, visible: true, automatic: true }))
    expect(mocks.report).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      id: 'reading-completed-alice-7-1', position: 'bottom-center', duration: 2000
    })
    await act(async () => { await result.current.reading.flush() })
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    act(() => result.current.reading.clearSurface('detail'))
    await recordView(result.current.reading)
    expect(mocks.toast).toHaveBeenCalledTimes(1)
  })

  it('records after StrictMode effect replay and patches the first view into an empty batch', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.reading.context).toBeDefined())
    await waitFor(() => expect(result.current.summaries.isSuccess).toBe(true))
    await recordView(result.current.reading)
    expect(mocks.report).toHaveBeenCalledOnce()
    await waitFor(() => expect(result.current.summaries.byArtworkId.get(7)).toEqual(viewed))
    expect(result.current.reading.summary).toEqual(viewed)
  })

  it('allows later server data and rebuild clearing to replace a local report', async () => {
    const { result, client } = setup()
    await waitFor(() => expect(result.current.reading.context).toBeDefined())
    await recordView(result.current.reading)
    const completed: ReadingSummaryDto = { ...viewed, stateVersion: 2, viewCount: 2, seenCount: 3, status: 'COMPLETED' }
    mocks.summaries.mockResolvedValue({ summaries: [completed] })
    mocks.context.mockResolvedValue({ ...context, summary: completed })
    await act(async () => { await client.refetchQueries() })
    await waitFor(() => expect(result.current.summaries.byArtworkId.get(7)).toEqual(completed))
    expect(result.current.reading.summary).toEqual(completed)

    mocks.summaries.mockResolvedValue({ summaries: [] })
    mocks.context.mockResolvedValue({ ...context, mediaRevision: 2, summary: { ...unread, mediaRevision: 2 } })
    await act(async () => { await client.refetchQueries() })
    await waitFor(() => expect(result.current.summaries.byArtworkId.get(7)).toMatchObject({ mediaRevision: 2, seenCount: 0 }))
    expect(result.current.reading.invalidated).toBe(true)
    expect(result.current.reading.summary).toBeNull()
  })

  it('keeps conflicting media blocked until the user navigates to a fresh page', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    try {
      mocks.report.mockRejectedValue(new Error('READING_MEDIA_REVISION_CONFLICT'))
      const { result } = setup()
      await waitFor(() => expect(result.current.reading.context).toBeDefined())
      await recordView(result.current.reading)
      await waitFor(() => expect(result.current.reading.invalidated).toBe(true))
      const contextCalls = mocks.context.mock.calls.length
      act(() => result.current.reading.reopen())
      expect(reload).toHaveBeenCalledOnce()
      expect(mocks.context).toHaveBeenCalledTimes(contextCalls)
      await recordView(result.current.reading)
      expect(mocks.report).toHaveBeenCalledOnce()
      expect(result.current.reading.invalidated).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('keeps failed marking unchanged and supports retry without optimistic completion', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.reading.context).toBeDefined())
    mocks.markRead.mockRejectedValueOnce(new Error('offline'))
    await act(async () => { await result.current.reading.markRead({ kind: 'ALL' }) })
    expect(result.current.reading.summary).toEqual(unread)
    expect(result.current.reading.markError).toBe('标记未保存，请重试。')
    const completed = { ...unread, stateVersion: 1, seenCount: 3, status: 'COMPLETED' as const }
    mocks.markRead.mockResolvedValue({ summary: completed, mediaRevision: 1, seenMediaIds: [11, 12, 13] })
    await act(async () => { await result.current.reading.markRead({ kind: 'ALL' }) })
    expect(result.current.reading.summary).toEqual(completed)
    expect(result.current.reading.context?.seenMediaIds).toEqual([11, 12, 13])
    expect(result.current.reading.markError).toBeNull()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('ignores marking responses after an account switch and blocks duplicate submissions', async () => {
    let resolve!: (value: unknown) => void
    mocks.markRead.mockImplementation(() => new Promise((done) => { resolve = done }))
    const { result, rerender } = setup()
    await waitFor(() => expect(result.current.reading.context).toBeDefined())
    let pending!: Promise<void>
    act(() => { pending = result.current.reading.markRead({ kind: 'ALL' }) })
    await act(async () => { await result.current.reading.markRead({ kind: 'ALL' }) })
    expect(mocks.markRead).toHaveBeenCalledTimes(1)
    mocks.user = { id: 'bob' }
    rerender()
    await waitFor(() => expect(result.current.reading.context).toBeDefined())
    await act(async () => {
      resolve({ mediaRevision: 1, summary: { ...unread, stateVersion: 1, seenCount: 3, status: 'COMPLETED' }, seenMediaIds: [11, 12, 13] })
      await pending
    })
    expect(result.current.reading.summary).toEqual(unread)
  })

})
