import { describe, expect, it } from 'vitest'
import { createMaintenanceExecutorRegistrations } from '../executors.js'

describe('maintenance executor registrations', () => {
  it('registers exactly the five v1 empty-payload maintenance definitions', () => {
    const definitions = createMaintenanceExecutorRegistrations({ database: {} as never, scanRoot: '/scan' })
    expect(definitions.map(({ jobType, definitionVersion }) => ({ jobType, definitionVersion }))).toEqual([
      { jobType: 'TRIGGER_LOG_RETENTION_CLEANUP', definitionVersion: 1 },
      { jobType: 'SCAN_RUN_RETENTION_CLEANUP', definitionVersion: 1 },
      { jobType: 'REFILL_META_SOURCE', definitionVersion: 1 },
      { jobType: 'MEDIA_DERIVED_TAG_SYNC', definitionVersion: 1 },
      { jobType: 'WEBP_ANIMATION_SCAN', definitionVersion: 1 }
    ])
    for (const definition of definitions) {
      expect(definition.parsePayload?.({})).toEqual({})
      expect(() => definition.parsePayload?.({ unexpected: true })).toThrow()
    }
  })
})
