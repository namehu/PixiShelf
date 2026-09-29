import { describe, expect, it } from 'vitest'
import { archiveUploaderDetailPollingInterval, scanIdentityLabel } from '../archive-uploader-view-state'

describe('archive uploader view state', () => {
  it('keeps polling while any run is active even when the selected run is old', () => {
    expect(
      archiveUploaderDetailPollingInterval({
        runs: [{ status: 'COMPLETED' }, { status: 'RUNNING' }]
      })
    ).toBe(3_000)
  })

  it('stops polling after every recent run becomes terminal', () => {
    expect(
      archiveUploaderDetailPollingInterval({
        runs: [{ status: 'COMPLETED' }, { status: 'FAILED' }, { status: 'CANCELLED' }]
      })
    ).toBe(false)
  })

  it('keeps polling while catalog items are being processed', () => {
    expect(
      archiveUploaderDetailPollingInterval({
        source: { catalogCounts: { processing: 2 } },
        runs: [{ status: 'COMPLETED' }]
      })
    ).toBe(3_000)
  })

  it('labels the frozen identity used by each scan run', () => {
    expect(scanIdentityLabel('UID', '123')).toBe('按 UID 123')
    expect(scanIdentityLabel('NAME', 'alice')).toBe('按名称 alice')
  })
})
