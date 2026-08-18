import { describe, expect, it } from 'vitest'
import { buildScheduledTaskJobDefinition } from '../scheduled-task-payload'

describe('scheduled task payload mapping', () => {
  it('maps archive maintenance scheduling to the strict reconcile action', () => {
    expect(buildScheduledTaskJobDefinition('ARCHIVE_MAINTENANCE', { trigger: 'schedule' })).toEqual({
      type: 'ARCHIVE_MAINTENANCE',
      payload: { action: 'RECONCILE' }
    })
  })

  it.each([
    'ARCHIVE_INTAKE_RETENTION_CLEANUP',
    'TRIGGER_LOG_RETENTION_CLEANUP',
    'SCAN_RUN_RETENTION_CLEANUP',
    'WEBP_ANIMATION_SCAN'
  ])('maps %s to an explicitly validated empty payload', (type) => {
    expect(buildScheduledTaskJobDefinition(type, { trigger: 'schedule' })).toEqual({ type, payload: {} })
  })

  it('maps media probe and chapter preview behavior explicitly', () => {
    expect(buildScheduledTaskJobDefinition('VIDEO_MEDIA_PROBE', { trigger: 'schedule' }).payload).toEqual({
      force: false,
      enqueueMissingPosters: true
    })
    expect(
      buildScheduledTaskJobDefinition('VIDEO_CHAPTER_PREVIEW_GENERATION', { trigger: 'schedule' }).payload
    ).toEqual({
      mode: 'INCREMENTAL'
    })
    expect(buildScheduledTaskJobDefinition('VIDEO_CHAPTER_PREVIEW_GENERATION', { trigger: 'manual' }).payload).toEqual({
      mode: 'FULL'
    })
  })

  it('runs registered GC intents for both manual and scheduled triggers', () => {
    expect(buildScheduledTaskJobDefinition('DERIVED_MEDIA_GC', { trigger: 'schedule' }).payload).toEqual({
      dryRun: false,
      reconcile: false
    })
    expect(buildScheduledTaskJobDefinition('DERIVED_MEDIA_GC', { trigger: 'manual' }).payload).toEqual({
      dryRun: false,
      reconcile: false
    })
  })

  it.each(['manual', 'schedule'] as const)('keeps reconciliation read-only for %s triggers', (trigger) => {
    expect(
      buildScheduledTaskJobDefinition('DERIVED_MEDIA_GC', {
        trigger,
        scheduleKey: 'derived_media_gc_reconciliation'
      }).payload
    ).toEqual({ dryRun: true, reconcile: true })
  })

  it('validates keyframe filters through the shared contract', () => {
    expect(
      buildScheduledTaskJobDefinition('VIDEO_KEYFRAME_DISCOVERY', {
        trigger: 'manual',
        taskConfig: { includePaths: ['videos'], statuses: ['STALE'] }
      }).payload
    ).toMatchObject({
      trigger: 'manual',
      previewOnly: true,
      filter: { includePaths: ['videos'], statuses: ['STALE'] }
    })
    expect(() =>
      buildScheduledTaskJobDefinition('VIDEO_KEYFRAME_DISCOVERY', {
        trigger: 'schedule',
        taskConfig: { includePaths: ['../outside'] }
      })
    ).toThrow()
  })
})
