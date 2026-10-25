import { describe, expect, it } from 'vitest'
import {
  artworkDedupMaintenancePayloadSchema,
  isArtworkDedupMaintenanceModeEnabled,
  artworkDedupAllowReimportInputSchema,
  artworkDedupMaintenanceV1PayloadSchema,
  artworkDedupMaintenanceV2PayloadSchema,
  artworkDedupMaintenanceV3PayloadSchema,
  artworkDedupMaintenanceV4PayloadSchema,
  artworkDedupDirectDeleteInputSchema,
  artworkDedupDirectDeleteRetryInputSchema,
  artworkDedupPrepareDirectDeleteInputSchema,
  ARTWORK_DEDUP_DIRECT_DELETE_ENABLED,
  ARTWORK_DEDUP_RELEASE_STAGE
} from '../artwork-dedup-maintenance'
import { parseJobPayload } from '../payloads'
import { executionLaneForJobType } from '../job-types'
describe('maintenance contract', () => {
  it('registers strict stable identity in the writer lane and keeps all unreleased modes closed', () => {
    const payload = { operationId: 'operation', executionVersion: 1, mode: 'PREPARE' }
    expect(parseJobPayload('ARTWORK_DEDUP_MAINTENANCE', payload)).toEqual(payload)
    expect(executionLaneForJobType('ARTWORK_DEDUP_MAINTENANCE')).toBe('BACKGROUND_WRITER')
    expect(artworkDedupMaintenancePayloadSchema.safeParse({ ...payload, paths: ['secret'] }).success).toBe(false)
    expect(isArtworkDedupMaintenanceModeEnabled('PREPARE', 'ISOLATION')).toBe(true)
    expect(isArtworkDedupMaintenanceModeEnabled('PREPARE', 'PURGE')).toBe(false)
    for (const mode of ['ISOLATE', 'RESTORE', 'PURGE'] as const) {
      expect(isArtworkDedupMaintenanceModeEnabled(mode)).toBe(false)
    }
  })
  it('requires protocol3 loss confirmation and refuses visual payloads in older executors', () => {
    const prepare = { operationId: 'o', executionVersion: 1, mode: 'PREPARE', purpose: 'DIRECT_DELETE', protocolVersion: 3 }
    expect(artworkDedupMaintenanceV3PayloadSchema.safeParse(prepare).success).toBe(false)
    expect(artworkDedupMaintenanceV4PayloadSchema.safeParse(prepare).success).toBe(true)
    const command = { operationId: 'o', expectedUserId: 'u', expectedVersion: 1, idempotencyKey: 'k', purpose: 'DIRECT_DELETE', protocolVersion: 3,
      scopeDigest: 'a'.repeat(64), externalWritesStopped: true, permanentDeleteConfirmed: true, organizationImpactConfirmed: true }
    expect(artworkDedupDirectDeleteInputSchema.safeParse(command).success).toBe(false)
    expect(artworkDedupDirectDeleteInputSchema.safeParse({ ...command, differentContentLossConfirmed: true }).success).toBe(true)
  })
  it('binds source reopening to exact distinct identity generations', () => {
    const input = {
      expectedUserId: 'u',
      operationId: 'o',
      expectedVersion: 1,
      idempotencyKey: 'k',
      sources: [{ sourceId: 's', expectedGeneration: '2' }]
    }
    expect(artworkDedupAllowReimportInputSchema.safeParse(input).success).toBe(true)
    expect(
      artworkDedupAllowReimportInputSchema.safeParse({ ...input, sources: [...input.sources, ...input.sources] })
        .success
    ).toBe(false)
  })
  it('separates maintenance v2 from the legacy payload and keeps confirmation literal and scope immutable', () => {
    const identity = { operationId: 'o', executionVersion: 1 }
    const direct = { ...identity, mode: 'DIRECT_DELETE' }
    const prepare = { ...identity, mode: 'PREPARE', purpose: 'DIRECT_DELETE', protocolVersion: 1 }
    expect(artworkDedupMaintenanceV1PayloadSchema.safeParse(direct).success).toBe(false)
    expect(artworkDedupMaintenanceV1PayloadSchema.safeParse(prepare).success).toBe(false)
    expect(artworkDedupMaintenanceV1PayloadSchema.safeParse({ ...identity, mode: 'PREPARE' }).success).toBe(true)
    expect(artworkDedupMaintenanceV2PayloadSchema.safeParse(direct).success).toBe(true)
    expect(artworkDedupMaintenanceV2PayloadSchema.safeParse(prepare).success).toBe(true)
    expect(artworkDedupMaintenanceV2PayloadSchema.safeParse({ ...prepare, protocolVersion: 2 }).success).toBe(false)
    expect(artworkDedupMaintenanceV3PayloadSchema.safeParse({ ...prepare, protocolVersion: 2 }).success).toBe(true)
    expect(artworkDedupMaintenanceV3PayloadSchema.safeParse(prepare).success).toBe(true)
    expect(artworkDedupMaintenanceV2PayloadSchema.safeParse({ ...identity, mode: 'PREPARE' }).success).toBe(false)
    const command = { expectedUserId: 'u', operationId: 'o', expectedVersion: 1, idempotencyKey: 'k' }
    const confirm = {
      ...command,
      purpose: 'DIRECT_DELETE',
      protocolVersion: 1,
      scopeDigest: 'a'.repeat(64),
      externalWritesStopped: true,
      permanentDeleteConfirmed: true,
      organizationImpactConfirmed: true
    }
    expect(artworkDedupDirectDeleteInputSchema.safeParse(confirm).success).toBe(true)
    for (const field of ['externalWritesStopped', 'permanentDeleteConfirmed', 'organizationImpactConfirmed']) {
      expect(artworkDedupDirectDeleteInputSchema.safeParse({ ...confirm, [field]: false }).success).toBe(false)
    }
    expect(artworkDedupDirectDeleteInputSchema.safeParse({ ...confirm, paths: ['other'] }).success).toBe(false)
    expect(artworkDedupDirectDeleteRetryInputSchema.safeParse({ ...command, itemIds: [1] }).success).toBe(false)
    expect(
      artworkDedupPrepareDirectDeleteInputSchema.safeParse({
        expectedUserId: 'u',
        purpose: 'DIRECT_DELETE',
        protocolVersion: 1,
        sourceOperationId: 'o',
        expectedOperationVersion: 1,
        idempotencyKey: 'k'
      }).success
    ).toBe(true)
    expect(ARTWORK_DEDUP_DIRECT_DELETE_ENABLED).toBe(true)
    expect(ARTWORK_DEDUP_RELEASE_STAGE).toBe(3)
    expect(isArtworkDedupMaintenanceModeEnabled('DIRECT_DELETE')).toBe(true)
    expect(isArtworkDedupMaintenanceModeEnabled('PREPARE', 'DIRECT_DELETE')).toBe(true)
  })
})
