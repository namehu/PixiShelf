import { describe, expect, it } from 'vitest'
import { archiveImportDefaultTagIdsForRetry } from '../archive-job-payload'

describe('archive retry payload compatibility', () => {
  it('upgrades v1 retries with an empty frozen default-tag selection', () => {
    expect(
      archiveImportDefaultTagIdsForRetry(
        { definitionVersion: 1, payload: { archiveImportId: 'import-1' } },
        'import-1'
      )
    ).toEqual([])
  })

  it('preserves canonical v2 default tags across retries', () => {
    expect(
      archiveImportDefaultTagIdsForRetry(
        { definitionVersion: 2, payload: { archiveImportId: 'import-1', defaultTagIds: [2, 5] } },
        'import-1'
      )
    ).toEqual([2, 5])
  })

  it.each([
    { definitionVersion: 3, payload: { archiveImportId: 'import-1', defaultTagIds: [] } },
    { definitionVersion: 2, payload: { archiveImportId: 'other', defaultTagIds: [] } },
    { definitionVersion: 2, payload: { archiveImportId: 'import-1' } }
  ])('rejects unsupported or invalid retry bindings', (job) => {
    expect(() => archiveImportDefaultTagIdsForRetry(job, 'import-1')).toThrow('不能重试')
  })
})
