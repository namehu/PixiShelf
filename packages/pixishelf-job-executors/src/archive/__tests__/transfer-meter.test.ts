import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArchiveTransferMeter, startArchiveTransferReporter } from '../transfer-meter.ts'

afterEach(() => vi.useRealTimers())

describe('ArchiveTransferMeter', () => {
  it('aggregates active streams without retaining chunks and removes a failed partial stream', () => {
    const meter = new ArchiveTransferMeter('archive-1', 4, 3, {
      completedBytes: 100n,
      completedItems: 1,
      failedItems: 0
    })
    meter.startItem({ itemId: 'item-a', pageIndex: 0, expectedFilename: '0001', attempt: 1 })
    meter.startItem({ itemId: 'item-b', pageIndex: 1, expectedFilename: '0002', attempt: 1 })
    meter.beginDownload('item-a', 1_200)
    meter.markPhase('item-b', 'WAITING_MEDIA_RESPONSE')
    expect(meter.sample(new Date('2026-01-01T00:00:00.000Z'))).toMatchObject({
      downloadedBytes: '100',
      activeDownloads: 1,
      activeWorkers: 2,
      bytesPerSecond: 0
    })

    meter.addChunk('item-a', 600)
    meter.addChunk('item-b', 400)
    expect(meter.sample(new Date('2026-01-01T00:00:01.000Z'))).toMatchObject({
      downloadedBytes: '1100',
      activeDownloads: 1,
      activeWorkers: 2,
      bytesPerSecond: 1000,
      activeItems: [
        expect.objectContaining({
          itemId: 'item-a',
          phase: 'DOWNLOADING',
          downloadedBytes: '600',
          totalBytes: '1200',
          bytesPerSecond: 600
        }),
        expect.objectContaining({
          itemId: 'item-b',
          phase: 'WAITING_MEDIA_RESPONSE',
          downloadedBytes: '400',
          totalBytes: null,
          bytesPerSecond: 400
        })
      ]
    })

    meter.fail('item-b', false)
    meter.markVerifying('item-a')
    expect(meter.sample(new Date('2026-01-01T00:00:02.000Z'))).toMatchObject({
      downloadedBytes: '700',
      activeDownloads: 0,
      activeWorkers: 1,
      completedItems: 1,
      failedItems: 0,
      activeItems: [expect.objectContaining({ itemId: 'item-a', phase: 'VERIFYING' })]
    })

    meter.complete('item-a', 600n)
    expect(meter.sample(new Date('2026-01-01T00:00:03.000Z'))).toMatchObject({
      downloadedBytes: '700',
      activeDownloads: 0,
      activeWorkers: 0,
      completedItems: 2
    })
  })

  it('counts a terminal failure once while retryable failures reset to zero', () => {
    const meter = new ArchiveTransferMeter('archive-2', 2, 1, {
      completedBytes: 0n,
      completedItems: 0,
      failedItems: 0
    })
    meter.startItem({ itemId: 'item', pageIndex: 0, expectedFilename: '0001', attempt: 1 })
    meter.beginDownload('item', null)
    meter.addChunk('item', 50)
    meter.fail('item', false)
    meter.startItem({ itemId: 'item', pageIndex: 0, expectedFilename: '0001', attempt: 2 })
    meter.beginDownload('item', null)
    meter.addChunk('item', 25)
    meter.fail('item', true)

    expect(meter.sample(new Date('2026-01-01T00:00:00.000Z'))).toMatchObject({
      downloadedBytes: '0',
      activeDownloads: 0,
      completedItems: 0,
      failedItems: 1
    })
  })

  it('does not keep writing telemetry while no download is active and values are unchanged', async () => {
    vi.useFakeTimers()
    let now = Date.parse('2026-01-01T00:00:00.000Z')
    const report = vi.fn(async () => undefined)
    const reporter = startArchiveTransferReporter({
      meter: new ArchiveTransferMeter('archive-idle', 2, 1, {
        completedBytes: 0n,
        completedItems: 0,
        failedItems: 0
      }),
      controller: new AbortController(),
      report,
      now: () => new Date((now += 1_000))
    })

    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(report).toHaveBeenCalledOnce()
    await reporter.stop()
  })

  it('aborts the execution and surfaces a telemetry persistence failure', async () => {
    vi.useFakeTimers()
    const failure = new Error('progress fence lost')
    const controller = new AbortController()
    const meter = new ArchiveTransferMeter('archive-fenced', 2, 1, {
      completedBytes: 0n,
      completedItems: 0,
      failedItems: 0
    })
    meter.startItem({ itemId: 'item', pageIndex: 0, expectedFilename: '0001', attempt: 1 })
    meter.beginDownload('item', null)
    meter.addChunk('item', 10)
    const reporter = startArchiveTransferReporter({
      meter,
      controller,
      report: vi.fn().mockRejectedValue(failure),
      now: () => new Date('2026-01-01T00:00:01.000Z')
    })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(controller.signal.aborted).toBe(true)
    await expect(reporter.stop()).rejects.toBe(failure)
  })

  it('flushes the final counts even when an ordinary report already observed the same state', async () => {
    vi.useFakeTimers()
    let now = Date.parse('2026-01-01T00:00:00.000Z')
    const meter = new ArchiveTransferMeter('archive-final', 2, 1, {
      completedBytes: 0n,
      completedItems: 0,
      failedItems: 0
    })
    const report = vi.fn(async () => undefined)
    const flush = vi.fn(async () => undefined)
    const reporter = startArchiveTransferReporter({
      meter,
      controller: new AbortController(),
      report,
      flush,
      now: () => new Date(now)
    })
    meter.startItem({ itemId: 'item', pageIndex: 0, expectedFilename: '0001', attempt: 1 })
    meter.beginDownload('item', null)
    meter.addChunk('item', 512)
    meter.complete('item', 512n)
    now += 1_000
    await vi.advanceTimersByTimeAsync(1_000)

    await reporter.stop()

    expect(report).toHaveBeenCalledOnce()
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ downloadedBytes: '512', activeDownloads: 0, completedItems: 1 })
    )
    expect(flush).toHaveBeenCalledOnce()
    expect(flush).toHaveBeenCalledWith(
      expect.objectContaining({ downloadedBytes: '512', activeDownloads: 0, completedItems: 1 })
    )
  })

  it('keeps reporting while workers are waiting so the live panel does not become stale', async () => {
    vi.useFakeTimers()
    let now = Date.parse('2026-01-01T00:00:00.000Z')
    const meter = new ArchiveTransferMeter('archive-waiting', 2, 2, {
      completedBytes: 0n,
      completedItems: 0,
      failedItems: 0
    })
    meter.startItem({ itemId: 'item', pageIndex: 0, expectedFilename: '0001', attempt: 1 })
    meter.markPhase('item', 'WAITING_MEDIA_RESPONSE')
    const report = vi.fn(async () => undefined)
    const reporter = startArchiveTransferReporter({
      meter,
      controller: new AbortController(),
      report,
      now: () => new Date((now += 1_000))
    })

    await vi.advanceTimersByTimeAsync(3_000)
    await reporter.stop()

    expect(report).toHaveBeenCalledTimes(3)
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ activeWorkers: 1, activeDownloads: 0 }))
  })
})
