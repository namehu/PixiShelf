import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingContextDto, ReadingReportInput, ReadingReportResult } from '@pixishelf/db/reading-contract'
import { ReadingCollector } from '../reading-collector'

const context: ReadingContextDto = {
  artworkId: 1, mediaRevision: 1, media: Array.from({ length: 205 }, (_, index) => ({ mediaId: index + 1, memberMediaIds: [index + 1], index })),
  seenMediaIds: [], resume: null,
  summary: { artworkId: 1, mediaRevision: 1, stateVersion: 0, totalCount: 205, seenCount: 0, viewCount: 0,
    status: 'UNREAD', lastActiveAt: null, lastViewedAt: null, lastMediaId: null, lastMediaIndex: null }
}
const response: ReadingReportResult = { mediaRevision: 1, summary: context.summary, seenMediaIds: [] }
const observe = (collector: ReadingCollector, mediaId: number) => collector.observe(`media-${mediaId}`, {
  artworkId: 1, mediaId, ready: true, visible: true, automatic: false
})
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
function setup(report: (input: ReadingReportInput, signal: AbortSignal) => Promise<ReadingReportResult> = vi.fn(async () => response)) {
  const collector = new ReadingCollector({ report })
  collector.setAccount('alice')
  collector.setContext(context, 'alice')
  return { collector, report }
}
describe('optimistic reading and durable acknowledgements', () => {
  it('projects immediately without forging versions, then sends at three seconds without debounce starvation', async () => {
    const { collector, report } = setup()
    observe(collector, 1)
    expect(collector.projectContext(context).summary).toMatchObject({ seenCount: 1, stateVersion: 0 })
    await vi.advanceTimersByTimeAsync(2000)
    observe(collector, 2)
    await vi.advanceTimersByTimeAsync(999)
    expect(report).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(report).toHaveBeenCalledTimes(1)
    collector.dispose()
  })
  it('splits more than 100 observations and flushes immediately when the detail unmounts', async () => {
    const report = vi.fn(async () => response)
    const { collector } = setup(report)
    for (let id = 1; id <= 205; id++) observe(collector, id)
    collector.clearArtwork(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(report.mock.calls.map((call) => (call as unknown as [{ events: unknown[] }])[0].events.length)).toEqual([100, 100, 5])
    collector.dispose()
  })
  it('preserves observations made during a request and drains them after its acknowledgement', async () => {
    let finish!: (value: ReadingReportResult) => void
    const report = vi.fn().mockImplementationOnce(() => new Promise<ReadingReportResult>((resolve) => { finish = resolve }))
      .mockResolvedValue(response)
    const { collector } = setup(report)
    observe(collector, 1)
    const flushing = collector.flush()
    observe(collector, 2)
    expect(collector.projectContext(context).seenMediaIds).toEqual([1, 2])
    collector.clearArtwork(1)
    finish({ ...response, seenMediaIds: [1], summary: { ...context.summary, seenCount: 1, stateVersion: 1 } })
    await flushing
    expect(report.mock.calls.map(([input]) => input.events.map((event: { mediaId: number }) => event.mediaId))).toEqual([[1], [2]])
    collector.dispose()
  })
  it('retries transient failure, removes expired projection, and drops rejected batches', async () => {
    const report = vi.fn().mockRejectedValue(new Error('offline'))
    const { collector } = setup(report)
    observe(collector, 1)
    await collector.flush()
    expect(collector.projectContext(context).seenMediaIds).toEqual([1])
    collector.setAvailability(true, false)
    await vi.advanceTimersByTimeAsync(60_001)
    collector.setAvailability(true, true)
    expect(collector.projectContext(context).seenMediaIds).toEqual([])
    report.mockRejectedValue({ data: { code: 'FORBIDDEN' } })
    observe(collector, 2)
    await collector.flush()
    expect(collector.projectContext(context).seenMediaIds).toEqual([])
    collector.dispose()
  })
  it('does not optimistically complete videos from start or poster observations', () => {
    const { collector } = setup()
    const videoContext = { ...context, media: [{ mediaId: 1, memberMediaIds: [1], index: 0, isVideo: true }] }
    collector.setContext(videoContext, 'alice')
    observe(collector, 1)
    expect(collector.projectContext(videoContext).seenMediaIds).toEqual([])
    collector.observe('video', { artworkId: 1, mediaId: 1, ready: true, visible: true, automatic: false,
      playback: { currentTime: 90, duration: 100, playing: true } })
    expect(collector.projectContext(videoContext).seenMediaIds).toEqual([1])
    collector.dispose()
  })

  it('drains an oversized batch without including new observations in its continuation', async () => {
    let finish!: (value: ReadingReportResult) => void
    const report = vi.fn().mockImplementationOnce(() => new Promise<ReadingReportResult>((resolve) => { finish = resolve }))
      .mockResolvedValue(response)
    const { collector } = setup(report)
    for (let id = 1; id <= 205; id++) observe(collector, id)
    await vi.advanceTimersByTimeAsync(3000)
    collector.clearSurface('media-1')
    observe(collector, 1)
    await vi.advanceTimersByTimeAsync(100)
    finish(response)
    await vi.advanceTimersByTimeAsync(0)
    expect(report.mock.calls.map(([input]) => input.events.length)).toEqual([100, 100, 5])
    await vi.advanceTimersByTimeAsync(2900)
    expect(report.mock.calls.map(([input]) => input.events.length)).toEqual([100, 100, 5, 1])
    collector.dispose()
  })

  it('flushes only the departing artwork and preserves the other artwork deadline', async () => {
    const report = vi.fn(async (input: ReadingReportInput) => ({
      ...response, summary: { ...context.summary, artworkId: input.artworkId }
    }))
    const { collector } = setup(report)
    const other = { ...context, artworkId: 2, summary: { ...context.summary, artworkId: 2 } }
    collector.setContext(other, 'alice')
    observe(collector, 1)
    await vi.advanceTimersByTimeAsync(1000)
    collector.observe('other', { artworkId: 2, mediaId: 2, ready: true, visible: true, automatic: false })
    collector.clearArtwork(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(report.mock.calls.map(([input]) => input.artworkId)).toEqual([1])
    await vi.advanceTimersByTimeAsync(2999)
    expect(report).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(report.mock.calls.map(([input]) => input.artworkId)).toEqual([1, 2])
    collector.dispose()
  })

  it('retries after leaving and notifies once when the last valid view expires', async () => {
    const report = vi.fn().mockRejectedValue(new Error('network'))
    const onDiscard = vi.fn()
    const collector = new ReadingCollector({ report, onDiscard })
    collector.setAccount('alice')
    collector.setContext(context, 'alice')
    observe(collector, 1)
    collector.clearArtwork(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(report).toHaveBeenCalledTimes(1)
    expect(onDiscard).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3000)
    expect(report).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(57000)
    expect(onDiscard).toHaveBeenCalledExactlyOnceWith(1, 'alice')
    expect(collector.projectContext(context).seenMediaIds).toEqual([])
    const attempts = report.mock.calls.length
    await vi.advanceTimersByTimeAsync(30000)
    expect(report).toHaveBeenCalledTimes(attempts)
    collector.dispose()
  })

  it('rejects only the in-flight batch and preserves new observations for a later save', async () => {
    let reject!: (error: unknown) => void
    const report = vi.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
      .mockResolvedValue(response)
    const onDiscard = vi.fn()
    const collector = new ReadingCollector({ report, onDiscard })
    collector.setAccount('alice')
    collector.setContext(context, 'alice')
    observe(collector, 1)
    await vi.advanceTimersByTimeAsync(3000)
    observe(collector, 2)
    reject({ data: { code: 'BAD_REQUEST' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(collector.projectContext(context).seenMediaIds).toEqual([2])
    expect(onDiscard).toHaveBeenCalledExactlyOnceWith(1, 'alice')
    await vi.advanceTimersByTimeAsync(3000)
    expect(report.mock.calls[1]?.[0].events).toMatchObject([{ mediaId: 2 }])
    collector.dispose()
  })

  it('does not notify or retry an old account after a late failure', async () => {
    let reject!: (error: unknown) => void
    const report = vi.fn().mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    const onDiscard = vi.fn()
    const onError = vi.fn()
    const collector = new ReadingCollector({ report, onDiscard, onError })
    collector.setAccount('alice')
    collector.setContext(context, 'alice')
    observe(collector, 1)
    const flushing = collector.flush()
    collector.setAccount('bob')
    reject({ data: { code: 'FORBIDDEN' } })
    await flushing
    await vi.advanceTimersByTimeAsync(60000)
    expect(report).toHaveBeenCalledTimes(1)
    expect(onDiscard).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    collector.dispose()
  })
})
