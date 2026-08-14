import { describe, expect, it } from 'vitest'
import {
  assertLegacyBackgroundExecutionAllowed,
  isCentralDispatcherCutoverEnabled,
  LegacyBackgroundExecutionDisabledError
} from '../dispatcher-cutover'

describe('central dispatcher cutover guard', () => {
  it('defaults to legacy execution when the flag is absent', () => {
    expect(isCentralDispatcherCutoverEnabled({})).toBe(false)
    expect(() => assertLegacyBackgroundExecutionAllowed('TEST_JOB', {})).not.toThrow()
  })

  it('rejects detached legacy execution after cutover', () => {
    const environment = { CENTRAL_DISPATCHER_CUTOVER_ENABLED: 'true' }
    expect(() => assertLegacyBackgroundExecutionAllowed('TEST_JOB', environment)).toThrow(
      LegacyBackgroundExecutionDisabledError
    )
  })
})
