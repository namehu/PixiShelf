import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingContextDto, ReadingReportInput, ReadingReportResult } from '@pixishelf/db/reading-contract'
import { ReadingCollector } from '../reading-collector'

const summary = {
  artworkId: 1, mediaRevision: 1, stateVersion: 0,
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
  seenMediaIds: [],
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
  return { mediaRevision: 1, seenMediaIds: [11], summary }
})) {
  const onSummary = vi.fn()
  const onInvalidated = vi.fn()
  const onCompleted = vi.fn()
  const collector = new ReadingCollector({ report, onSummary, onInvalidated, onCompleted })
  collector.setAccount('alice')
  collector.setContext(context, 'alice')
  return { collector, report, onSummary, onInvalidated, onCompleted }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ReadingCollector', () => {
  it('reports video start and completion once each without heartbeat resets on playback ticks', async () => {
    const { collector, report } = setup()
    const observation = { artworkId: 1, mediaId: 11, ready: true, visible: true, automatic: false }
    const playback = { currentTime: 1, duration: 100, playing: true }
    collector.observe('video', { ...observation, playback })
    await collector.flush()
    collector.observe('video', { ...observation, playback: { ...playback, currentTime: 89 } })
    await collector.flush()
    expect(report).toHaveBeenCalledTimes(1)
    collector.observe('video', { ...observation, playback: { ...playback, currentTime: 90 } })
    await collector.flush()
    expect(report).toHaveBeenCalledTimes(2)
    expect(report.mock.calls[1]?.[0].events).toMatchObject([{ type: 'VIEW', playback: { currentTime: 90, duration: 100 } }])
    collector.observe('video', { ...observation, playback: { ...playback, currentTime: 90, playing: false } })
    await vi.advanceTimersByTimeAsync(61_000)
    expect(report).toHaveBeenCalledTimes(2)
    collector.observe('video', { ...observation, playback: { ...playback, currentTime: 90 } })
    await vi.advanceTimersByTimeAsync(63_000)
    expect(report.mock.calls[2]?.[0].events).toMatchObject([{ type: 'HEARTBEAT', playback: { duration: 100 } }])
    collector.dispose()
  })
  it('records ready visible manual media immediately without a dwell timer', async () => {
    const { collector, report } = setup()
    const observation = { artworkId: 1, mediaId: 11, ready: true, visible: true, automatic: false }
    collector.observe('detail', observation)
    collector.observe('detail', observation)
    await collector.flush()
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0]?.[0].events).toMatchObject([{ type: 'VIEW', mediaId: 11 }])

    collector.observe('detail', { ...observation, visible: false })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(report).toHaveBeenCalledTimes(1)
    collector.dispose()
  })

  it('records automatic presentation immediately and counts only the highest active surface', async () => {
    const { collector, report } = setup()
    collector.observe('overlay', {
      artworkId: 1, mediaId: 12, ready: true, visible: true, automatic: true, priority: 100
    })
    collector.observe('detail', { artworkId: 1, mediaId: 11, ready: true, visible: true, automatic: false })
    await collector.flush()
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0]?.[0].events).toMatchObject([{ type: 'VIEW', mediaId: 12 }])
    await vi.advanceTimersByTimeAsync(3_000)
    expect(report).toHaveBeenCalledTimes(1)
    collector.clearSurface('overlay')
    await collector.flush()
    expect(report.mock.calls[1]?.[0].events).toMatchObject([{ type: 'VIEW', mediaId: 11 }])
    collector.dispose()
  })

  it('stops heartbeat offscreen and requires a fresh observation after resume', async () => {
    const { collector, report } = setup()
    const observation = { artworkId: 1, mediaId: 11, ready: true, visible: true, automatic: false }
    collector.observe('detail', observation)
    await collector.flush()
    report.mockClear()
    collector.setAvailability(false, true)
    await vi.advanceTimersByTimeAsync(3_000)
    collector.setAvailability(true, true)
    await vi.advanceTimersByTimeAsync(61_000)
    expect(report).not.toHaveBeenCalled()
    collector.observe('detail', observation)
    await collector.flush()
    expect(report).toHaveBeenCalledTimes(1)
    collector.observe('detail', { ...observation, visible: false })
    await vi.advanceTimersByTimeAsync(61_000)
    expect(report).toHaveBeenCalledTimes(1)
    collector.dispose()
  })

  it('ignores unloaded, offscreen and inactive media', async () => {
    const { collector, report } = setup()
    const observation = { artworkId: 1, mediaId: 11, ready: true, visible: true, automatic: false }
    collector.observe('loading', { ...observation, ready: false })
    collector.observe('offscreen', { ...observation, visible: false })
    collector.observe('blocked', { ...observation, active: false })
    await collector.flush()
    expect(report).not.toHaveBeenCalled()
    collector.dispose()
  })

  it('records all visible media when the context arrives late', async () => {
    const { collector, report } = setup()
    collector.setAccount('bob')
    for (const mediaId of [11, 12]) {
      collector.observe(`detail-${mediaId}`, { artworkId: 1, mediaId, ready: true, visible: true, automatic: false })
    }
    collector.setContext(context, 'bob')
    await collector.flush()
    expect(report.mock.calls[0]?.[0].events).toMatchObject([
      { type: 'VIEW', mediaId: 11 }, { type: 'VIEW', mediaId: 12 }
    ])
    collector.dispose()
  })

  it('notifies completion immediately once, not on acknowledgement or an already completed context', async () => {
    const completed = { ...summary, seenCount: 2, status: 'COMPLETED' as const }
    const report = vi.fn(async (): Promise<ReadingReportResult> => ({ mediaRevision: 1, seenMediaIds: [11, 12], summary: completed }))
    const { collector, onCompleted } = setup(report)
    collector.setContext({ ...context, summary, seenMediaIds: [11] }, 'alice')
    const observation = { artworkId: 1, mediaId: 12, ready: true, visible: true, automatic: false }
    collector.observe('detail', observation)
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith(completed, 'alice')
    expect(report).not.toHaveBeenCalled()
    await collector.flush()
    expect(onCompleted).toHaveBeenCalledTimes(1)
    collector.clearSurface('detail')
    collector.setContext(context, 'alice')
    collector.observe('detail', observation)
    await collector.flush()
    expect(onCompleted).toHaveBeenCalledTimes(1)
    collector.setAccount('bob')
    collector.setContext({ ...context, summary: completed }, 'bob')
    collector.observe('detail', observation)
    await collector.flush()
    expect(onCompleted).toHaveBeenCalledTimes(1)
    collector.dispose()
  })

  it('sends heartbeat only after a view was accepted and while still visible', async () => {
    const { collector, report } = setup()
    collector.observe('reader', { artworkId: 1, mediaId: 11, ready: true, visible: true, automatic: true })
    await vi.advanceTimersByTimeAsync(2_999)
    expect(report).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(report).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    await collector.flush()
    expect(report.mock.calls[1]?.[0].events).toMatchObject([{ type: 'HEARTBEAT', mediaId: 11 }])
    collector.clearSurface('reader')
    await vi.advanceTimersByTimeAsync(65_000)
    expect(report).toHaveBeenCalledTimes(2)
    collector.dispose()
  })

  it('continues heartbeat for an already recorded neighbor when the latest visible media leaves', async () => {
    const { collector, report } = setup()
    for (const mediaId of [11, 12]) {
      collector.observe(`detail-${mediaId}`, { artworkId: 1, mediaId, ready: true, visible: true, automatic: false })
    }
    await collector.flush()
    collector.clearSurface('detail-12')
    await vi.advanceTimersByTimeAsync(60_000)
    await collector.flush()
    expect(report.mock.calls[1]?.[0].events).toMatchObject([{ type: 'HEARTBEAT', mediaId: 11 }])
    collector.dispose()
  })

  it('drops queued observations after 60 seconds and never replays them on network recovery', async () => {
    const report = vi.fn(async () => { throw new Error('offline') })
    const { collector } = setup(report)
    collector.observe('reader', { artworkId: 1, mediaId: 11, ready: true, visible: true, automatic: true })
    await vi.advanceTimersByTimeAsync(3_000)
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
    resolveReport({ mediaRevision: 1, seenMediaIds: [11], summary })
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

describe('summary observation identity', () => {
  it('records a new group grant when switching the same visible image from complete to summary, and keeps it after expansion', async () => {
    const { collector, report } = setup()
    const observation = { artworkId: 1, mediaId: 11, ready: true, visible: true, automatic: false }
    collector.observe('detail', observation)
    await collector.flush()
    collector.observe('detail', { ...observation, summary: { generationId: 'snapshot', groupId: '11', mediaIds: [11, 12] } })
    expect(collector.projectContext(context).seenMediaIds).toEqual([11, 12])
    collector.observe('detail', observation)
    expect(collector.projectContext(context).seenMediaIds).toEqual([11, 12])
    await collector.flush()
    expect(report.mock.calls[1]?.[0].events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'VIEW', mediaId: 11, summary: { generationId: 'snapshot', groupId: '11' } })
    ]))
    collector.dispose()
  })
})


describe('stack collector evidence', () => {
  it('projects all members but sends only the real VIEW and a bounded stack credential', async () => {
    const { collector, report } = setup()
    const stack = { ruleVersion: 1 as const, fingerprint: 'a'.repeat(64), groupId: 'stack-v1-11-12', mediaIds: [11, 12] }
    collector.observe('detail-11', { artworkId: 1, mediaId: 11, ready: true, visible: true, automatic: false, stack })
    expect(collector.projectContext(context).seenMediaIds).toEqual([11, 12])
    await collector.flush()
    expect(report.mock.calls[0]![0].events).toEqual([{ type: 'VIEW', mediaId: 11,
      observedAt: new Date().toISOString(), stack: { ruleVersion: 1, fingerprint: stack.fingerprint, groupId: stack.groupId } }])
    collector.dispose()
  })
  it('does not count a hidden or transitioning slide and invalidates conflicting membership', async () => {
    const { collector, report, onInvalidated } = setup(vi.fn().mockRejectedValue({ message: 'ARTWORK_STACK_CONFLICT' }))
    const observation = { artworkId: 1, mediaId: 11, ready: true, visible: true, automatic: false,
      stack: { ruleVersion: 1 as const, fingerprint: 'a'.repeat(64), groupId: 'stack-v1-11-12', mediaIds: [11, 12] } }
    collector.observe('detail', { ...observation, active: false })
    collector.observe('neighbor', { ...observation, mediaId: 12, visible: false })
    await collector.flush()
    expect(report).not.toHaveBeenCalled()
    collector.observe('detail', observation)
    await collector.flush()
    expect(onInvalidated).toHaveBeenCalledWith(1, 'alice')
    expect(collector.projectContext(context).seenMediaIds).toEqual([])
    collector.dispose()
  })
})
