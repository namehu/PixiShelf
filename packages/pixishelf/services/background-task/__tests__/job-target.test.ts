import { describe, expect, it } from 'vitest'
import { projectJobTarget } from '../job-target'

describe('retired target columns', () => {
  it('uses validated payload rather than stale dual-written columns', () => {
    const job = projectJobTarget({
      type: 'VIDEO_STREAMING_OPTIMIZATION',
      definitionVersion: 1,
      payload: { imageId: 42, relativePath: 'video.mp4', mode: 'REMUX_FASTSTART' },
      targetImageId: 999,
      targetPath: 'old.mp4',
      mode: 'OLD',
      legacyDisplay: null
    })
    expect(job).toMatchObject({ targetImageId: 42, targetPath: 'video.mp4', mode: 'REMUX_FASTSTART' })
    expect(job).not.toHaveProperty('legacyDisplay')
  })
  it('preserves legacy display without changing execution input or acknowledged history', () => {
    const job = projectJobTarget({
      type: 'VIDEO_KEYFRAME_GENERATION',
      definitionVersion: 0,
      payload: null,
      failureAcknowledgement: { source: 'MANUAL' },
      legacyDisplay: { schemaVersion: 1, targetImageId: 12, targetPath: 'old.mp4', mode: 'MANUAL_FORCE' }
    })
    expect(job).toMatchObject({
      targetImageId: 12,
      targetPath: 'old.mp4',
      payload: null,
      definitionVersion: 0,
      failureAcknowledgement: { source: 'MANUAL' }
    })
  })
  it.each([0, 1, 77])(
    'does not recover execution parameters from old columns for invalid version %s input',
    (definitionVersion) => {
      expect(
        projectJobTarget({
          type: 'VIDEO_KEYFRAME_GENERATION',
          definitionVersion,
          payload: { imageId: 'invalid' },
          targetImageId: 99,
          targetPath: 'old.mp4',
          mode: 'MANUAL_FORCE'
        })
      ).toMatchObject({ targetImageId: null, targetPath: null, mode: null })
    }
  )
  it('redacts secrets in historical display text', () => {
    expect(
      projectJobTarget({
        type: 'VIDEO_KEYFRAME_GENERATION',
        definitionVersion: 0,
        payload: null,
        legacyDisplay: {
          schemaVersion: 1,
          targetImageId: null,
          targetPath: 'https://host/file?token=secret',
          mode: null
        }
      }).targetPath
    ).not.toContain('secret')
  })
})
