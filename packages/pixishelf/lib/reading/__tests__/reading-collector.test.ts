import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingContextDto, ReadingReportInput, ReadingReportResult } from '@pixishelf/db/reading-contract'
import { ReadingCollector } from '../reading-collector'

const summary = {
  artworkId: 1,
  viewCount: 1,
  seenCount: 1,
  totalCount: 2,
  status: 'IN_PROGRESS' as const,
  lastViewedAt: '2026-09-24T00:00:00.000Z',
  lastActiveAt: '2026-09-24T00:00:00.000Z',
  lastMediaId: 11,
  lastMediaIndex: 0
}

const context: ReadingContextDto = {
  artworkId: 1,
  mediaRevision: 1,
  media: [
    { mediaId: 11, memberMediaIds: [11], index: 0 },
    { mediaId: 12, memberMediaIds: [12], index: 1 }
  ],
  summary: { ...summary, viewCount: 0, seenCount: 0, status: 'UNREAD' },
  resume: null
}

function setup(report = vi.fn(async (input: ReadingReportInput, signal: AbortSignal): Promise<ReadingReportResult> => {
  expect(input.artworkId).toBe(1)
  expect(signal).toBeInstanceOf(AbortSignal)
  return { mediaRevision: 1, summary }
})) {
  const onSummary = vi.fn()
  const onInvalidated = vi.fn()
  const collector = new ReadingCollector({ report, onSummary, onInvalidated })
  collector.setAccount('alice')
  collector.setContext(context, 'alice')
  return { collector, report, onSummary, onInvalidated }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ReadingCollector', () => {
  it('requires 500 ms continuously ready, visible, foreground manual dwell', async () => {
    const { collector, report } = setup()
    const observation = { artworkId: 1, mediaId: 11, ready: true, visible: true, automatic: false }
    collector.observe('detail', observation)
    await vi.advanceTimersByTimeAsync(300)
    collector.observe('detail', observation)
    await vi.advanceTimersByTimeAsync(199)
    await collector.flush()
    expect(report).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0]?.[0].events).toMatchObject([{ type: 'VIEW', mediaId: 11 }])

    collector.observe('detail', { ...observation, visible: false })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(report).toHaveBeenCalledTimes(1)
    collector.dispose()
  })

  it('records automatic presentation immediately and counts only the highest active surface', async () => {
    const { collector, report } = setup()
    collector.observe('detail', { artworkId: 1, mediaId: 11, ready: true, visible: true, automatic: false })
    await vi.advanceTimersByTimeAsync(250)
    collector.observe('overlay', {
      artworkId: 1, mediaId: 12, ready: true, visible: true, automatic: true, priority: 100
    })
    await collector.flush()
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0]?.[0].events).toMatchObject([{ type: 'VIEW', mediaId: 12 }])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(report).toHaveBeenCalledTimes(1)
    collector.clearSurface('overlay')
    await vi.advanceTimersByTimeAsync(499)
    expect(report).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await collector.flush()
    expect(report.mock.calls[1]?.[0].events).toMatchObject([{ type: 'VIEW', mediaId: 11 }])
    collector.dispose()
  })

  it('cancels dwell and heartbeat offscreen and requires a fresh observation after resume', async () => {
    const { collector, report } = setup()
    const observation = { artworkId: 1, mediaId: 11, ready: true, visible: true, automatic: false }
    collector.observe('detail', observation)
    await vi.advanceTimersByTimeAsync(250)
    collector.setAvailability(false, true)
    await vi.advanceTimersByTimeAsync(1_000)
    collector.setAvailability(true, true)
    await vi.advanceTimersByTimeAsync(61_000)
    expect(report).not.toHaveBeenCalled()
    collector.observe('detail', observation)
    await vi.advanceTimersByTimeAsync(500)
    await collector.flush()
    expect(report).toHaveBeenCalledTimes(1)
    collector.observe('detail', { ...observation, visible: false })
    await vi.advanceTimersByTimeAsync(61_000)
    expect(report).toHaveBeenCalledTimes(1)
    collector.dispose()
  })

  it('sends heartbeat only after a view was accepted and while still visible', async () => {
    const { collector, report } = setup()
    collector.observe('reader', { artworkId: 1, mediaId: 11, ready: true, visible: true, automatic: true })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(report).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    await collector.flush()
    expect(report.mock.calls[1]?.[0].events).toMatchObject([{ type: 'HEARTBEAT', mediaId: 11 }])
    collector.clearSurface('reader')
    await vi.advanceTimersByTimeAsync(65_000)
    expect(report).toHaveBeenCalledTimes(2)
    collector.dispose()
  })

  it('drops queued observations after 60 seconds and never replays them on network recovery', async () => {
    const report = vi.fn(async () => { throw new Error('offline') })
    const { collector } = setup(report)
    collector.observe('reader', { artworkId: 1, mediaId: 11, ready: true, visible: true, automatic: true })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(report).toHaveBeenCalledTimes(1)
    collector.setAvailability(true, false)
    await vi.advanceTimersByTimeAsync(61_000)
    collector.setAvailability(true, true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(report).toHaveBeenCalledTimes(1)
    collector.dispose()
  })

  it('clears an old account and ignores its late response', async () => {
    let resolveReport: (value: ReadingReportResult) => void = () => { throw new Error('uninitialized') }
    const report = vi.fn((input: ReadingReportInput, signal: AbortSignal) => new Promise<ReadingReportResult>((resolve) => {
      expect(input.expectedUserId).toBe('alice')
      expect(signal).toBeInstanceOf(AbortSignal)
      resolveReport = resolve
    }))
    const { collector, onSummary } = setup(report)
    collector.observe('reader', { artworkId: 1, mediaId: 11, ready: true, visible: true, automatic: true })
    const flushing = collector.flush()
    collector.setAccount('bob')
    resolveReport({ mediaRevision: 1, summary })
    await flushing
    expect(onSummary).not.toHaveBeenCalled()
    collector.dispose()
  })

  it('drops the old revision queue and requires explicit reopen', async () => {
    const report = vi.fn(async () => { throw new Error('READING_MEDIA_REVISION_CONFLICT') })
    const { collector, onInvalidated } = setup(report)
    collector.observe('reader', { artworkId: 1, mediaId: 11, ready: true, visible: true, automatic: true })
    await collector.flush()
    expect(collector.getInvalidated(1)).toBe(true)
    expect(onInvalidated).toHaveBeenCalledWith(1, 'alice')
    collector.observe('reader', { artworkId: 1, mediaId: 11, ready: true, visible: true, automatic: true })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(report).toHaveBeenCalledTimes(1)
    collector.resetArtwork(1, { ...context, mediaRevision: 2 }, 'alice')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(report).toHaveBeenCalledTimes(1)
    collector.dispose()
  })
})
