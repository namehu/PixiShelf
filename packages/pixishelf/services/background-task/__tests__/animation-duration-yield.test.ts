import { describe, expect, it } from 'vitest'
import { isLegacyAnimationDurationYield } from '../animation-duration-yield'
import { toJobDto, toJobLiveSummary } from '../job-serialization'
import { jobRecord } from './test-fixtures'

const oldYield = jobRecord({
  type: 'ANIMATION_DURATION_PROBE',
  status: 'PAUSED',
  stage: 'YIELDING',
  errorCode: 'RESOURCE_BUSY',
  error: 'Animation duration probe yielded after a durable batch'
})

describe('legacy animation duration scheduling yield', () => {
  it.each(['YIELDING', 'WAITING_RETRY', 'WAITING_SOURCE_WRITE'] as const)(
    'removes the stale task error from paused %s status and live projections',
    (stage) => {
      const row = { ...oldYield, stage }
      expect(isLegacyAnimationDurationYield(row)).toBe(true)
      expect(toJobDto(row)).toMatchObject({ status: 'PAUSED', errorCode: null, error: null })
      const live = toJobLiveSummary(row as never)
      expect(live).toMatchObject({ status: 'PAUSED', errorCode: null })
      expect(JSON.stringify(live)).not.toContain('"error"')
    }
  )

  it('preserves real resource failures and other job types', () => {
    for (const row of [
      { ...oldYield, error: 'Animation duration child is unavailable or the source changed during a read' },
      { ...oldYield, type: 'ARCHIVE_IMPORT' as const },
      { ...oldYield, status: 'FAILED' as const }
    ]) {
      expect(isLegacyAnimationDurationYield(row)).toBe(false)
      expect(toJobDto(row).errorCode).toBe('RESOURCE_BUSY')
    }
  })
})
