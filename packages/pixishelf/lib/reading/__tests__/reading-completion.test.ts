import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingContextDto, ReadingReportInput, ReadingReportResult } from '@pixishelf/db/reading-contract'
import { ReadingCollector } from '../reading-collector'

const context: ReadingContextDto = {
  artworkId: 1, readingLayoutVersion: 1, resume: null,
  media: [11, 12].map((mediaId, index) => ({ mediaId, memberMediaIds: [mediaId], index })),
  summary: { artworkId: 1, readingLayoutVersion: 1, stateVersion: 3, totalCount: 2, progressCount: 1, viewCount: 1,
    status: 'IN_PROGRESS', completed: false, furthestMediaId: null, furthestMediaIndex: null, lastActiveAt: null, lastViewedAt: null, lastMediaId: 11, lastMediaIndex: 0 }
}
const completed: ReadingReportResult = { readingLayoutVersion: 1, summary: { ...context.summary, stateVersion: 4, progressCount: 2, status: 'COMPLETED', completed: true, furthestMediaId: null, furthestMediaIndex: null } }
const observation = { artworkId: 1, mediaId: 12, ready: true, visible: true, automatic: false }
function progressContext(totalCount: number, progressCount: number): ReadingContextDto {
  return {
    ...context,
    media: Array.from({ length: totalCount }, (_, index) => ({ mediaId: index + 1, memberMediaIds: [index + 1], index })),
    summary: { ...context.summary, totalCount, progressCount }
  }
}
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
  it.each([[100, 90, false], [100, 99, false], [100, 100, true], [1, 1, true]] as const)(
    'completes %i items only at position %i', (total, position, finished) => {
      const { collector, onCompleted } = setup()
      const initial = progressContext(total, 0)
      collector.setContext(initial, 'alice')
      collector.observe('detail', { ...observation, mediaId: position })
      expect(collector.projectContext(initial).summary).toMatchObject({ progressCount: position, completed: finished })
      expect(onCompleted).toHaveBeenCalledTimes(finished ? 1 : 0)
      collector.dispose()
    })
  it('keeps maximum progress while rereading updates the resume position', () => {
    const { collector } = setup()
    const initial = progressContext(100, 0)
    collector.setContext(initial, 'alice')
    collector.observe('detail', { ...observation, mediaId: 80 })
    collector.observe('detail', { ...observation, mediaId: 30 })
    expect(collector.projectContext(initial).summary).toMatchObject({ progressCount: 80, completed: false,
      furthestMediaId: 80, furthestMediaIndex: 79, lastMediaId: 30, lastMediaIndex: 29 })
    expect(collector.projectContext(initial).resume).toEqual({ mediaId: 30, index: 29 })
    collector.dispose()
  })
  it('keeps an already completed work complete after additional media', () => {
    const { collector, onCompleted } = setup()
    const initial = progressContext(120, 120)
    initial.summary.completed = true
    initial.summary.status = 'COMPLETED'
    collector.setContext(initial, 'alice')
    collector.observe('detail', { ...observation, mediaId: 30 })
    expect(collector.projectContext(initial).summary).toMatchObject({ progressCount: 120, completed: true, lastMediaIndex: 29 })
    expect(onCompleted).not.toHaveBeenCalled()
    collector.dispose()
  })
  it('toasts before the batch timer, without forging confirmed versions or repeating after slow acknowledgement', async () => {
    let finish!: (result: ReadingReportResult) => void
    const report = vi.fn(() => new Promise<ReadingReportResult>(resolve => { finish = resolve }))
    const { collector, onCompleted } = setup(report)
    collector.observe('detail', observation)
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'COMPLETED', completed: true, stateVersion: 3 }), 'alice')
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
    collector.resetArtwork(1, { ...context, readingLayoutVersion: 2, summary: { ...context.summary, readingLayoutVersion: 2 } }, 'alice')
    collector.observe('detail', observation)
    expect(onCompleted).toHaveBeenCalledTimes(2)
    collector.setContext({ ...context, artworkId: 2, summary: { ...context.summary, artworkId: 2 } }, 'alice')
    collector.observe('other', { ...observation, artworkId: 2 })
    expect(onCompleted).toHaveBeenCalledTimes(3)
    collector.setAccount('bob')
    collector.setContext(context, 'bob')
    collector.observe('detail', observation)
    expect(onCompleted).toHaveBeenLastCalledWith(expect.objectContaining({ artworkId: 1, readingLayoutVersion: 1 }), 'bob')
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
    collector.setContext({ ...context, media: [], summary: { ...context.summary, totalCount: 0, progressCount: 0 } }, 'bob')
    collector.observe('detail', observation)
    await collector.flush()
    expect(onCompleted).not.toHaveBeenCalled()
    collector.setAccount('carol')
    collector.setContext({ ...context, summary: { ...context.summary, progressCount: 0 } }, 'carol')
    collector.observe('detail', { ...observation, mediaId: 11 })
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
