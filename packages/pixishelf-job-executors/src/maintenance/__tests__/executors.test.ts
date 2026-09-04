import { describe, expect, it } from 'vitest'
import { createMaintenanceExecutorRegistrations } from '../executors.js'

describe('maintenance executor registrations', () => {
  it('registers empty-payload, archive backfill, and Pixiv AI maintenance definitions', () => {
    const definitions = createMaintenanceExecutorRegistrations({ database: {} as never, scanRoot: '/scan' })
    expect(definitions.map(({ jobType, definitionVersion }) => ({ jobType, definitionVersion }))).toEqual([
      { jobType: 'ARCHIVE_INTAKE_RETENTION_CLEANUP', definitionVersion: 1 },
      { jobType: 'TRIGGER_LOG_RETENTION_CLEANUP', definitionVersion: 1 },
      { jobType: 'SCAN_RUN_RETENTION_CLEANUP', definitionVersion: 1 },
      { jobType: 'REFILL_META_SOURCE', definitionVersion: 1 },
      { jobType: 'MEDIA_DERIVED_TAG_SYNC', definitionVersion: 1 },
      { jobType: 'JOB_EVENT_RETENTION_CLEANUP', definitionVersion: 1 },
      { jobType: 'ARCHIVE_DEFAULT_TAG_BACKFILL', definitionVersion: 1 },
      { jobType: 'PIXIV_AI_DERIVED_TAG_SYNC', definitionVersion: 1 },
      { jobType: 'WEBP_ANIMATION_SCAN', definitionVersion: 1 }
    ])
    for (const definition of definitions.filter(
      ({ jobType }) =>
        !['ARCHIVE_DEFAULT_TAG_BACKFILL', 'PIXIV_AI_DERIVED_TAG_SYNC', 'JOB_EVENT_RETENTION_CLEANUP'].includes(jobType)
    )) {
      expect(definition.parsePayload?.({})).toEqual({})
      expect(() => definition.parsePayload?.({ unexpected: true })).toThrow()
    }
    const archiveBackfill = definitions.find(({ jobType }) => jobType === 'ARCHIVE_DEFAULT_TAG_BACKFILL')!
    expect(
      archiveBackfill.parsePayload?.({
        defaultTagIds: [9, 2],
        targetMaxArtworkId: 20,
        targetArtworkCount: 4,
        expectedExistingRelations: 1,
        expectedMissingRelations: 7,
        snapshotDigest: 'a'.repeat(64)
      })
    ).toMatchObject({ defaultTagIds: [2, 9], targetMaxArtworkId: 20 })
    expect(() => archiveBackfill.parsePayload?.({})).toThrow()
    const pixivAi = definitions.find(({ jobType }) => jobType === 'PIXIV_AI_DERIVED_TAG_SYNC')!
    expect(pixivAi.parsePayload?.({})).toEqual({ dryRun: true })
    expect(pixivAi.parsePayload?.({ dryRun: false })).toEqual({ dryRun: false })
    expect(() => pixivAi.parsePayload?.({ dryRun: false, unexpected: true })).toThrow()
    const eventRetention = definitions.find(({ jobType }) => jobType === 'JOB_EVENT_RETENTION_CLEANUP')!
    expect(eventRetention.parsePayload?.({})).toEqual({ dryRun: true })
    expect(eventRetention.parsePayload?.({ dryRun: false })).toEqual({ dryRun: false })
  })
})
