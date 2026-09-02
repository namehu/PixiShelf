import { describe, expect, it } from 'vitest'
import { archiveUploaderDetailPollingInterval } from '../archive-uploader-view-state'

describe('archive uploader view state', () => {
  it('keeps polling while any run is active even when the selected run is old', () => {
    expect(
      archiveUploaderDetailPollingInterval({
        runs: [{ status: 'COMPLETED' }, { status: 'RUNNING' }]
      })
    ).toBe(2_000)
  })

  it('stops polling after every recent run becomes terminal', () => {
    expect(
      archiveUploaderDetailPollingInterval({
        runs: [{ status: 'COMPLETED' }, { status: 'FAILED' }, { status: 'CANCELLED' }]
      })
    ).toBe(false)
  })
})
