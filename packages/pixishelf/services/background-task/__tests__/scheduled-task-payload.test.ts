import { describe, expect, it } from 'vitest'
import { buildScheduledTaskJobDefinition } from '../scheduled-task-payload'

describe('scheduled task payload mapping', () => {
  it.each(['TRIGGER_LOG_RETENTION_CLEANUP', 'SCAN_RUN_RETENTION_CLEANUP', 'WEBP_ANIMATION_SCAN'])(
    'maps %s to an explicitly validated empty payload',
    (type) => {
      expect(buildScheduledTaskJobDefinition(type, { trigger: 'schedule' })).toEqual({ type, payload: {} })
    }
  )

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
