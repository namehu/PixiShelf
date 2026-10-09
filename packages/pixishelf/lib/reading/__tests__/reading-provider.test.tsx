import React, { StrictMode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingContextDto, ReadingSummaryDto } from '@pixishelf/db/reading-contract'
import { ReadingProvider, useArtworkReading, useReadingSummaries } from '../reading-provider'

const mocks = vi.hoisted(() => ({
  user: { id: 'alice' }, context: vi.fn(), summaries: vi.fn(), report: vi.fn(), markRead: vi.fn(), toast: vi.fn()
}))

vi.mock('sonner', () => ({ toast: { custom: mocks.toast } }))

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

  it('shows a brief bottom toast only after a newly completed report', async () => {
    const completed: ReadingSummaryDto = { ...viewed, seenCount: 3, status: 'COMPLETED' }
    mocks.report.mockResolvedValue({ mediaRevision: 1, seenMediaIds: [], summary: completed })
    const { result } = setup()
    await waitFor(() => expect(result.current.reading.context).toBeDefined())
    expect(mocks.toast).not.toHaveBeenCalled()
    await recordView(result.current.reading)
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      id: 'reading-completed-alice-7', position: 'bottom-center', duration: 2000
    })
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
