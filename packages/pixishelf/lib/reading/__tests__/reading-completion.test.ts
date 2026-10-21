import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingContextDto, ReadingReportInput, ReadingReportResult } from '@pixishelf/db/reading-contract'
import { ReadingCollector } from '../reading-collector'

const context: ReadingContextDto = {
  artworkId: 1, mediaRevision: 1, seenMediaIds: [11], resume: null,
  media: [11, 12].map((mediaId, index) => ({ mediaId, memberMediaIds: [mediaId], index })),
  summary: { artworkId: 1, mediaRevision: 1, stateVersion: 3, totalCount: 2, seenCount: 1, viewCount: 1,
    status: 'IN_PROGRESS', lastActiveAt: null, lastViewedAt: null, lastMediaId: 11, lastMediaIndex: 0 }
}
const completed: ReadingReportResult = { mediaRevision: 1, seenMediaIds: [11, 12],
  summary: { ...context.summary, stateVersion: 4, seenCount: 2, status: 'COMPLETED' } }
const observation = { artworkId: 1, mediaId: 12, ready: true, visible: true, automatic: false }
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
function setup(report: (input: ReadingReportInput, signal: AbortSignal) => Promise<ReadingReportResult> = vi.fn(async () => completed)) {
  const onCompleted = vi.fn()
  const onDiscard = vi.fn()
  const collector = new ReadingCollector({ report, onCompleted, onDiscard })
  collector.setAccount('alice')
  collector.setContext(context, 'alice')
  return { collector, onCompleted, onDiscard }
}

describe('immediate completion notifications', () => {
  it('toasts before the batch timer, without forging confirmed versions or repeating after slow acknowledgement', async () => {
    let finish!: (result: ReadingReportResult) => void
    const report = vi.fn(() => new Promise<ReadingReportResult>(resolve => { finish = resolve }))
    const { collector, onCompleted } = setup(report)
    collector.observe('detail', observation)
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'COMPLETED', stateVersion: 3 }), 'alice')
    expect(report).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3000)
    collector.observe('preview', observation)
    collector.clearArtwork(1)
    collector.observe('reopened', observation)
    expect(onCompleted).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10000)
    finish(completed)
    await vi.advanceTimersByTimeAsync(0)
    expect(onCompleted).toHaveBeenCalledTimes(1)
    collector.dispose()
  })

  it('rolls back rejected progress and reports it unsaved without re-toasting on reread or retry', async () => {
    const report = vi.fn().mockRejectedValueOnce({ data: { code: 'BAD_REQUEST' } }).mockResolvedValue(completed)
    const { collector, onCompleted, onDiscard } = setup(report)
    collector.observe('detail', observation)
    expect(onCompleted).toHaveBeenCalledTimes(1)
    await collector.flush()
    expect(onDiscard).toHaveBeenCalledExactlyOnceWith(1, 'alice')
    expect(collector.projectContext(context).summary.status).toBe('IN_PROGRESS')
    collector.clearSurface('detail')
    collector.observe('detail', observation)
    await collector.flush()
    expect(onCompleted).toHaveBeenCalledTimes(1)
    collector.dispose()
  })

  it('does not repeat after transient retries and eventual expiry', async () => {
    const report = vi.fn().mockRejectedValue(new Error('network'))
    const { collector, onCompleted, onDiscard } = setup(report)
    collector.observe('detail', observation)
    await vi.advanceTimersByTimeAsync(60000)
    expect(onCompleted).toHaveBeenCalledTimes(1)
    expect(onDiscard).toHaveBeenCalledExactlyOnceWith(1, 'alice')
    collector.clearSurface('detail')
    collector.observe('detail', observation)
    expect(onCompleted).toHaveBeenCalledTimes(1)
    collector.dispose()
  })

  it('deduplicates within a revision and isolates different works, revisions and accounts', () => {
    const { collector, onCompleted } = setup()
    collector.observe('detail', observation)
    collector.invalidateArtwork(1)
    collector.resetArtwork(1, context, 'alice')
    collector.observe('detail', observation)
    expect(onCompleted).toHaveBeenCalledTimes(1)
    collector.invalidateArtwork(1)
    collector.resetArtwork(1, { ...context, mediaRevision: 2, summary: { ...context.summary, mediaRevision: 2 } }, 'alice')
    collector.observe('detail', observation)
    expect(onCompleted).toHaveBeenCalledTimes(2)
    collector.setContext({ ...context, artworkId: 2, summary: { ...context.summary, artworkId: 2 } }, 'alice')
    collector.observe('other', { ...observation, artworkId: 2 })
    expect(onCompleted).toHaveBeenCalledTimes(3)
    collector.setAccount('bob')
    collector.setContext(context, 'bob')
    collector.observe('detail', observation)
    expect(onCompleted).toHaveBeenLastCalledWith(expect.objectContaining({ artworkId: 1, mediaRevision: 1 }), 'bob')
    expect(onCompleted).toHaveBeenCalledTimes(4)
    collector.dispose()
  })

  it('does not toast for an already completed or empty work, nor from server-only completion', async () => {
    const { collector, onCompleted } = setup()
    collector.setContext({ ...context, ...completed }, 'alice')
    collector.observe('detail', observation)
    await collector.flush()
    expect(onCompleted).not.toHaveBeenCalled()
    collector.setAccount('bob')
    collector.setContext({ ...context, seenMediaIds: [], media: [], summary: { ...context.summary, totalCount: 0, seenCount: 0 } }, 'bob')
    collector.observe('detail', observation)
    await collector.flush()
    expect(onCompleted).not.toHaveBeenCalled()
    collector.setAccount('carol')
    collector.setContext({ ...context, seenMediaIds: [], summary: { ...context.summary, seenCount: 0 } }, 'carol')
    collector.observe('detail', observation)
    await collector.flush()
    expect(onCompleted).not.toHaveBeenCalled()
    collector.dispose()
  })

  it('waits for valid video completion and visibility, not merely a loaded poster or playback start', () => {
    const { collector, onCompleted } = setup()
    collector.setContext({ ...context, media: context.media.map(item => ({ ...item, isVideo: item.mediaId === 12 })) }, 'alice')
    collector.observe('video', observation)
    expect(onCompleted).not.toHaveBeenCalled()
    collector.observe('video', { ...observation, playback: { currentTime: 89, duration: 100, playing: true } })
    expect(onCompleted).not.toHaveBeenCalled()
    collector.observe('video', { ...observation, visible: false, playback: { currentTime: 90, duration: 100, playing: true } })
    expect(onCompleted).not.toHaveBeenCalled()
    collector.observe('video', { ...observation, playback: { currentTime: 90, duration: 100, playing: true } })
    expect(onCompleted).toHaveBeenCalledTimes(1)
    collector.dispose()
  })
})
