import { describe, expect, it, vi } from 'vitest'
import { logFrozenSnapshotPage, reportScanPageProgress } from '../progress.js'

describe('scan progress logging', () => {
  it('writes each persisted page progress to both the event stream and the rotating worker log', async () => {
    const context = {
      progress: vi.fn(async () => undefined),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    await reportScanPageProgress({ context, event: 'scan.progress.page', processed: 20, total: 100 })

    expect(context.progress).toHaveBeenCalledWith({
      progress: 19,
      stage: 'PROCESSING',
      message: 'Processed 20/100 frozen inputs',
      data: { processed: 20, total: 100 }
    })
    expect(context.logger.info).toHaveBeenCalledWith('scan.progress.page', {
      stage: 'PROCESSING',
      processed: 20,
      total: 100,
      progress: 19
    })
  })

  it('logs every frozen snapshot page without exposing filesystem paths', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    logFrozenSnapshotPage({ logger, frozen: 200, pageItems: 100 })
    expect(logger.info).toHaveBeenCalledWith('scan.snapshot.page.frozen', {
      stage: 'DISCOVERY',
      frozen: 200,
      pageItems: 100
    })
  })
})
