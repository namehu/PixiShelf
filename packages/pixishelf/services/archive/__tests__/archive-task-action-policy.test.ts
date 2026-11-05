import { describe, expect, it } from 'vitest'
import {
  archiveTaskActionIneligibility,
  canUseArchiveDisplayQuality,
  recoverAppliedArchiveTaskAction
} from '../archive-task-action-policy'

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

describe('display download quality choice', () => {
  const task = {
    phase: 'DOWNLOAD',
    status: 'PAUSED',
    selectedQuality: 'ORIGINAL',
    completionBaseRevisionId: null,
    upgradeBaseRevisionId: null,
    sealedManifestSha256: null,
    cleanupRequestedAt: null,
    systemJob: { status: 'PAUSED' }
  }

  it.each(['PAUSED', 'FAILED'])('allows a regular %s original download without decision or intake metadata', (status) => {
    expect(canUseArchiveDisplayQuality({ ...task, status, systemJob: { status } })).toBe(true)
  })

  it.each([
    { phase: 'PUBLISH' },
    { status: 'RUNNING' },
    { selectedQuality: 'DISPLAY' },
    { completionBaseRevisionId: 'base' },
    { upgradeBaseRevisionId: 'base' },
    { sealedManifestSha256: 'a'.repeat(64) },
    { cleanupRequestedAt: new Date('2026-11-05') },
    { systemJob: { status: 'PAUSING' } }
  ])('requires a changeable download state: %j', (change) => {
    expect(canUseArchiveDisplayQuality({ ...task, ...change })).toBe(false)
  })
})
