import { describe, expect, it } from 'vitest'
import { toJobDto, toJobEventDto } from '../job-serialization'
import { listJobs } from '../job-query-service'
import { jobRecord, eventRecord } from './test-fixtures'

describe('batch deletion shared task projection', () => {
  const payload = {
    origin: {
      runId: 'run-1',
      losses: [
        { member: { ownOrganization: { rating: 4, bookmarks: 'private-bookmark' }, ownReading: 'private-reading' } }
      ]
    },
    items: [{ artworkId: 1, selectedPaths: ['private-file'], preview: { entries: ['private-preview'] } }],
    confirmed: true,
    stopAfterCurrent: false
  }
  const result = { items: [{ status: 'DELETED', report: { entries: ['private-report'] } }] }
  it('shows another account only the common run/count summary, without private organization, preview, selection or report', async () => {
    const record = jobRecord({ type: 'ARTWORK_BATCH_DELETE', requestedByUserId: 'other-account', payload, result })
    const dto = toJobDto(record)
    expect(dto.payload).toEqual({ runId: 'run-1', artworks: 1, confirmed: true, stopAfterCurrent: false })
    expect(dto.result).toEqual({ processed: 1, failed: 0 })
    const shared = await listJobs({ limit: 20 }, {
      systemJob: { findMany: async () => [record] },
      workerInstance: {}
    } as never)
    const serialized = JSON.stringify(shared)
    for (const privateField of [
      'ownOrganization',
      'ownReading',
      'private-bookmark',
      'private-reading',
      'private-file',
      'private-preview',
      'private-report'
    ]) {
      expect(serialized).not.toContain(privateField)
    }
  })
  it('does not expose a full result through shared task event data', () => {
    const event = toJobEventDto(eventRecord({ job: { type: 'ARTWORK_BATCH_DELETE' }, data: { payload, result } }))
    expect(event.data).toBeNull()
  })
})
