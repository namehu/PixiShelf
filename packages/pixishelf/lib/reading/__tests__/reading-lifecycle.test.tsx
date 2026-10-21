import React from 'react'
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingContextDto, ReadingReportInput, ReadingReportResult } from '@pixishelf/db/reading-contract'
import type { ReaderInitialPage, ReaderInitialization } from '@/schemas/artwork-reader.dto'
import { ReadingProvider, useArtworkReading } from '../reading-provider'
import { ArtworkReaderProvider, useArtworkReader } from '../artwork-reader-provider'
import { ReadingCollector } from '../reading-collector'

const mocks = vi.hoisted(() => ({ reader: vi.fn(), report: vi.fn(), toast: vi.fn(), errorToast: vi.fn(), dismiss: vi.fn(), user: { id: 'alice' } }))
vi.mock('sonner', () => ({ toast: { custom: mocks.toast, error: mocks.errorToast, dismiss: mocks.dismiss } }))
vi.mock('@/components/auth/auth-provider', () => ({
  useAuthUser: () => mocks.user, useAuthStore: { getState: () => ({ user: mocks.user }) }
}))
vi.mock('@/lib/trpc', () => {
  const client = { reading: { report: { mutate: mocks.report } }, artwork: { reader: { query: mocks.reader }, mediaPage: { query: vi.fn() } } }
  const queryOptions = (path: string[], queryFn: () => unknown) => (input: unknown, options: object) => ({
    queryKey: [path, { input, type: 'query' }], queryFn, ...options
  })
  const trpc = { reading: { context: { queryOptions: queryOptions(['reading', 'context'], vi.fn()) } },
    artwork: { reader: { queryOptions: queryOptions(['artwork', 'reader'], mocks.reader) } } }
  return { useTRPCClient: () => client, useTRPC: () => trpc }
})
const context: ReadingContextDto = {
  artworkId: 7, mediaRevision: 1, seenMediaIds: [], resume: null,
  media: [{ mediaId: 11, memberMediaIds: [11], index: 0 }, { mediaId: 12, memberMediaIds: [12], index: 1 }],
  summary: { artworkId: 7, mediaRevision: 1, stateVersion: 0, viewCount: 0, seenCount: 0, totalCount: 2,
    status: 'UNREAD', lastViewedAt: null, lastActiveAt: null, lastMediaId: null, lastMediaIndex: null }
}
const response = { mediaRevision: 1, seenMediaIds: [11], summary: { ...context.summary, stateVersion: 1, seenCount: 1, status: 'IN_PROGRESS' as const } }
const init = (fingerprint: string): ReaderInitialization => ({ title: 'A', reading: context,
  index: { fingerprint, mediaRevision: 1, items: context.media.map(item => ({ ...item, width: 100, height: 150,
    mediaType: 'image', isAnimated: false, reliableDimensions: true })) } })
beforeEach(() => { vi.resetAllMocks(); mocks.user = { id: 'alice' } })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('reader navigation and pending saves', () => {
  it('allows a fresh initialization to replace cached media after reopening', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const old = init('a'.repeat(64))
    const fresh = init('b'.repeat(64))
    client.setQueryData([['artwork', 'reader'], { input: { artworkId: 7, expectedUserId: 'alice' }, type: 'query' }, { fingerprint: old.index.fingerprint }], old)
    let resolve!: (value: ReaderInitialization) => void
    mocks.reader.mockImplementation(() => new Promise(done => { resolve = done }))
    const initial = { fingerprint: fresh.index.fingerprint, total: 2, artwork: { images: [], title: 'A' } } as unknown as ReaderInitialPage
    const hook = renderHook(() => useArtworkReader(), { wrapper: ({ children }) =>
      <QueryClientProvider client={client}><ReadingProvider><ArtworkReaderProvider artworkId={7} initial={initial}>
        {children}</ArtworkReaderProvider></ReadingProvider></QueryClientProvider> })
    await waitFor(() => expect(mocks.reader).toHaveBeenCalled())
    expect(hook.result.current?.initialization).toBeUndefined()
    expect(hook.result.current?.invalidated).toBe(false)
    await act(async () => { resolve(fresh) })
    await waitFor(() => expect(hook.result.current?.initialization?.index.fingerprint).toBe(fresh.index.fingerprint))
    expect(hook.result.current?.invalidated).toBe(false)
    hook.unmount(); client.clear()
  })

  it('retains a three-second batch window for events observed during a request', async () => {
    vi.useFakeTimers()
    let resolve!: (value: typeof response) => void
    const report = vi.fn().mockImplementationOnce(() => new Promise(done => { resolve = done })).mockResolvedValue(response)
    const collector = new ReadingCollector({ report })
    collector.setAccount('alice'); collector.setContext(context, 'alice')
    collector.observe('first', { artworkId: 7, mediaId: 11, ready: true, visible: true, automatic: false })
    await vi.advanceTimersByTimeAsync(3000)
    collector.observe('second', { artworkId: 7, mediaId: 12, ready: true, visible: true, automatic: false })
    await vi.advanceTimersByTimeAsync(100)
    resolve(response)
    await vi.advanceTimersByTimeAsync(0)
    expect(report).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2899)
    expect(report).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(report).toHaveBeenCalledTimes(2)
    expect(report.mock.calls[1]?.[0].events).toMatchObject([{ mediaId: 12 }])
    collector.dispose()
  })

  it('keeps A and B queues separate and finishes A after leaving its detail', async () => {
    const pending = new Map<number, (value: ReadingReportResult) => void>()
    const report = vi.fn((input: ReadingReportInput) => new Promise<ReadingReportResult>(done => pending.set(input.artworkId, done)))
    const onSummary = vi.fn()
    const collector = new ReadingCollector({ report, onSummary })
    collector.setAccount('alice'); collector.setContext(context, 'alice')
    const other = { ...context, artworkId: 8, summary: { ...context.summary, artworkId: 8 } }
    collector.setContext(other, 'alice')
    collector.observe('reader-a', { artworkId: 7, mediaId: 11, ready: true, visible: true, automatic: false })
    collector.clearArtwork(7)
    collector.observe('reader-b', { artworkId: 8, mediaId: 12, ready: true, visible: true, automatic: false })
    const flush = collector.flush()
    pending.get(8)!({ ...response, summary: { ...response.summary, artworkId: 8 }, seenMediaIds: [12] })
    await flush
    pending.get(7)!(response)
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(report.mock.calls.map(([input]) => [input.artworkId, input.expectedUserId, input.events[0]?.mediaId])).toEqual([[7, 'alice', 11], [8, 'alice', 12]])
    expect(onSummary.mock.calls.map(([summary]) => summary.artworkId)).toEqual([8, 7])
    collector.dispose()
  })
  it('notifies after an exit flush is permanently rejected while the detail is absent', async () => {
    let reject!: (reason: unknown) => void
    mocks.report.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let handle!: ReturnType<typeof useArtworkReading>
    function Reader() {
      handle = useArtworkReading(7, { external: true, context, isLoading: false, error: null, retry: vi.fn() })
      return <span>detail</span>
    }
    function Root({ detail }: { detail: boolean }) {
      return <QueryClientProvider client={client}><ReadingProvider>{detail ? <Reader /> : <span>list</span>}</ReadingProvider></QueryClientProvider>
    }
    const ui = render(<Root detail />)
    act(() => handle.observe('detail', { mediaId: 11, ready: true, visible: true, automatic: false }))
    expect(handle.summary?.seenCount).toBe(1)
    ui.rerender(<Root detail={false} />)
    expect(mocks.report).toHaveBeenCalledTimes(1)
    await act(async () => { reject({ data: { code: 'BAD_REQUEST' } }); for (let i = 0; i < 5; i++) await Promise.resolve() })
    expect(ui.container.textContent).toBe('list')
    expect(mocks.errorToast).toHaveBeenCalledWith(expect.stringContaining('#7'), expect.objectContaining({ id: 'reading-unsaved-alice-7' }))
    ui.unmount(); client.clear()
  })

  it('still blocks a genuine index change returned after the SSR snapshot', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const fresh = init('b'.repeat(64))
    mocks.reader.mockResolvedValue(fresh)
    const initial = { fingerprint: 'a'.repeat(64), total: 2, artwork: { images: [], title: 'A' } } as unknown as ReaderInitialPage
    const hook = renderHook(() => useArtworkReader(), { wrapper: ({ children }) =>
      <QueryClientProvider client={client}><ReadingProvider><ArtworkReaderProvider artworkId={7} initial={initial}>
        {children}</ArtworkReaderProvider></ReadingProvider></QueryClientProvider> })
    await waitFor(() => expect(hook.result.current?.invalidated).toBe(true))
    expect(hook.result.current?.reading.context).toBeUndefined()
    expect(mocks.report).not.toHaveBeenCalled()
    hook.unmount(); client.clear()
  })

  it('flushes on pagehide without duplicating an in-flight request', async () => {
    let finish!: (value: ReadingReportResult) => void
    mocks.report.mockImplementationOnce(() => new Promise<ReadingReportResult>(resolve => { finish = resolve }))
      .mockResolvedValue({ ...response, seenMediaIds: [11, 12] })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const hook = renderHook(() => useArtworkReading(7, { external: true, context, isLoading: false, error: null, retry: vi.fn() }), {
      wrapper: ({ children }) => <QueryClientProvider client={client}><ReadingProvider>{children}</ReadingProvider></QueryClientProvider>
    })
    act(() => {
      hook.result.current.observe('first', { mediaId: 11, ready: true, visible: true, automatic: false })
      window.dispatchEvent(new Event('pagehide'))
      hook.result.current.observe('second', { mediaId: 12, ready: true, visible: true, automatic: false })
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(mocks.report).toHaveBeenCalledTimes(1)
    await act(async () => { finish(response) })
    expect(mocks.report.mock.calls.map(([input]) => input.events.map((event: { mediaId: number }) => event.mediaId))).toEqual([[11], [12]])
    hook.unmount(); client.clear()
  })

  it('dismisses unsaved notifications when the account changes', async () => {
    mocks.report.mockRejectedValue({ data: { code: 'BAD_REQUEST' } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const hook = renderHook(() => useArtworkReading(7, { external: true, context, isLoading: false, error: null, retry: vi.fn() }), {
      wrapper: ({ children }) => <QueryClientProvider client={client}><ReadingProvider>{children}</ReadingProvider></QueryClientProvider>
    })
    await act(async () => {
      hook.result.current.observe('first', { mediaId: 11, ready: true, visible: true, automatic: false })
      await hook.result.current.flush()
    })
    expect(mocks.errorToast).toHaveBeenCalledTimes(1)
    mocks.user = { id: 'bob' }
    hook.rerender()
    expect(mocks.dismiss).toHaveBeenCalledWith('reading-unsaved-alice-7')
    expect(hook.result.current.error).toBeNull()
    hook.unmount(); client.clear()
  })

})
