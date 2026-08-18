import { describe, expect, it } from 'vitest'
import { archiveTaskActionIneligibility, recoverAppliedArchiveTaskAction } from '../archive-task-action-policy'

describe('archive task bulk action policy', () => {
  it.each([
    ['PAUSED', 'PAUSE'],
    ['CANCELLING', 'CANCEL'],
    ['CANCELLED', 'CANCEL']
  ] as const)('treats a new %s/%s command as ineligible instead of reused', (status, action) => {
    expect(archiveTaskActionIneligibility(status, action)).toEqual({
      result: 'SKIPPED',
      code: 'INVALID_STATE',
      message: `状态 ${status} 不允许执行 ${action}`
    })
  })

  it.each([
    ['PENDING', 'PAUSE'],
    ['PAUSED', 'RESUME'],
    ['RUNNING', 'CANCEL'],
    ['FAILED', 'RETRY']
  ] as const)('accepts the current legal %s/%s combinations', (status, action) => {
    expect(archiveTaskActionIneligibility(status, action)).toBeNull()
  })

  it('recovers only when a fresh read proves that the requested action was applied', () => {
    expect(recoverAppliedArchiveTaskAction({ status: 'PENDING', systemJobId: 'job-1' }, 'PAUSE')).toBeNull()
    expect(recoverAppliedArchiveTaskAction({ status: 'PAUSED', systemJobId: 'job-1' }, 'PAUSE')).toEqual({
      result: 'REUSED',
      relatedId: 'job-1',
      message: '并发命令已执行 PAUSE'
    })
  })
})
