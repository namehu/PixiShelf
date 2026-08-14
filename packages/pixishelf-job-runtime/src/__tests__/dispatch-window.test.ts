import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DISPATCH_TIME_ZONE,
  DispatchWindowPolicy,
  MANUAL_PRIORITY_MAX,
  SCHEDULED_PRIORITY_MIN
} from '../dispatch-window.js'

describe('DispatchWindowPolicy', () => {
  const policy = new DispatchWindowPolicy()

  it('uses the agreed Asia/Shanghai 00:00-08:00 window', () => {
    expect(policy.timeZone).toBe(DEFAULT_DISPATCH_TIME_ZONE)
    expect(policy.isAutomaticWindowOpen(new Date('2026-08-13T15:59:59.999Z'))).toBe(false)
    expect(policy.isAutomaticWindowOpen(new Date('2026-08-13T16:00:00.000Z'))).toBe(true)
    expect(policy.isAutomaticWindowOpen(new Date('2026-08-13T23:59:59.999Z'))).toBe(true)
    expect(policy.isAutomaticWindowOpen(new Date('2026-08-14T00:00:00.000Z'))).toBe(false)
  })

  it('allows only manual priority 0-99 outside the automatic window', () => {
    const outsideWindow = new Date('2026-08-14T04:00:00.000Z')

    expect(policy.canClaim({ triggerSource: 'MANUAL', effectivePriority: MANUAL_PRIORITY_MAX }, outsideWindow)).toBe(
      true
    )
    expect(policy.canClaim({ triggerSource: 'MANUAL', effectivePriority: SCHEDULED_PRIORITY_MIN }, outsideWindow)).toBe(
      false
    )
    expect(policy.canClaim({ triggerSource: 'RETRY', effectivePriority: MANUAL_PRIORITY_MAX }, outsideWindow)).toBe(
      true
    )
    expect(
      policy.canClaim({ triggerSource: 'SCHEDULE', effectivePriority: SCHEDULED_PRIORITY_MIN }, outsideWindow)
    ).toBe(false)
  })

  it('allows a manual pipeline SYSTEM child without a deadline outside the window', () => {
    const outsideWindow = new Date('2026-08-14T04:00:00.000Z')

    expect(
      policy.canClaim(
        { triggerSource: 'SYSTEM', effectivePriority: SCHEDULED_PRIORITY_MIN, deadlineAt: null },
        outsideWindow
      )
    ).toBe(true)
    expect(
      policy.canClaim(
        {
          triggerSource: 'SYSTEM',
          effectivePriority: SCHEDULED_PRIORITY_MIN,
          deadlineAt: new Date('2026-08-14T00:00:00.000Z')
        },
        outsideWindow
      )
    ).toBe(false)
  })

  it('allows scheduled priority 100-999 only inside the automatic window', () => {
    const insideWindow = new Date('2026-08-13T18:00:00.000Z')

    expect(
      policy.canClaim({ triggerSource: 'SCHEDULE', effectivePriority: SCHEDULED_PRIORITY_MIN }, insideWindow)
    ).toBe(true)
    expect(policy.canClaim({ triggerSource: 'SYSTEM', effectivePriority: 999 }, insideWindow)).toBe(true)
    expect(policy.canClaim({ triggerSource: 'SCHEDULE', effectivePriority: 1_000 }, insideWindow)).toBe(false)
  })

  it('exposes the local date for window expiry decisions', () => {
    expect(policy.localTime(new Date('2026-08-13T16:05:06.000Z'))).toEqual({
      date: '2026-08-14',
      hour: 0,
      minute: 5,
      second: 6
    })
  })
})
